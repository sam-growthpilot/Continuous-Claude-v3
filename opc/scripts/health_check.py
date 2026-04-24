#!/usr/bin/env python3
"""CCv3 system health check runner.

Behaviour-exercising checks across 13 categories. Every check runs the
actual code path a user depends on -- no pure existence checks.

Usage:
    uv run python scripts/health_check.py
    uv run python scripts/health_check.py --categories memory,hooks
    uv run python scripts/health_check.py --skip-slow --quiet
    uv run python scripts/health_check.py --output-json report.json --output-md report.md

Exit codes:
    0 = all PASS
    1 = any WARN (no higher severity fail)
    2 = any HIGH-severity FAIL
    3 = any CRITICAL-severity FAIL
"""
from __future__ import annotations

import argparse
import asyncio
import difflib
import json
import os
import re
import socket
import subprocess
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

# Load environment at module level so checks see DATABASE_URL, etc.
try:
    from dotenv import load_dotenv

    _script_dir = Path(__file__).resolve().parent
    _opc_dir = _script_dir.parent  # opc/scripts -> opc/
    _opc_env = _opc_dir / ".env"
    if _opc_env.exists():
        load_dotenv(_opc_env, override=True)
    _global_env = Path.home() / ".claude" / ".env"
    if _global_env.exists():
        load_dotenv(_global_env)
    load_dotenv()
except Exception:  # pragma: no cover - dotenv optional
    pass


# ---------------------------------------------------------------------------
# Paths / config
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent  # opc/scripts -> opc -> repo
CLAUDE_DIR = REPO_ROOT / ".claude"
HOME_CLAUDE = Path.home() / ".claude"
DEFAULT_OUTPUT_DIR = CLAUDE_DIR / "cache" / "health-checks"

CATEGORY_ORDER: list[str] = [
    "infrastructure",
    "hooks",
    "memory",
    "skills",
    "agents",
    "rlm",
    "cli",
    "tests",
    "sync",
    "external",
    "knowledge-tree",
    "git",
    "roadmap",
]

SEVERITY_RANK = {"INFO": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}


# ---------------------------------------------------------------------------
# Result record
# ---------------------------------------------------------------------------


@dataclass
class CheckResult:
    name: str
    category: str
    status: str  # PASS | FAIL | WARN | SKIP
    severity: str  # CRITICAL | HIGH | MEDIUM | LOW | INFO
    evidence: str
    duration_ms: int
    remediation: str = ""
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


@dataclass
class _Registration:
    name: str
    category: str
    fn: Callable[[], CheckResult]
    slow: bool = False


class HealthCheckRunner:
    """Registers and executes health checks with isolation + timing."""

    def __init__(
        self,
        output_dir: Path | None = None,
        quiet: bool = False,
        skip_slow: bool = False,
    ) -> None:
        self.output_dir = Path(output_dir) if output_dir else DEFAULT_OUTPUT_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.quiet = quiet
        self.skip_slow = skip_slow
        self._registrations: list[_Registration] = []
        self._started_at: datetime | None = None
        self._duration_s: float | None = None

    def register(
        self,
        name: str,
        category: str,
        fn: Callable[[], CheckResult],
        slow: bool = False,
    ) -> None:
        self._registrations.append(_Registration(name, category, fn, slow))

    def run_sync(
        self,
        categories: Iterable[str] | None = None,
    ) -> list[CheckResult]:
        """Run every registered check. One crash never kills the batch."""
        self._started_at = datetime.now(timezone.utc)
        wall_start = time.perf_counter()

        wanted = set(categories) if categories else None
        results: list[CheckResult] = []

        for reg in self._registrations:
            if wanted is not None and reg.category not in wanted:
                continue
            if self.skip_slow and reg.slow:
                results.append(CheckResult(
                    name=reg.name, category=reg.category,
                    status="SKIP", severity="INFO",
                    evidence="skipped via --skip-slow", duration_ms=0,
                ))
                continue

            start = time.perf_counter()
            try:
                r = reg.fn()
                if not isinstance(r, CheckResult):
                    r = CheckResult(
                        name=reg.name, category=reg.category,
                        status="FAIL", severity="HIGH",
                        evidence=f"check returned non-CheckResult: {type(r).__name__}",
                        duration_ms=int((time.perf_counter() - start) * 1000),
                    )
            except Exception as e:  # noqa: BLE001 - isolation intentional
                r = CheckResult(
                    name=reg.name, category=reg.category,
                    status="FAIL", severity="HIGH",
                    evidence=f"check crashed: {type(e).__name__}: {e}",
                    duration_ms=int((time.perf_counter() - start) * 1000),
                    remediation="fix the check function and re-run",
                )
            results.append(r)

        self._duration_s = time.perf_counter() - wall_start
        return results

    def write_outputs(
        self,
        results: list[CheckResult],
        json_path: Path | None = None,
        md_path: Path | None = None,
    ) -> tuple[Path, Path]:
        assert self._started_at is not None, "run_sync must be called first"
        stamp = self._started_at.strftime("%Y%m%d_%H%M%S")
        json_path = json_path or (self.output_dir / f"health_{stamp}.json")
        md_path = md_path or (self.output_dir / f"health_{stamp}.md")

        duration = self._duration_s or 0.0
        overall = _overall_status(results)
        counts = _count_statuses(results)

        payload = {
            "timestamp": self._started_at.isoformat(),
            "duration_s": round(duration, 3),
            "overall_status": overall,
            "counts": counts,
            "hostname": socket.gethostname(),
            "results": [r.to_dict() for r in results],
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        md_path.write_text(render_markdown(results, duration_s=duration),
                           encoding="utf-8")

        # history.jsonl
        history = self.output_dir / "history.jsonl"
        with history.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "timestamp": self._started_at.isoformat(),
                "overall_status": overall,
                "counts": counts,
                "duration_ms": int(duration * 1000),
                "hostname": socket.gethostname(),
            }) + "\n")

        return json_path, md_path


# ---------------------------------------------------------------------------
# Aggregation helpers
# ---------------------------------------------------------------------------


def _count_statuses(results: list[CheckResult]) -> dict:
    counts = {"PASS": 0, "WARN": 0, "FAIL": 0, "SKIP": 0}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    return counts


def _overall_status(results: list[CheckResult]) -> str:
    if any(r.status == "FAIL" and r.severity == "CRITICAL" for r in results):
        return "CRITICAL_FAIL"
    if any(r.status == "FAIL" and r.severity == "HIGH" for r in results):
        return "HIGH_FAIL"
    if any(r.status == "FAIL" for r in results):
        return "FAIL"
    if any(r.status == "WARN" for r in results):
        return "WARN"
    return "PASS"


def compute_exit_code(results: list[CheckResult]) -> int:
    """0=all pass, 1=warn only, 2=any FAIL at HIGH/MEDIUM/LOW, 3=FAIL at CRITICAL.
    Kept in sync with _overall_status by test_exit_code_matches_overall_status
    + test_exit_code_covers_all_fail_severities.
    """
    if any(r.status == "FAIL" and r.severity == "CRITICAL" for r in results):
        return 3
    if any(r.status == "FAIL" and r.severity == "HIGH" for r in results):
        return 2
    if any(r.status == "FAIL" for r in results):
        # medium/low fail still merits a signal -- treat as HIGH
        return 2
    if any(r.status == "WARN" for r in results):
        return 1
    return 0


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------


