# Codex Cross-Model Pass 2 — Shell-Flow Security Audit (STOPPED — partial)

**Status:** STOPPED. The `codex exec` security pass ran abnormally long (live `codex.exe` from 08:11, >18 min vs the 45-120s norm — likely the multi-agent/gpt-4.1 slow path despite `--disable multi_agent`) and was halted to avoid blocking the deliverable indefinitely. No clean findings file was produced.

**Security cross-model coverage is therefore PARTIAL, served by:**
- **Codex pass 1** (completed, `codex-pass1-ledger.md`) already audited the injection family directly at the live SHA and contributed security-relevant cross-model lift: the `execSync`-always-shells correction (fix = `execSync`→`spawnSync` array-args across all 3 store_learning hooks), the `smart-search-router` ripgrepFallback **Windows-self-limiting** behavior (the `2>/dev/null` POSIX redirect passes literally to `rg` on cmd.exe → early failure), and the **permission-auto-allow + injection = zero user circuit-breaker** compound risk (auto-allow removal is a *precondition* for the injection fixes).
- **Claude WF-1 dimensions** D5a (junk-creator named), D5b (sanitizer-coverage gap + compiler/typescript-preflight path interpolation), D2c-04 / D3a-01 / D2d-06 (the store_learning execSync family), D2b-10 / GAP4-01 / GAP4-02 (Grep-pattern → execSync / daemon-client double-shell), and the SQL-clean verdict on `opc/scripts/core/*.py` — all WF-2-confirmed.

**Residual gap:** no independent gpt-5.5 grep-sweep for *net-new* shell sites beyond the Claude-listed set. Recommend a focused re-run of the security pass (smaller scope, `--disable multi_agent` verified, shorter timeout) as a follow-up if a clean cross-model security sweep is wanted before the Phase-4 injection fixes ship.