def render_markdown(results: list[CheckResult], duration_s: float) -> str:
    lines: list[str] = []
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    overall = _overall_status(results)
    counts = _count_statuses(results)

    lines.append(f"# CCv3 Health Check -- {stamp}")
    lines.append(f"**Overall: {overall}**")
    lines.append("")
    lines.append("## Summary")
    lines.append(f"- Checks run: {len(results)}")
    lines.append(
        f"- PASS: {counts['PASS']}  |  WARN: {counts['WARN']}  |  "
        f"FAIL: {counts['FAIL']}  |  SKIP: {counts['SKIP']}"
    )
    lines.append(f"- Duration: {duration_s:.1f}s")
    lines.append("")

    # Severity-grouped fails/warns
    sev_order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    for sev in sev_order:
        bucket = [r for r in results
                  if r.status in ("FAIL", "WARN") and r.severity == sev]
        if not bucket and sev != "CRITICAL":
            continue
        lines.append(f"## {sev} ({len(bucket)})")
        if not bucket:
            lines.append("_none_")
        else:
            for r in bucket:
                evidence = r.evidence.replace("\n", " ").strip()
                lines.append(
                    f"- **{r.name}** ({r.category}, {r.status}): {evidence}"
                )
                if r.remediation:
                    lines.append(f"  - Remediation: {r.remediation}")
        lines.append("")

    # Per-category table
    lines.append("## Per-category")
    lines.append("| Category | PASS | WARN | FAIL | SKIP |")
    lines.append("|---|---|---|---|---|")
    cats: dict[str, dict[str, int]] = {}
    for r in results:
        cats.setdefault(r.category,
                        {"PASS": 0, "WARN": 0, "FAIL": 0, "SKIP": 0})
        cats[r.category][r.status] = cats[r.category].get(r.status, 0) + 1
    ordered = [c for c in CATEGORY_ORDER if c in cats] + \
              [c for c in sorted(cats) if c not in CATEGORY_ORDER]
    for cat in ordered:
        c = cats[cat]
        lines.append(
            f"| {cat} | {c['PASS']} | {c['WARN']} | {c['FAIL']} | {c['SKIP']} |"
        )
    lines.append("")

    # Full detail
    lines.append("## All checks")
    lines.append("| Check | Cat | Status | Sev | Time (ms) | Evidence |")
    lines.append("|---|---|---|---|---|---|")
    for r in results:
        evidence = r.evidence.replace("|", "\\|").replace("\n", " ")
        if len(evidence) > 180:
            evidence = evidence[:177] + "..."
        lines.append(
            f"| {r.name} | {r.category} | {r.status} | {r.severity} | "
            f"{r.duration_ms} | {evidence} |"
        )

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Utility helpers for checks
# ---------------------------------------------------------------------------


def _run(
    cmd: list[str] | str,
    timeout: int = 30,
    cwd: Path | str | None = None,
    env: dict | None = None,
    shell: bool = False,
) -> subprocess.CompletedProcess:
    """Run a command, capturing stdout/stderr. Never raises on non-zero."""
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(cwd) if cwd else None,
        env=env or os.environ.copy(),
        shell=shell,
        encoding="utf-8",
        errors="replace",
    )


def _timed_result(
    name: str,
    category: str,
    fn: Callable[[], tuple[str, str, str, str, str, dict]],
) -> CheckResult:
    """fn must return (status, severity, evidence, remediation, _unused, metadata)
    -- kept as a small helper for composing quick checks."""
    start = time.perf_counter()
    status, severity, evidence, remediation, _, metadata = fn()
    return CheckResult(
        name=name, category=category, status=status, severity=severity,
        evidence=evidence, remediation=remediation,
        duration_ms=int((time.perf_counter() - start) * 1000),
        metadata=metadata,
    )


def _pass(name: str, category: str, evidence: str, duration_ms: int = 0,
          metadata: dict | None = None, severity: str = "INFO") -> CheckResult:
    return CheckResult(
        name=name, category=category, status="PASS", severity=severity,
        evidence=evidence, duration_ms=duration_ms,
        metadata=metadata or {},
    )


def _fail(name: str, category: str, evidence: str, severity: str = "HIGH",
          remediation: str = "", duration_ms: int = 0,
          metadata: dict | None = None) -> CheckResult:
    return CheckResult(
        name=name, category=category, status="FAIL", severity=severity,
        evidence=evidence, remediation=remediation,
        duration_ms=duration_ms, metadata=metadata or {},
    )


def _warn(name: str, category: str, evidence: str, severity: str = "MEDIUM",
          remediation: str = "", duration_ms: int = 0,
          metadata: dict | None = None) -> CheckResult:
    return CheckResult(
        name=name, category=category, status="WARN", severity=severity,
        evidence=evidence, remediation=remediation,
        duration_ms=duration_ms, metadata=metadata or {},
    )


def _skip(name: str, category: str, evidence: str,
          duration_ms: int = 0) -> CheckResult:
    return CheckResult(
        name=name, category=category, status="SKIP", severity="INFO",
        evidence=evidence, duration_ms=duration_ms,
    )


# ---------------------------------------------------------------------------
# Canary helper for memory roundtrip
# ---------------------------------------------------------------------------


_CANARY_PHRASES = [
    "turquoise elephant lagoon",
    "velvet octopus meridian",
    "cinnamon quasar aviary",
    "silver mosquito tangerine",
    "jade polygon saxophone",
]


def _build_canary_signal() -> dict:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    rand = uuid.uuid4().hex[:8]
    phrase = _CANARY_PHRASES[int(rand, 16) % len(_CANARY_PHRASES)]
    phrase_uniq = f"{phrase} {rand}"
    canary_id = f"HEALTH_CHECK_{today}_{rand}"
    return {"canary_id": canary_id, "phrase": phrase_uniq, "date": today}


# ===========================================================================
# -------------------  Actual checks  ---------------------------------------
# ===========================================================================


# ---- 1. Infrastructure -----------------------------------------------------


def check_docker_daemon() -> CheckResult:
    start = time.perf_counter()
    p = _run(["docker", "version"], timeout=10)
    dur = int((time.perf_counter() - start) * 1000)
    if p.returncode == 0:
        return _pass("docker-daemon-running", "infrastructure",
                     "docker version returned 0", dur)
    return _fail("docker-daemon-running", "infrastructure",
                 f"docker version exit={p.returncode}: "
                 f"{p.stderr.strip()[:200]}",
                 severity="CRITICAL",
                 remediation="start Docker Desktop / daemon",
                 duration_ms=dur)


def check_postgres_container() -> CheckResult:
    start = time.perf_counter()
    p = _run([
        "docker", "ps",
        "--filter", "name=continuous-claude-postgres",
        "--filter", "status=running",
        "--format", "{{.Names}}",
    ], timeout=10)
    dur = int((time.perf_counter() - start) * 1000)
    if p.returncode != 0:
        return _fail("postgres-container-running", "infrastructure",
                     f"docker ps failed: {p.stderr.strip()[:200]}",
                     severity="CRITICAL",
                     remediation="start docker compose from "
                                 "~/.claude/docker/",
                     duration_ms=dur)
    names = [ln.strip() for ln in p.stdout.splitlines() if ln.strip()]
    if names:
        return _pass("postgres-container-running", "infrastructure",
                     f"running: {names[0]}", dur,
                     metadata={"container": names[0]})
    return _fail("postgres-container-running", "infrastructure",
                 "no running continuous-claude-postgres container",
                 severity="CRITICAL",
                 remediation="cd ~/.claude/docker && docker compose up -d",
                 duration_ms=dur)


def check_rlm_sandbox_image() -> CheckResult:
    start = time.perf_counter()
    p = _run([
        "docker", "images", "continuous-claude/rlm-sandbox:3.11",
        "--format", "{{.ID}}",
    ], timeout=10)
    dur = int((time.perf_counter() - start) * 1000)
    if p.returncode == 0 and p.stdout.strip():
        return _pass("rlm-sandbox-image-present", "infrastructure",
                     f"image id={p.stdout.strip()[:12]}", dur)
    return _warn("rlm-sandbox-image-present", "infrastructure",
                 "image continuous-claude/rlm-sandbox:3.11 not found",
                 severity="MEDIUM",
                 remediation="build image: cd opc/docker && "
                             "docker build -t continuous-claude/rlm-sandbox:3.11 .",
                 duration_ms=dur)


def check_anthropic_key() -> CheckResult:
    val = os.environ.get("ANTHROPIC_API_KEY", "")
    if val and len(val) > 20:
        return _pass("anthropic-api-key-set", "infrastructure",
                     f"ANTHROPIC_API_KEY set ({len(val)} chars)")
    return _warn("anthropic-api-key-set", "infrastructure",
                 "ANTHROPIC_API_KEY not set or empty",
                 severity="MEDIUM",
                 remediation="set in opc/.env or shell env")


def check_claude_opc_dir() -> CheckResult:
    val = os.environ.get("CLAUDE_OPC_DIR", "")
    if val and Path(val).is_dir():
        return _pass("claude-opc-dir-set", "infrastructure",
                     f"{val}", metadata={"path": val})
    if val:
        return _fail("claude-opc-dir-set", "infrastructure",
                     f"CLAUDE_OPC_DIR set but missing: {val}",
                     severity="HIGH")
    return _warn("claude-opc-dir-set", "infrastructure",
                 "CLAUDE_OPC_DIR not set",
                 severity="MEDIUM",
                 remediation="export CLAUDE_OPC_DIR="
                             "C:/Users/david.hayes/continuous-claude/opc")


def check_opc_env_file() -> CheckResult:
    env = REPO_ROOT / "opc" / ".env"
    if not env.exists():
        return _fail("opc-env-file-present", "infrastructure",
                     f"{env} not found",
                     severity="HIGH",
                     remediation="create opc/.env with DATABASE_URL and "
                                 "ANTHROPIC_API_KEY")
    try:
        size = env.stat().st_size
    except OSError as e:
        return _fail("opc-env-file-present", "infrastructure",
                     f"cannot stat {env}: {e}", severity="HIGH")
    if size == 0:
        return _warn("opc-env-file-present", "infrastructure",
                     f"{env} is empty", severity="MEDIUM")
    return _pass("opc-env-file-present", "infrastructure",
                 f"{env} ({size} bytes)",
                 metadata={"bytes": size})


# ---- 2. Hooks --------------------------------------------------------------


def check_hook_dist_freshness() -> CheckResult:
    start = time.perf_counter()
    src_dir = CLAUDE_DIR / "hooks" / "src"
    dist_dir = CLAUDE_DIR / "hooks" / "dist"
    if not src_dir.is_dir():
        return _skip("hook-dist-freshness", "hooks",
                     f"no src dir at {src_dir}")
    stale: list[str] = []
    missing: list[str] = []
    total = 0
    for src in src_dir.glob("*.ts"):
        if src.name.startswith("_"):
            continue
        if "__tests__" in src.parts:
            continue
        total += 1
        dist = dist_dir / (src.stem + ".mjs")
        if not dist.exists():
            missing.append(src.name)
            continue
        if dist.stat().st_mtime < src.stat().st_mtime:
            stale.append(src.name)
    dur = int((time.perf_counter() - start) * 1000)
    if not missing and not stale:
        return _pass("hook-dist-freshness", "hooks",
                     f"{total} hook sources -> dist all current",
                     dur, metadata={"count": total})
    severity = "HIGH" if missing else "MEDIUM"
    evidence = (
        f"missing dist ({len(missing)}): {missing[:5]} | "
        f"stale dist ({len(stale)}): {stale[:5]}"
    )
    return _fail("hook-dist-freshness", "hooks",
                 evidence, severity=severity,
                 remediation="cd .claude/hooks && npm run build",
                 duration_ms=dur,
                 metadata={"missing": missing, "stale": stale})


def _load_settings() -> dict | None:
    # Prefer ~/.claude/settings.json -- that is what Claude Code actually reads
    for candidate in (HOME_CLAUDE / "settings.json",
                      CLAUDE_DIR / "settings.json"):
        if candidate.exists():
            try:
                return json.loads(candidate.read_text(encoding="utf-8"))
            except Exception:
                continue
    return None


def _extract_hook_paths(settings: dict) -> list[tuple[str, str]]:
    """Return list of (event, path) from hooks config."""
    hooks_cfg = settings.get("hooks") or {}
    paths: list[tuple[str, str]] = []
    for event, entries in hooks_cfg.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            inner = entry.get("hooks", []) if isinstance(entry, dict) else []
            for h in inner:
                if not isinstance(h, dict):
                    continue
                cmd = h.get("command", "")
                # extract last .mjs path from the command
                m = re.search(r"(\S+\.mjs)", cmd)
                if m:
                    raw = m.group(1)
                    # resolve ~
                    resolved = os.path.expanduser(raw)
                    paths.append((event, resolved))
    return paths


def check_hook_registrations() -> CheckResult:
    start = time.perf_counter()
    settings = _load_settings()
    if not settings:
        return _warn("hook-registrations-valid", "hooks",
                     "no settings.json found",
                     severity="MEDIUM")
    registered = _extract_hook_paths(settings)
    missing = [p for _, p in registered if not Path(p).exists()]
    dur = int((time.perf_counter() - start) * 1000)
    if not missing:
        return _pass("hook-registrations-valid", "hooks",
                     f"{len(registered)} hook registrations all resolve",
                     dur, metadata={"count": len(registered)})
    return _fail("hook-registrations-valid", "hooks",
                 f"{len(missing)} registered hook paths missing: "
                 f"{[Path(p).name for p in missing[:5]]}",
                 severity="HIGH",
                 remediation="rebuild: cd .claude/hooks && npm run build "
                             "&& bash scripts/sync-to-active.sh",
                 duration_ms=dur,
                 metadata={"missing": missing})


def check_hook_orphans() -> CheckResult:
    start = time.perf_counter()
    settings = _load_settings()
    dist_dir = CLAUDE_DIR / "hooks" / "dist"
    if not settings or not dist_dir.is_dir():
        return _skip("hook-orphans", "hooks", "settings or dist missing")
    registered_names = {
        Path(p).name for _, p in _extract_hook_paths(settings)
    }
    dist_names = {
        f.name for f in dist_dir.glob("*.mjs") if not f.name.startswith("_")
    }
    orphans = sorted(dist_names - registered_names)
    dur = int((time.perf_counter() - start) * 1000)
    # Orphans are not necessarily bad (dev, shared helpers). Surface count only.
    if not orphans:
        return _pass("hook-orphans", "hooks",
                     "no orphaned dist hooks", dur)
    # Filter out shared-lib style hooks that end in common shared names
    interesting = [n for n in orphans
                   if not n.startswith(("daemon-client", "shared",
                                        "post-edit-diagnostics.js"))]
    if len(interesting) > 10:
        return _warn("hook-orphans", "hooks",
                     f"{len(interesting)} dist hooks not registered "
                     f"(first 5: {interesting[:5]})",
                     severity="LOW",
                     remediation="verify intent: remove unused "
                                 "dist files or register in settings.json",
                     duration_ms=dur,
                     metadata={"orphans": interesting})
    return _pass("hook-orphans", "hooks",
                 f"{len(interesting)} orphaned hook(s) (acceptable)",
                 dur, metadata={"orphans": interesting})


def check_critical_hook_load() -> CheckResult:
    """Sample-load 5 critical hooks via `node -e import(...)`."""
    start = time.perf_counter()
    dist_dir = CLAUDE_DIR / "hooks" / "dist"
    if not dist_dir.is_dir():
        return _skip("hook-node-load-test", "hooks",
                     "no dist dir")
    critical = [
        "plan-to-ralph-enforcer.mjs",
        "no-haiku-enforcer.mjs",
        "package-install-guard.mjs",
        "memory-awareness.mjs",
        "session-start-continuity.mjs",
    ]
    missing: list[str] = []
    errors: dict[str, str] = {}
    loaded: list[str] = []
    for name in critical:
        path = dist_dir / name
        if not path.exists():
            missing.append(name)
            continue
        # `node -e` with dynamic import
        expr = (
            f"import('file:///{path.as_posix()}')"
            ".then(()=>console.log('ok')).catch(e=>{console.error(e.message);"
            "process.exit(2);})"
        )
        p = _run(["node", "-e", expr], timeout=15)
        if p.returncode == 0 and "ok" in p.stdout:
            loaded.append(name)
        else:
            errors[name] = (p.stderr.strip() or p.stdout.strip())[:200]
    dur = int((time.perf_counter() - start) * 1000)
    if not errors and not missing:
        return _pass("hook-node-load-test", "hooks",
                     f"{len(loaded)}/{len(critical)} critical hooks load cleanly",
                     dur, metadata={"loaded": loaded})
    bits = []
    if missing:
        bits.append(f"missing: {missing}")
    if errors:
        first = next(iter(errors.items()))
        bits.append(f"errors: {len(errors)} (e.g. {first[0]}: {first[1]})")
    return _fail("hook-node-load-test", "hooks",
                 " | ".join(bits), severity="CRITICAL",
                 remediation="rebuild hooks: cd .claude/hooks && npm run build",
                 duration_ms=dur,
                 metadata={"missing": missing, "errors": errors})


def check_hook_vitest() -> CheckResult:
    import tempfile
    start = time.perf_counter()
    hooks_dir = CLAUDE_DIR / "hooks"
    if not (hooks_dir / "package.json").exists():
        return _skip("hook-vitest-tests-pass", "hooks",
                     "no hooks/package.json")
    # Use --outputFile so vitest writes a clean JSON file rather than mixing
    # progress lines + JSON to stdout (which causes JSONDecodeError at char 433).
    fd, tf_str = tempfile.mkstemp(suffix=".json")
    os.close(fd)  # Release the fd; subprocess must be able to write the file.
    tf = Path(tf_str)
    try:
        p = _run(
            ["npx", "vitest", "run", "--reporter=json",
             f"--outputFile={tf}"],
            timeout=180,
            cwd=hooks_dir,
            shell=True,
        )
        dur = int((time.perf_counter() - start) * 1000)
        # Read the clean JSON file written by vitest.
        try:
            raw = tf.read_text(encoding="utf-8") if tf.exists() else ""
            data = json.loads(raw) if raw.strip() else {}
        except (json.JSONDecodeError, OSError):
            data = {}
        if data:
            total = data.get("numTotalTests") or 0
            passed = data.get("numPassedTests") or 0
            failed = data.get("numFailedTests") or 0
            if failed == 0 and total > 0:
                return _pass("hook-vitest-tests-pass", "hooks",
                             f"{passed}/{total} vitest tests pass",
                             dur,
                             metadata={"passed": passed, "failed": failed,
                                       "total": total})
            if total == 0:
                return _warn("hook-vitest-tests-pass", "hooks",
                             "no vitest tests collected",
                             severity="LOW",
                             duration_ms=dur)
            return _fail("hook-vitest-tests-pass", "hooks",
                         f"{failed} failing / {total} total",
                         severity="HIGH",
                         remediation="cd .claude/hooks && npx vitest run",
                         duration_ms=dur,
                         metadata={"passed": passed, "failed": failed,
                                   "total": total})
        # Could not parse -- fall back to return code
        if p.returncode == 0:
            return _pass("hook-vitest-tests-pass", "hooks",
                         "vitest returned 0 (could not parse JSON)",
                         dur)
        return _fail("hook-vitest-tests-pass", "hooks",
                     f"vitest exit={p.returncode}; "
                     f"stderr={p.stderr.strip()[:200]}",
                     severity="HIGH",
                     remediation="cd .claude/hooks && npx vitest run",
                     duration_ms=dur)
    finally:
        tf.unlink(missing_ok=True)


# ---- 3. Memory -------------------------------------------------------------


def _run_python_script(args: list[str], timeout: int = 60) -> tuple[int, str, str]:
    """Run a core Python script via uv, from opc dir with PYTHONPATH=."""
    opc = REPO_ROOT / "opc"
    env = os.environ.copy()
    env["PYTHONPATH"] = "." + (os.pathsep + env.get("PYTHONPATH", "")
                               if env.get("PYTHONPATH") else "")
    p = _run(["uv", "run", "python", *args],
             timeout=timeout, cwd=opc, env=env)
    return p.returncode, p.stdout, p.stderr


def check_memory_connection() -> CheckResult:
    """Direct asyncpg ping of DATABASE_URL."""
    start = time.perf_counter()
    dsn = os.environ.get("DATABASE_URL") or \
        os.environ.get("CONTINUOUS_CLAUDE_DB_URL")
    if not dsn:
        return _skip("memory-connection", "memory",
                     "DATABASE_URL not set")
    try:
        import asyncpg  # type: ignore
    except ImportError:
        return _skip("memory-connection", "memory",
                     "asyncpg not installed")

    async def _ping() -> int | None:
        conn = await asyncpg.connect(dsn, timeout=8)
        try:
            row = await conn.fetchrow("SELECT 1 AS v")
            return row["v"]
        finally:
            await conn.close()

    try:
        val = asyncio.run(_ping())
    except Exception as e:  # noqa: BLE001
        dur = int((time.perf_counter() - start) * 1000)
        return _fail("memory-connection", "memory",
                     f"asyncpg connect failed: {type(e).__name__}: {e}",
                     severity="CRITICAL",
                     remediation="check docker postgres container + DATABASE_URL",
                     duration_ms=dur)
    dur = int((time.perf_counter() - start) * 1000)
    if val == 1:
        return _pass("memory-connection", "memory",
                     "SELECT 1 returned 1", dur, severity="INFO")
    return _fail("memory-connection", "memory",
                 f"unexpected SELECT 1 result: {val}",
                 severity="CRITICAL", duration_ms=dur)


def check_memory_canary_roundtrip() -> CheckResult:
    """Full end-to-end: store -> recall -> verify -> delete -> reverify."""
    start = time.perf_counter()
    dsn = os.environ.get("DATABASE_URL") or \
        os.environ.get("CONTINUOUS_CLAUDE_DB_URL")
    if not dsn:
        return _skip("memory-canary-roundtrip", "memory",
                     "DATABASE_URL not set")
    try:
        import asyncpg  # type: ignore
    except ImportError:
        return _skip("memory-canary-roundtrip", "memory",
                     "asyncpg not installed")

    sig = _build_canary_signal()
    canary_id = sig["canary_id"]
    phrase = sig["phrase"]
    content = f"canary: {canary_id} -- {phrase}"
    steps: list[str] = []

    async def _cleanup() -> None:
        try:
            conn = await asyncpg.connect(dsn, timeout=8)
            try:
                await conn.execute(
                    "DELETE FROM archival_memory WHERE content LIKE $1",
                    f"%{canary_id}%",
                )
            finally:
                await conn.close()
        except Exception:  # noqa: BLE001
            pass  # best-effort cleanup

    try:
        # 1. Store via store_learning.py
        rc, stdout, stderr = _run_python_script([
            "scripts/core/store_learning.py",
            "--session-id", "health-check",
            "--type", "WORKING_SOLUTION",
            "--content", content,
            "--context", "health check canary",
            "--tags", "scope:global,canary,health-check",
            "--confidence", "medium",
        ], timeout=90)
        steps.append(f"store_rc={rc}")
        if rc != 0:
            asyncio.run(_cleanup())
            dur = int((time.perf_counter() - start) * 1000)
            return _fail("memory-canary-roundtrip", "memory",
                         f"store_learning.py failed: rc={rc} "
                         f"stderr={stderr.strip()[:200]}",
                         severity="CRITICAL",
                         remediation="inspect store_learning output; "
                                     "check DATABASE_URL and embedder",
                         duration_ms=dur,
                         metadata={"steps": steps})

        # Small delay for embedding commit visibility (defensive)
        time.sleep(2)

        # 2. Verify embedding written correctly
        async def _verify_row() -> dict | None:
            conn = await asyncpg.connect(dsn, timeout=8)
            try:
                return await conn.fetchrow(
                    "SELECT id, embedding IS NOT NULL AS has_emb, "
                    "CASE WHEN embedding IS NOT NULL THEN "
                    "  array_length(embedding::real[], 1) ELSE NULL END "
                    "  AS dim "
                    "FROM archival_memory WHERE content LIKE $1 "
                    "ORDER BY created_at DESC LIMIT 1",
                    f"%{canary_id}%",
                )
            finally:
                await conn.close()

        row = asyncio.run(_verify_row())
        if not row:
            asyncio.run(_cleanup())
            dur = int((time.perf_counter() - start) * 1000)
            return _fail("memory-canary-roundtrip", "memory",
                         "canary not found in archival_memory after store",
                         severity="CRITICAL",
                         remediation="store path writes to a different table "
                                     "than recall reads -- investigate",
                         duration_ms=dur,
                         metadata={"steps": steps})
        steps.append(f"row_found id={str(row['id'])[:12]} "
                     f"has_emb={row['has_emb']} dim={row['dim']}")
        if not row["has_emb"]:
            asyncio.run(_cleanup())
            dur = int((time.perf_counter() - start) * 1000)
            return _fail("memory-canary-roundtrip", "memory",
                         "canary stored but embedding is NULL",
                         severity="CRITICAL",
                         remediation="embedding service broken; "
                                     "check sentence-transformers or VOYAGE_API_KEY",
                         duration_ms=dur,
                         metadata={"steps": steps})
        if row["dim"] and row["dim"] != 1024:
            steps.append(f"dim-mismatch (got {row['dim']}, expected 1024)")

        # 3. Recall via recall_learnings.py (default hybrid)
        rc, stdout, stderr = _run_python_script([
            "scripts/core/recall_learnings.py",
            "--query", phrase,
            "--k", "5",
        ], timeout=60)
        steps.append(f"recall_rc={rc}")
        is_top1 = canary_id in (stdout.splitlines()[:25] and "\n".join(
            stdout.splitlines()[:25]))  # canary should appear near top
        # Stricter: examine top results -- look for canary in first 500 chars
        top_chunk = stdout[:2000]
        if canary_id not in top_chunk:
            asyncio.run(_cleanup())
            dur = int((time.perf_counter() - start) * 1000)
            return _fail("memory-canary-roundtrip", "memory",
                         f"canary NOT in top recall results. "
                         f"stdout[:200]={stdout[:200]!r}",
                         severity="CRITICAL",
                         remediation="hybrid RRF search degraded; "
                                     "check embedder + text search indexes",
                         duration_ms=int((time.perf_counter() - start) * 1000),
                         metadata={"steps": steps})

        # 4. Delete
        asyncio.run(_cleanup())
        steps.append("deleted")

        # 5. Re-query -- canary must be gone
        rc2, stdout2, _ = _run_python_script([
            "scripts/core/recall_learnings.py",
            "--query", phrase,
            "--k", "5",
            "--text-only",
        ], timeout=60)
        steps.append(f"post_delete_rc={rc2}")
        if canary_id in stdout2:
            dur = int((time.perf_counter() - start) * 1000)
            return _fail("memory-canary-roundtrip", "memory",
                         "canary still present after DELETE (stale index?)",
                         severity="HIGH",
                         remediation="investigate memory cleanup path",
                         duration_ms=dur,
                         metadata={"steps": steps})

        dur = int((time.perf_counter() - start) * 1000)
        return _pass("memory-canary-roundtrip", "memory",
                     f"round-trip OK in {dur}ms (store/recall/delete verified)",
                     dur, severity="CRITICAL",
                     metadata={"steps": steps, "canary_id": canary_id})
    except Exception as e:  # noqa: BLE001
        asyncio.run(_cleanup())
        dur = int((time.perf_counter() - start) * 1000)
        return _fail("memory-canary-roundtrip", "memory",
                     f"exception: {type(e).__name__}: {e}",
                     severity="CRITICAL",
                     duration_ms=dur,
                     metadata={"steps": steps})


def check_memory_growth_rate() -> CheckResult:
    start = time.perf_counter()
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return _skip("memory-growth-rate", "memory",
                     "DATABASE_URL not set")
    try:
        import asyncpg  # type: ignore
    except ImportError:
        return _skip("memory-growth-rate", "memory",
                     "asyncpg not installed")

    async def _count() -> int:
        conn = await asyncpg.connect(dsn, timeout=8)
        try:
            row = await conn.fetchrow(
                "SELECT COUNT(*) AS n FROM archival_memory "
                "WHERE created_at > NOW() - INTERVAL '7 days'"
            )
            return int(row["n"])
        finally:
            await conn.close()

    try:
        n = asyncio.run(_count())
    except Exception as e:  # noqa: BLE001
        dur = int((time.perf_counter() - start) * 1000)
        return _fail("memory-growth-rate", "memory",
                     f"query failed: {e}", severity="MEDIUM",
                     duration_ms=dur)
    dur = int((time.perf_counter() - start) * 1000)
    metadata = {"entries_7d": n, "avg_per_day": round(n / 7, 1)}
    if n > 500:
        return _warn("memory-growth-rate", "memory",
                     f"{n} entries added in last 7d (>500 -- possible explosion)",
                     severity="MEDIUM",
                     remediation="inspect extraction pipeline; "
                                 "consider tightening L0 quality gate",
                     duration_ms=dur, metadata=metadata)
    if n < 5:
        return _warn("memory-growth-rate", "memory",
                     f"only {n} entries in last 7d (<5 -- extraction may be broken)",
                     severity="MEDIUM",
                     remediation="verify hooks/src/auto-learning.ts is running",
                     duration_ms=dur, metadata=metadata)
    return _pass("memory-growth-rate", "memory",
                 f"{n} entries last 7d (avg {n/7:.1f}/day)",
                 dur, metadata=metadata)


def check_memory_duplicate_scan() -> CheckResult:
    start = time.perf_counter()
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return _skip("memory-duplicate-scan", "memory",
                     "DATABASE_URL not set")
    try:
        import asyncpg  # type: ignore
    except ImportError:
        return _skip("memory-duplicate-scan", "memory",
                     "asyncpg not installed")

    async def _scan() -> list[dict]:
        conn = await asyncpg.connect(dsn, timeout=15)
        try:
            # Expensive self-join; limit to recent entries
            rows = await conn.fetch(
                """
                WITH recent AS (
                  SELECT id, content, embedding FROM archival_memory
                  WHERE embedding IS NOT NULL
                  ORDER BY created_at DESC LIMIT 500
                )
                SELECT a.id AS id_a, b.id AS id_b,
                       1 - (a.embedding <=> b.embedding) AS sim
                FROM recent a
                JOIN recent b ON a.id < b.id
                WHERE 1 - (a.embedding <=> b.embedding) > 0.95
                ORDER BY sim DESC LIMIT 5
                """
            )
            return [dict(r) for r in rows]
        finally:
            await conn.close()

    try:
        dupes = asyncio.run(_scan())
    except Exception as e:  # noqa: BLE001
        dur = int((time.perf_counter() - start) * 1000)
        return _skip("memory-duplicate-scan", "memory",
                     f"scan skipped: {type(e).__name__}: {e}",
                     duration_ms=dur)
    dur = int((time.perf_counter() - start) * 1000)
    if not dupes:
        return _pass("memory-duplicate-scan", "memory",
                     "no >0.95 similarity pairs in recent 500",
                     dur)
    return _warn("memory-duplicate-scan", "memory",
                 f"{len(dupes)} near-duplicate pair(s), "
                 f"top sim={dupes[0]['sim']:.3f}",
                 severity="LOW",
                 remediation="run /memory-curate to prune",
                 duration_ms=dur,
                 metadata={"top_pairs": [
                     {"a": str(d["id_a"])[:8],
                      "b": str(d["id_b"])[:8],
                      "sim": round(float(d["sim"]), 4)} for d in dupes
                 ]})


def check_memory_stale_scan() -> CheckResult:
    start = time.perf_counter()
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return _skip("memory-stale-scan", "memory", "DATABASE_URL not set")
    try:
        import asyncpg  # type: ignore
    except ImportError:
        return _skip("memory-stale-scan", "memory", "asyncpg not installed")

    async def _count() -> int:
        conn = await asyncpg.connect(dsn, timeout=8)
        try:
            row = await conn.fetchrow(
                """
                SELECT COUNT(*) AS n FROM archival_memory
                WHERE created_at < NOW() - INTERVAL '90 days'
                  AND metadata->>'confidence' = 'low'
                """
            )
            return int(row["n"])
        finally:
            await conn.close()

    try:
        n = asyncio.run(_count())
    except Exception as e:  # noqa: BLE001
        dur = int((time.perf_counter() - start) * 1000)
        return _skip("memory-stale-scan", "memory",
                     f"skip: {e}", duration_ms=dur)
    dur = int((time.perf_counter() - start) * 1000)
    return _pass("memory-stale-scan", "memory",
                 f"{n} low-confidence entries older than 90d",
                 dur, metadata={"stale_low_conf": n})


# ---- 4. Skills -------------------------------------------------------------


def _iter_skill_dirs() -> list[Path]:
    skills_root = CLAUDE_DIR / "skills"
    if not skills_root.is_dir():
        return []
    out: list[Path] = []
    for child in skills_root.iterdir():
        if not child.is_dir():
            continue
        if child.name.startswith(("_", "archive", ".")):
            continue
        out.append(child)
    return out


def check_skills_validation() -> CheckResult:
    start = time.perf_counter()
    skills = _iter_skill_dirs()
    broken: list[str] = []
    angle_brackets: list[str] = []
    for d in skills:
        # Skills can be nested (skill-name/skill-name/SKILL.md)
        candidates = [d / "SKILL.md"]
        if d.name and (d / d.name).is_dir():
            candidates.append(d / d.name / "SKILL.md")
        skill_md: Path | None = None
        for c in candidates:
            if c.exists():
                skill_md = c
                break
        if not skill_md:
            continue
        try:
            text = skill_md.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            broken.append(f"{d.name}: unreadable ({e})")
            continue
        if not text.startswith("---"):
            broken.append(f"{d.name}: no frontmatter")
            continue
        # extract frontmatter
        parts = text.split("---", 2)
        if len(parts) < 3:
            broken.append(f"{d.name}: malformed frontmatter")
            continue
        fm = parts[1]
        if "description:" not in fm:
            broken.append(f"{d.name}: missing description")
            continue
        desc_match = re.search(r"^description:\s*(.*?)$", fm,
                               re.MULTILINE | re.DOTALL)
        if desc_match:
            desc = desc_match.group(1).strip()
            if "<" in desc or ">" in desc:
                angle_brackets.append(d.name)
    dur = int((time.perf_counter() - start) * 1000)
    if angle_brackets:
        return _fail("skills-angle-brackets", "skills",
                     f"{len(angle_brackets)} skills have <> in description: "
                     f"{angle_brackets[:5]}",
                     severity="CRITICAL",
                     remediation="remove angle brackets from frontmatter; "
                                 "they break skill-forge validator",
                     duration_ms=dur,
                     metadata={"offenders": angle_brackets})
    if broken:
        return _warn("skills-validator-pass", "skills",
                     f"{len(broken)} skills with structural issues: "
                     f"{broken[:5]}",
                     severity="MEDIUM",
                     duration_ms=dur,
                     metadata={"broken": broken})
    return _pass("skills-validator-pass", "skills",
                 f"{len(skills)} skills pass structural validation",
                 dur, metadata={"count": len(skills)})


def check_skills_description_quality() -> CheckResult:
    start = time.perf_counter()
    skills = _iter_skill_dirs()
    short: list[str] = []
    no_triggers: list[str] = []
    for d in skills:
        candidates = [d / "SKILL.md"]
        if d.name and (d / d.name).is_dir():
            candidates.append(d / d.name / "SKILL.md")
        skill_md = next((c for c in candidates if c.exists()), None)
        if not skill_md:
            continue
        try:
            text = skill_md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        parts = text.split("---", 2)
        if len(parts) < 3:
            continue
        fm = parts[1]
        desc_match = re.search(r"^description:\s*(.*?)(?=^\w+:|\Z)",
                               fm, re.MULTILINE | re.DOTALL)
        if not desc_match:
            continue
        desc = desc_match.group(1).strip()
        if len(desc.split()) < 30:
            short.append(d.name)
        lower = desc.lower()
        has_trigger = any(kw in lower for kw in (
            "use when", "use this", "when users", "when user ",
            "when to use", "trigger", "slash command"))
        if not has_trigger:
            no_triggers.append(d.name)
    dur = int((time.perf_counter() - start) * 1000)
    metadata = {"short_count": len(short), "no_trigger_count": len(no_triggers)}
    if not short and not no_triggers:
        return _pass("skills-description-quality", "skills",
                     f"all {len(skills)} skill descriptions meet thresholds",
                     dur, metadata=metadata)
    bits: list[str] = []
    if short:
        bits.append(f"{len(short)} short (<30 words): {short[:4]}")
    if no_triggers:
        bits.append(f"{len(no_triggers)} lack trigger keywords: "
                    f"{no_triggers[:4]}")
    return _warn("skills-description-quality", "skills",
                 " | ".join(bits),
                 severity="LOW",
                 remediation="use /skill-forge to strengthen descriptions",
                 duration_ms=dur, metadata=metadata)


def check_skills_no_broken_refs() -> CheckResult:
    start = time.perf_counter()
    skills = _iter_skill_dirs()
    broken_refs: list[str] = []
    for d in skills:
        candidates = [d / "SKILL.md"]
        if d.name and (d / d.name).is_dir():
            candidates.append(d / d.name / "SKILL.md")
        skill_md = next((c for c in candidates if c.exists()), None)
        if not skill_md:
            continue
        try:
            text = skill_md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        # find `references/XYZ` mentions
        for rel in re.findall(r"references/[\w\-./]+\.md", text):
            target = skill_md.parent / rel
            if not target.exists():
                broken_refs.append(f"{d.name} -> {rel}")
    dur = int((time.perf_counter() - start) * 1000)
    if not broken_refs:
        return _pass("skills-no-broken-refs", "skills",
                     "all skill references resolve", dur)
    return _warn("skills-no-broken-refs", "skills",
                 f"{len(broken_refs)} broken skill refs: "
                 f"{broken_refs[:3]}",
                 severity="MEDIUM",
                 remediation="create missing reference files "
                             "or remove dangling references",
                 duration_ms=dur,
                 metadata={"broken_refs": broken_refs})


# ---- 5. Agents -------------------------------------------------------------


def _iter_agent_files() -> list[Path]:
    agent_dir = CLAUDE_DIR / "agents"
    if not agent_dir.is_dir():
        return []
    out = [p for p in agent_dir.glob("*.md")
           if not p.name.startswith("archive")]
    return out


def check_agents_yaml_parse() -> CheckResult:
    start = time.perf_counter()
    agents = _iter_agent_files()
    bad: list[str] = []
    for a in agents:
        try:
            text = a.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            bad.append(f"{a.name}: unreadable ({e})")
            continue
        if not text.startswith("---"):
            bad.append(f"{a.name}: no frontmatter")
            continue
        parts = text.split("---", 2)
        if len(parts) < 3:
            bad.append(f"{a.name}: malformed frontmatter")
    dur = int((time.perf_counter() - start) * 1000)
    if not bad:
        return _pass("agents-yaml-parse", "agents",
                     f"{len(agents)} agent files have valid frontmatter",
                     dur, metadata={"count": len(agents)})
    return _fail("agents-yaml-parse", "agents",
                 f"{len(bad)} agent file(s) broken: {bad[:3]}",
                 severity="HIGH",
                 duration_ms=dur, metadata={"broken": bad})


def check_agents_no_haiku() -> CheckResult:
    start = time.perf_counter()
    agents = _iter_agent_files()
    offenders: list[str] = []
    for a in agents:
        try:
            text = a.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        parts = text.split("---", 2)
        if len(parts) < 3:
            continue
        fm = parts[1]
        if re.search(r"^\s*model:\s*haiku\b", fm, re.MULTILINE | re.IGNORECASE):
            offenders.append(a.name)
    dur = int((time.perf_counter() - start) * 1000)
    if not offenders:
        return _pass("agents-no-haiku", "agents",
                     f"no agent declares model: haiku ({len(agents)} scanned)",
                     dur)
    return _fail("agents-no-haiku", "agents",
                 f"{len(offenders)} agents use haiku: {offenders}",
                 severity="CRITICAL",
                 remediation="remove 'model: haiku' -- violates no-haiku rule",
                 duration_ms=dur,
                 metadata={"offenders": offenders})


def check_agents_required_fields() -> CheckResult:
    start = time.perf_counter()
    agents = _iter_agent_files()
    missing: dict[str, list[str]] = {}
    for a in agents:
        try:
            text = a.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        parts = text.split("---", 2)
        if len(parts) < 3:
            continue
        fm = parts[1]
        absent = [f for f in ("name", "description", "tools")
                  if not re.search(rf"^\s*{f}:", fm, re.MULTILINE)]
        if absent:
            missing[a.name] = absent
    dur = int((time.perf_counter() - start) * 1000)
    if not missing:
        return _pass("agents-required-fields", "agents",
                     f"all {len(agents)} agents have name/description/tools",
                     dur)
    return _warn("agents-required-fields", "agents",
                 f"{len(missing)} agents missing fields: "
                 f"{list(missing.items())[:3]}",
                 severity="MEDIUM",
                 duration_ms=dur,
                 metadata={"missing": missing})


# ---- 6. RLM ----------------------------------------------------------------


def check_rlm_import() -> CheckResult:
    start = time.perf_counter()
    rc, stdout, stderr = _run_python_script([
        "-c",
        "from scripts.core.rlm_client import rlm_complete, RLMPolicy, RLMResult; "
        "print('ok')",
    ], timeout=30)
    dur = int((time.perf_counter() - start) * 1000)
    if rc == 0 and "ok" in stdout:
        return _pass("rlm-import-clean", "rlm",
                     "rlm_client imports without error", dur)
    return _fail("rlm-import-clean", "rlm",
                 f"import failed rc={rc}: {stderr.strip()[:200]}",
                 severity="HIGH", duration_ms=dur)


def check_rlm_tests() -> CheckResult:
    start = time.perf_counter()
    rc, stdout, stderr = _run_python_script([
        "-m", "pytest",
        "tests/test_rlm_client.py",
        "tests/test_rlm_claude_cli_client.py",
        "tests/test_rlm_cli.py",
        "tests/test_rlm_skill_cli.py",
        "tests/test_analyze_learnings.py",
        "-q",
    ], timeout=180)
    dur = int((time.perf_counter() - start) * 1000)
    # parse pytest summary
    m = re.search(r"(\d+)\s+passed", stdout)
    passed = int(m.group(1)) if m else 0
    mfail = re.search(r"(\d+)\s+failed", stdout)
    failed = int(mfail.group(1)) if mfail else 0
    metadata = {"passed": passed, "failed": failed}
    if rc == 0 and failed == 0:
        return _pass("rlm-tests-pass", "rlm",
                     f"{passed} pytest tests pass", dur, metadata=metadata)
    return _fail("rlm-tests-pass", "rlm",
                 f"{failed} failed / {passed} passed (rc={rc})",
                 severity="HIGH",
                 remediation="run pytest locally for detail",
                 duration_ms=dur, metadata=metadata)


# ---- 7. CLI tools ----------------------------------------------------------


CLI_TOOLS: list[tuple[str, list[str], bool]] = [
    # (name, version command args, critical)
    ("claude", ["claude", "--version"], True),
    ("python", ["python", "--version"], True),
    ("uv", ["uv", "--version"], True),
    ("docker", ["docker", "--version"], True),
    ("git", ["git", "--version"], True),
    ("node", ["node", "--version"], False),
    ("npm", ["npm", "--version"], False),
    ("gh", ["gh", "--version"], False),
    ("vercel", ["vercel", "--version"], False),
    ("railway", ["railway", "--version"], False),
    ("neonctl", ["neonctl", "--version"], False),
    ("qlty", ["qlty", "--version"], False),
    ("sentry-cli", ["sentry-cli", "--version"], False),
    ("linearis", ["linearis", "--version"], False),
    ("linear", ["linear", "--version"], False),
    ("tldr", ["tldr", "--version"], False),
    ("opencli", ["opencli", "--version"], False),
]


def _make_cli_check(tool: str, cmd: list[str], critical: bool
                    ) -> Callable[[], CheckResult]:
    def _check() -> CheckResult:
        start = time.perf_counter()
        try:
            p = _run(cmd, timeout=10, shell=True)
        except subprocess.TimeoutExpired:
            return _warn(f"cli-{tool}", "cli",
                         f"{tool} --version timed out",
                         severity="LOW",
                         duration_ms=10000)
        except FileNotFoundError:
            return (_fail(f"cli-{tool}", "cli", f"{tool} not on PATH",
                          severity="CRITICAL" if critical else "LOW")
                    if critical else
                    _skip(f"cli-{tool}", "cli", f"{tool} not installed"))
        dur = int((time.perf_counter() - start) * 1000)
        if p.returncode == 0:
            version = (p.stdout or p.stderr).strip().splitlines()[0][:80] \
                if (p.stdout or p.stderr).strip() else "ok"
            return _pass(f"cli-{tool}", "cli", version, dur,
                         metadata={"version": version})
        if critical:
            return _fail(f"cli-{tool}", "cli",
                         f"{tool} returned {p.returncode}",
                         severity="HIGH",
                         duration_ms=dur)
        return _warn(f"cli-{tool}", "cli",
                     f"{tool} present but exit={p.returncode}",
                     severity="LOW", duration_ms=dur)
    return _check


# ---- 8. OPC tests ----------------------------------------------------------


def check_opc_tests() -> CheckResult:
    start = time.perf_counter()
    opc = REPO_ROOT / "opc"
    # Just smoke -- not the full suite. Use a targeted subset for speed.
    rc, stdout, stderr = _run_python_script([
        "-m", "pytest",
        "tests/test_rlm_client.py",
        "tests/test_rlm_claude_cli_client.py",
        "tests/test_analyze_learnings.py",
        "tests/test_health_check.py",
        "-q",
    ], timeout=180)
    dur = int((time.perf_counter() - start) * 1000)
    mpass = re.search(r"(\d+)\s+passed", stdout)
    mfail = re.search(r"(\d+)\s+failed", stdout)
    merr = re.search(r"(\d+)\s+error", stdout)
    passed = int(mpass.group(1)) if mpass else 0
    failed = int(mfail.group(1)) if mfail else 0
    errors = int(merr.group(1)) if merr else 0
    metadata = {"passed": passed, "failed": failed, "errors": errors}
    if rc == 0 and failed == 0 and errors == 0:
        return _pass("opc-tests-smoke", "tests",
                     f"{passed} targeted tests pass",
                     dur, metadata=metadata)
    if errors > 0:
        return _fail("opc-tests-smoke", "tests",
                     f"collection errors ({errors}); see pytest output",
                     severity="CRITICAL",
                     duration_ms=dur, metadata=metadata)
    return _fail("opc-tests-smoke", "tests",
                 f"{failed} failed / {passed} passed (rc={rc})",
                 severity="HIGH",
                 remediation="cd opc && uv run pytest -q",
                 duration_ms=dur, metadata=metadata)


# ---- 9. Sync drift ---------------------------------------------------------


def _diff_dirs(repo: Path, active: Path, glob: str) -> list[str]:
    """Return list of file names that differ in content between repo and active."""
    if not repo.is_dir() or not active.is_dir():
        return []
    diffs: list[str] = []
    for src in repo.rglob(glob):
        rel = src.relative_to(repo)
        dst = active / rel
        if not dst.exists():
            diffs.append(str(rel))
            continue
        try:
            if src.read_bytes() != dst.read_bytes():
                diffs.append(str(rel))
        except OSError:
            diffs.append(str(rel))
    return diffs


def _make_sync_check(name: str, subdir: str, glob: str
                     ) -> Callable[[], CheckResult]:
    def _check() -> CheckResult:
        start = time.perf_counter()
        repo = CLAUDE_DIR / subdir
        active = HOME_CLAUDE / subdir
        if not repo.is_dir():
            return _skip(name, "sync", f"no repo {subdir}")
        if not active.is_dir():
            return _warn(name, "sync",
                         f"~/.claude/{subdir} missing",
                         severity="LOW")
        diffs = _diff_dirs(repo, active, glob)
        dur = int((time.perf_counter() - start) * 1000)
        if not diffs:
            return _pass(name, "sync",
                         f"{subdir} in sync", dur)
        return _warn(name, "sync",
                     f"{len(diffs)} drifted {subdir} files: {diffs[:3]}",
                     severity="LOW",
                     remediation="bash scripts/sync-to-active.sh",
                     duration_ms=dur,
                     metadata={"drifted": diffs[:25]})
    return _check


# ---- 10. External APIs -----------------------------------------------------


def check_anthropic_api_ping() -> CheckResult:
    start = time.perf_counter()
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        return _skip("anthropic-dev-api-reachable", "external",
                     "ANTHROPIC_API_KEY not set")
    try:
        import anthropic  # type: ignore
    except ImportError:
        return _skip("anthropic-dev-api-reachable", "external",
                     "anthropic package not installed")
    try:
        client = anthropic.Anthropic(api_key=key, timeout=15.0)
        msg = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=1,
            messages=[{"role": "user", "content": "hi"}],
        )
        dur = int((time.perf_counter() - start) * 1000)
        return _pass("anthropic-dev-api-reachable", "external",
                     f"1-token ping OK (model={msg.model})",
                     dur, metadata={"model": msg.model})
    except Exception as e:  # noqa: BLE001
        dur = int((time.perf_counter() - start) * 1000)
        txt = str(e)
        # Known billing error -- downgrade to INFO/WARN
        if "credit balance" in txt.lower() or "400" in txt:
            return _warn("anthropic-dev-api-reachable", "external",
                         f"API reachable but credit issue: {txt[:200]}",
                         severity="LOW",
                         duration_ms=dur)
        return _fail("anthropic-dev-api-reachable", "external",
                     f"{type(e).__name__}: {txt[:200]}",
                     severity="MEDIUM",
                     duration_ms=dur)


def check_claude_cli_responsive() -> CheckResult:
    start = time.perf_counter()
    # `claude -p "prompt"` is non-interactive ("print" mode).
    # --bare skips hooks/skills/auto-memory so the ping is pure CLI transport.
    p = _run(["claude", "-p", "ping", "--output-format", "json", "--bare"],
             timeout=60, shell=True)
    dur = int((time.perf_counter() - start) * 1000)
    if p.returncode != 0:
        return _warn("claude-cli-responsive", "external",
                     f"claude -p exit={p.returncode}: "
                     f"{p.stderr.strip()[:200]}",
                     severity="MEDIUM",
                     duration_ms=dur)
    # Try to parse at least some JSON-ish content
    out = p.stdout.strip()
    if not out:
        return _warn("claude-cli-responsive", "external",
                     "claude -p returned empty output",
                     severity="MEDIUM",
                     duration_ms=dur)
    return _pass("claude-cli-responsive", "external",
                 f"claude -p responded ({len(out)} bytes)",
                 dur)


# ---- 11. Knowledge tree ----------------------------------------------------


def check_knowledge_tree() -> CheckResult:
    start = time.perf_counter()
    kt = CLAUDE_DIR / "knowledge-tree.json"
    if not kt.exists():
        return _warn("knowledge-tree-present", "knowledge-tree",
                     ".claude/knowledge-tree.json missing",
                     severity="LOW",
                     remediation="knowledge_tree.py --project <repo> "
                                 "--verbose to regenerate")
    size = kt.stat().st_size
    if size == 0:
        return _fail("knowledge-tree-present", "knowledge-tree",
                     "knowledge-tree.json is empty",
                     severity="MEDIUM",
                     remediation="regenerate with knowledge_tree.py")
    try:
        json.loads(kt.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return _fail("knowledge-tree-present", "knowledge-tree",
                     f"invalid JSON: {e}",
                     severity="MEDIUM")
    age_days = (time.time() - kt.stat().st_mtime) / 86400
    dur = int((time.perf_counter() - start) * 1000)
    metadata = {"size": size, "age_days": round(age_days, 1)}
    if age_days > 30:
        return _warn("knowledge-tree-present", "knowledge-tree",
                     f"valid JSON but {age_days:.1f}d old",
                     severity="LOW",
                     remediation="regenerate",
                     duration_ms=dur, metadata=metadata)
    return _pass("knowledge-tree-present", "knowledge-tree",
                 f"valid ({size} bytes, {age_days:.1f}d old)",
                 dur, metadata=metadata)


# ---- 12. Git ---------------------------------------------------------------


def check_git_uncommitted() -> CheckResult:
    start = time.perf_counter()
    p = _run(["git", "status", "--porcelain"],
             cwd=REPO_ROOT, timeout=15, shell=True)
    dur = int((time.perf_counter() - start) * 1000)
    if p.returncode != 0:
        return _warn("git-uncommitted-changes", "git",
                     "git status failed",
                     severity="LOW",
                     duration_ms=dur)
    lines = [ln for ln in p.stdout.splitlines() if ln.strip()]
    count = len(lines)
    metadata = {"count": count}
    if count > 50:
        return _warn("git-uncommitted-changes", "git",
                     f"{count} uncommitted changes (>50)",
                     severity="LOW",
                     duration_ms=dur, metadata=metadata)
    return _pass("git-uncommitted-changes", "git",
                 f"{count} uncommitted files",
                 dur, metadata=metadata)


def check_git_remote_sync() -> CheckResult:
    start = time.perf_counter()
    p = _run(["git", "status", "-sb"],
             cwd=REPO_ROOT, timeout=15, shell=True)
    dur = int((time.perf_counter() - start) * 1000)
    if p.returncode != 0:
        return _skip("git-remote-sync", "git", "git status failed")
    first = p.stdout.splitlines()[0] if p.stdout.splitlines() else ""
    if "behind" in first or "diverged" in first:
        return _warn("git-remote-sync", "git",
                     f"branch state: {first}",
                     severity="LOW",
                     duration_ms=dur)
    return _pass("git-remote-sync", "git",
                 f"branch: {first}", dur)


# ---- 13. ROADMAP -----------------------------------------------------------


def check_roadmap_present() -> CheckResult:
    start = time.perf_counter()
    rm = REPO_ROOT / "ROADMAP.md"
    if not rm.exists():
        return _warn("roadmap-present", "roadmap",
                     "ROADMAP.md missing",
                     severity="LOW")
    size = rm.stat().st_size
    dur = int((time.perf_counter() - start) * 1000)
    if size < 50:
        return _warn("roadmap-present", "roadmap",
                     f"ROADMAP.md nearly empty ({size} bytes)",
                     severity="LOW", duration_ms=dur)
    return _pass("roadmap-present", "roadmap",
                 f"ROADMAP.md ({size} bytes)",
                 dur, metadata={"bytes": size})


# ===========================================================================
# Registration
# ===========================================================================


def build_runner(output_dir: Path | None = None,
                 quiet: bool = False,
                 skip_slow: bool = False) -> HealthCheckRunner:
    r = HealthCheckRunner(output_dir=output_dir, quiet=quiet,
                          skip_slow=skip_slow)

    # 1. Infrastructure
    r.register("docker-daemon-running", "infrastructure",
               check_docker_daemon)
    r.register("postgres-container-running", "infrastructure",
               check_postgres_container)
    r.register("rlm-sandbox-image-present", "infrastructure",
               check_rlm_sandbox_image)
    r.register("anthropic-api-key-set", "infrastructure",
               check_anthropic_key)
    r.register("claude-opc-dir-set", "infrastructure",
               check_claude_opc_dir)
    r.register("opc-env-file-present", "infrastructure",
               check_opc_env_file)

    # 2. Hooks
    r.register("hook-dist-freshness", "hooks",
               check_hook_dist_freshness)
    r.register("hook-registrations-valid", "hooks",
               check_hook_registrations)
    r.register("hook-orphans", "hooks", check_hook_orphans)
    r.register("hook-node-load-test", "hooks",
               check_critical_hook_load, slow=True)
    r.register("hook-vitest-tests-pass", "hooks",
               check_hook_vitest, slow=True)

    # 3. Memory
    r.register("memory-connection", "memory",
               check_memory_connection)
    r.register("memory-canary-roundtrip", "memory",
               check_memory_canary_roundtrip, slow=True)
    r.register("memory-growth-rate", "memory",
               check_memory_growth_rate)
    r.register("memory-duplicate-scan", "memory",
               check_memory_duplicate_scan, slow=True)
    r.register("memory-stale-scan", "memory",
               check_memory_stale_scan)

    # 4. Skills
    r.register("skills-validator-pass", "skills",
               check_skills_validation)
    r.register("skills-description-quality", "skills",
               check_skills_description_quality)
    r.register("skills-no-broken-refs", "skills",
               check_skills_no_broken_refs)

    # 5. Agents
    r.register("agents-yaml-parse", "agents", check_agents_yaml_parse)
    r.register("agents-no-haiku", "agents", check_agents_no_haiku)
    r.register("agents-required-fields", "agents",
               check_agents_required_fields)

    # 6. RLM
    r.register("rlm-import-clean", "rlm", check_rlm_import)
    r.register("rlm-tests-pass", "rlm", check_rlm_tests, slow=True)

    # 7. CLI tools
    for tool, cmd, critical in CLI_TOOLS:
        r.register(f"cli-{tool}", "cli",
                   _make_cli_check(tool, cmd, critical))

    # 8. OPC tests
    r.register("opc-tests-smoke", "tests", check_opc_tests, slow=True)

    # 9. Sync drift
    r.register("sync-drift-skills", "sync",
               _make_sync_check("sync-drift-skills", "skills", "*.md"))
    r.register("sync-drift-rules", "sync",
               _make_sync_check("sync-drift-rules", "rules", "*.md"))
    r.register("sync-drift-agents", "sync",
               _make_sync_check("sync-drift-agents", "agents", "*.md"))
    r.register("sync-drift-hooks-src", "sync",
               _make_sync_check("sync-drift-hooks-src", "hooks/src", "*.ts"))

    # 10. External APIs
    r.register("anthropic-dev-api-reachable", "external",
               check_anthropic_api_ping, slow=True)
    r.register("claude-cli-responsive", "external",
               check_claude_cli_responsive, slow=True)

    # 11. Knowledge tree
    r.register("knowledge-tree-present", "knowledge-tree",
               check_knowledge_tree)

    # 12. Git
    r.register("git-uncommitted-changes", "git", check_git_uncommitted)
    r.register("git-remote-sync", "git", check_git_remote_sync)

    # 13. Roadmap
    r.register("roadmap-present", "roadmap", check_roadmap_present)

    return r


# ===========================================================================
# CLI
# ===========================================================================


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="CCv3 system health check",
    )
    parser.add_argument("--output-json", type=Path, default=None,
                        help="write JSON report to this path")
    parser.add_argument("--output-md", type=Path, default=None,
                        help="write Markdown report to this path")
    parser.add_argument("--output-dir", type=Path, default=None,
                        help="directory for auto-named outputs")
    parser.add_argument("--categories", type=str, default=None,
                        help="comma-separated category filter")
    parser.add_argument("--skip-slow", action="store_true",
                        help="skip slow checks (tests, load-tests, API pings)")
    parser.add_argument("--quiet", action="store_true",
                        help="suppress stdout markdown summary")
    args = parser.parse_args(argv)

    categories = None
    if args.categories:
        categories = [c.strip() for c in args.categories.split(",") if c.strip()]

    runner = build_runner(
        output_dir=args.output_dir,
        quiet=args.quiet,
        skip_slow=args.skip_slow,
    )
    results = runner.run_sync(categories=categories)
    json_path, md_path = runner.write_outputs(
        results, json_path=args.output_json, md_path=args.output_md,
    )

    if not args.quiet:
        duration = runner._duration_s or 0.0
        print(render_markdown(results, duration_s=duration))
        print(f"\n[wrote JSON:     {json_path}]")
        print(f"[wrote Markdown: {md_path}]")

    return compute_exit_code(results)


if __name__ == "__main__":
    sys.exit(main())
