# Browser Automation Research Report

**Date:** 2026-03-12
**Author:** architect-agent
**Status:** Final synthesis of three research threads (scout, oracle, pathfinder)

---

## 1. Executive Summary

Our current browser automation stack is a mature three-tier architecture built on Playwright MCP, Chrome DevTools MCP, and Playwright-core CDP scripts, covering navigation, interaction, testing, performance profiling, and advanced automation. Lightpanda is an emerging Zig-based headless browser optimized for AI workloads -- fast DOM extraction and structured data -- but it cannot take screenshots, render visuals, or evade bot detection, and it has no native Windows support. **The recommendation is to add Lightpanda as a narrow Tier 0 (fast headless scraping) alongside the existing stack, deployed via Docker on Windows, while retaining Playwright as the primary automation engine for all visual, testing, and interactive tasks.** Adoption should be gated on a proof-of-concept that validates stability and performance claims against our actual workloads.

---

## 2. Current Browser Automation Stack

### 2.1 MCP Servers

| Server | Transport | Tool Count | Role |
|--------|-----------|------------|------|
| `@playwright/mcp` | stdio (`cmd /c npx -y @playwright/mcp@latest`) | ~70+ | PRIMARY -- navigation, interaction, screenshots, accessibility, forms, tabs, dialogs, PDF |
| `chrome-devtools` MCP | stdio (`cmd /c npx -y chrome-devtools-mcp@latest`) | 26 | SECONDARY -- performance traces, network bodies, computed CSS, console, Core Web Vitals |

### 2.2 Skills

| Skill | Status | Purpose |
|-------|--------|---------|
| `browser-dev-cycle` | **ACTIVE (PRIMARY)** | Three-tier strategy orchestrator |
| `full-test-suite` | **ACTIVE** | Playwright-core CDP testing with 100-point scoring model |
| `claude-in-chrome` | DEPRECATED | 6+ Windows 11 bugs; only unique capability was GIF recording |
| `agent-browser` | DEPRECATED | Windows daemon broken (Unix socket dependency) |

### 2.3 Three-Tier Architecture

```
Tier 1: @playwright/mcp          -- 80% of tasks (nav, click, type, screenshot, a11y)
Tier 2: Chrome DevTools MCP      -- Performance, network, CSS debugging
Tier 3: Playwright-core CDP      -- Advanced: mocking, video, state save/restore, emulation
```

This architecture is documented in the `browser-dev-cycle` skill and enforced by the `browser-automation.md` rule file. It handles the full spectrum from simple page reads to complex multi-step testing workflows.

### 2.4 Capability Coverage

| Capability | Tier 1 | Tier 2 | Tier 3 |
|---|:---:|:---:|:---:|
| Navigation | YES | Via eval | YES |
| Click/Type | YES | -- | YES |
| Screenshots | YES | YES | YES |
| Accessibility tree | YES | YES | YES |
| Form filling | YES | -- | YES |
| Tab management | YES | -- | YES |
| JS evaluation | YES | YES | YES |
| Network request list | -- | YES (+ bodies) | YES |
| Network mocking | -- | -- | YES |
| Performance traces | -- | YES | -- |
| Core Web Vitals | -- | YES | -- |
| Console output | -- | YES | YES |
| Computed CSS | -- | YES | YES |
| HAR recording | -- | YES | YES |
| Video recording | -- | -- | YES |
| State save/restore | -- | -- | YES |
| Device emulation | -- | -- | YES |
| Dialog handling | YES | -- | YES |
| PDF generation | YES | -- | YES |

### 2.5 Known Gaps

- **GIF recording**: Lost when `claude-in-chrome` was deprecated. No current replacement.
- **Network mocking**: Tier 3 only (manual Playwright-core scripting). Not available through MCP.
- **Performance profiling**: Requires manually launching Chrome with `--remote-debugging-port=9222`.
- **Cookie/localStorage management**: Tier 3 only.
- **Device emulation**: Tier 3 only.

---

## 3. Lightpanda Technical Assessment

### 3.1 Architecture

| Component | Technology | Notes |
|-----------|-----------|-------|
| Language | Zig (0.15.2) | Systems language, manual memory management |
| JavaScript engine | V8 (via rusty_v8 C headers bridge) | Full JS execution |
| HTML parser | html5ever (Rust) | Standards-compliant |
| DOM | Custom "zigdom" | Arena allocator per page |
| Rendering engine | **NONE** | No visual rendering whatsoever |
| Protocol | CDP subset (automation domains) | Puppeteer/Playwright compatible (with caveats) |

**[VERIFIED from source]** The absence of a rendering engine is architectural, not a missing feature. Lightpanda is designed as a DOM-only headless browser for data extraction and AI workloads.

### 3.2 Capabilities

**What it CAN do:**
- Fast DOM construction and traversal
- JavaScript execution (V8)
- CDP-based automation (navigation, element queries, JS evaluation)
- Markdown extraction (`LP.getMarkdown`)
- Structured data extraction (`LP.getStructuredData`)
- Interactive element discovery (`LP.getInteractiveElements`)
- Accessibility tree extraction (Stagehand compatibility)
- Compressed semantic tree format

**What it CANNOT do:**
- Screenshots, PDFs, or any visual output
- Pixel-coordinate interactions
- Visual layout computation (CSS rendering)
- Bot detection evasion (trivially detectable)
- Multiple simultaneous CDP connections (1 per process)
- Full Web API coverage (missing AbortController, others)

### 3.3 Performance Claims

| Metric | Lightpanda Claim | Verification |
|--------|-----------------|--------------|
| Execution speed | 11x faster than Chromium | **[UNVERIFIED]** Lightpanda own benchmarks only |
| Memory usage | 9x less (24MB vs 207MB) | **[UNVERIFIED]** No third-party validation |
| Startup time | 30x faster (0.1s vs 3-4s) | **[PLAUSIBLE]** Consistent with no-rendering architecture |
| Docker image | ~61MB | **[VERIFIED]** from Docker Hub |

The speed and memory claims are plausible given the architecture (no rendering engine, arena allocator, Zig performance characteristics), but no independent benchmarks exist. The startup time claim is the most credible -- skipping Chromium initialization is a known win.

### 3.4 MCP Integration Paths

| Path | Transport | Maturity | Notes |
|------|-----------|----------|-------|
| Built-in (`lightpanda mcp`) | stdio | v0.2.5+ | 4 tools: goto, evaluate, interactiveElements, structuredData |
| gomcp (Go wrapper) | stdio + SSE | 57 stars | Auto-downloads binary, documented Claude Desktop config |
| Cloud | SSE | Available | euwest/uswest endpoints, search/goto/markdown/links tools |

### 3.5 Maturity Assessment

| Signal | Value | Interpretation |
|--------|-------|---------------|
| GitHub stars | ~12,900 | High interest, low adoption |
| Contributors | 22 | Small team |
| Commits/week | 84 | Very active development |
| Binary downloads | ~2,139 total | **Very low real-world usage** |
| Funding | Pre-seed (ISAI, Kima) | Early stage |
| License | AGPL-3.0 | Copyleft -- see Risk section |
| Known issues | Segfaults on some sites, partial SPA support | Beta-quality stability |

---

## 4. Comparison Matrix

| Dimension | Current Stack (Playwright + CDP) | Lightpanda |
|-----------|--------------------------------|------------|
| **Visual rendering** | Full Chromium | None |
| **Screenshots/PDF** | YES (Tier 1) | NO |
| **DOM extraction** | YES (all tiers) | YES (faster, purpose-built) |
| **Markdown output** | Via JS eval / parsing | Native (`LP.getMarkdown`) |
| **Structured data** | Manual extraction | Native (`LP.getStructuredData`) |
| **JavaScript execution** | Full V8 (Chromium) | V8 (standalone) |
| **SPA support** | Full | Partial (missing Web APIs) |
| **Bot detection evasion** | Good (real Chromium fingerprint) | Poor (trivially detectable) |
| **Performance** | Baseline (~400MB, 3-4s startup) | Claimed 11x faster, 9x less memory |
| **Network mocking** | YES (Tier 3) | NO |
| **Performance profiling** | YES (Tier 2, CDP) | NO |
| **Device emulation** | YES (Tier 3) | NO |
| **Multi-connection** | Unlimited tabs/contexts | 1 CDP connection per process |
| **Windows native** | YES | NO (Docker/WSL2 only) |
| **MCP integration** | Mature (70+ tools) | Early (4-6 tools) |
| **Maturity** | Production-grade | Beta |
| **License** | Apache 2.0 / MIT | AGPL-3.0 |
| **Community** | Massive (Playwright: 70K+ stars) | Growing (12.9K stars) |

---

## 5. Use Case Analysis

### 5.1 Web Scraping / Data Extraction

**Winner: Lightpanda (with caveats)**

| Factor | Playwright | Lightpanda |
|--------|-----------|------------|
| Speed for bulk scraping | Baseline | Significantly faster (plausible) |
| Memory per page | ~200MB | ~24MB (claimed) |
| Parallel scraping | Memory-limited | More pages per GB |
| JavaScript-rendered content | Full support | Full V8 support |
| Bot-protected sites | Better (real Chrome) | Poor (easily blocked) |
| Structured output | Manual parsing | Native markdown/structured data |

**Verdict:** For scraping sites that do not employ bot detection (internal tools, APIs, documentation sites, public data), Lightpanda speed and memory advantages are compelling. For bot-protected sites (e-commerce, social media), Playwright with a real Chromium fingerprint remains necessary.

### 5.2 UI Testing

**Winner: Current Stack (decisively)**

| Factor | Playwright | Lightpanda |
|--------|-----------|------------|
| Visual regression | YES (screenshots) | IMPOSSIBLE |
| Layout verification | YES (computed styles) | NO |
| Cross-browser testing | YES | NO |
| Performance metrics | YES (Core Web Vitals) | NO |
| Form interaction | Full | Limited |
| Device emulation | YES | NO |
| Video recording | YES | NO |
| Network mocking | YES | NO |

**Verdict:** Lightpanda cannot participate in UI testing. It has no rendering engine -- it cannot verify that something *looks* correct, only that the DOM is structured correctly. Our `full-test-suite` skill 100-point scoring model requires screenshots, performance metrics, and visual validation that Lightpanda fundamentally cannot provide.

### 5.3 Autonomous Agent Web Actions

**Winner: Current Stack (with Lightpanda as accelerator)**

| Factor | Playwright | Lightpanda |
|--------|-----------|------------|
| Page understanding (DOM) | YES | YES (faster) |
| Accessibility tree | YES | YES |
| Visual understanding | YES (screenshots) | NO |
| Form filling | YES | Limited |
| Multi-step workflows | YES (state management) | Limited (1 connection) |
| Error recovery | Mature patterns | Minimal |
| Interactive elements | Via a11y snapshot | Native `getInteractiveElements` |

**Verdict:** Autonomous agent actions need both DOM understanding AND visual verification. The current Playwright MCP stack handles this well -- the accessibility snapshot approach in `@playwright/mcp` already provides structured page understanding. Lightpanda could serve as a *pre-fetch* layer: quickly extracting page structure and interactive elements before Playwright handles the actual interaction. But it cannot replace Playwright for actions that require visual confirmation (clicking the right button, verifying a form submitted, checking page state).

---

## 6. Architecture Recommendation

### Proposed: Add Lightpanda as Tier 0

```
Tier 0: Lightpanda (Docker)      -- NEW: Fast headless scraping, markdown extraction, bulk data
Tier 1: @playwright/mcp          -- PRIMARY: Navigation, interaction, screenshots, a11y (unchanged)
Tier 2: Chrome DevTools MCP      -- Performance, network, CSS debugging (unchanged)
Tier 3: Playwright-core CDP      -- Advanced: mocking, video, state save/restore (unchanged)
```

**Tier 0 scope is narrow and well-defined:**
- Bulk page scraping where bot detection is not a concern
- Markdown extraction from documentation sites
- Structured data extraction from known page formats
- Pre-fetching page structure for agent workflows (interactive elements, semantic tree)
- Any workload where visual rendering is irrelevant

**Tier 0 does NOT replace any existing tier.** It is additive -- a fast path for the subset of tasks where DOM-only processing is sufficient.

### Decision Framework

```
Task arrives
  |
  +-- Needs visual output (screenshot, PDF, video)?
  |     YES --> Tier 1/2/3 (Playwright)
  |
  +-- Needs bot detection evasion?
  |     YES --> Tier 1 (Playwright with real Chromium)
  |
  +-- Needs performance profiling?
  |     YES --> Tier 2 (Chrome DevTools)
  |
  +-- Needs network mocking / device emulation?
  |     YES --> Tier 3 (Playwright-core CDP)
  |
  +-- Pure data extraction / markdown / structured data?
        YES --> Tier 0 (Lightpanda) -- fast path
```

### What NOT to Do

- **Do not replace Playwright with Lightpanda.** The capability gap is too large.
- **Do not use Lightpanda for testing.** It cannot verify visual correctness.
- **Do not use Lightpanda on bot-protected sites.** It will be blocked immediately.
- **Do not depend on Lightpanda for production-critical paths.** Beta maturity, low real-world usage, potential for segfaults.

---

## 7. Integration Path

### 7.1 Docker Setup (Windows 11)

Lightpanda has no native Windows binary. Docker is the only viable path.

```bash
# Pull the nightly image (~61MB)
docker pull lightpanda/browser:nightly

# Run with CDP exposed on port 9223 (not 9222, to avoid Chrome DevTools conflict)
docker run -d --name lightpanda -p 9223:9222 lightpanda/browser:nightly

# Verify it is running
curl http://localhost:9223/json/version
```

**Resource requirements:** 512MB RAM sufficient. Minimal CPU. Can coexist with existing Docker services (continuous-claude-postgres, etc.).

**Port note:** Port 9222 conflicts with Chrome DevTools debugging. Map Lightpanda to port **9223** to avoid conflicts.

### 7.2 MCP Configuration

Add to `~/.mcp.json` (highest priority MCP config):

```json
{
  "mcpServers": {
    "lightpanda": {
      "command": "docker",
      "args": ["exec", "-i", "lightpanda", "lightpanda", "mcp"]
    }
  }
}
```

Alternative using gomcp (if the Go wrapper supports remote connection):

```json
{
  "mcpServers": {
    "lightpanda": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "gomcp-lightpanda@latest"],
      "env": {
        "LIGHTPANDA_URL": "ws://localhost:9223"
      }
    }
  }
}
```

**Note:** The gomcp wrapper auto-downloads the binary, which will not work on Windows natively. If using gomcp, it must connect to the Docker-hosted Lightpanda instance via WebSocket, not a local binary.

### 7.3 Skill File

Create `.claude/skills/lightpanda-scraper/SKILL.md` with triggers for bulk scraping, markdown extraction, and structured data tasks. Route to Tier 1 (Playwright) as fallback for any task requiring visual output or bot evasion.

### 7.4 Docker Compose Integration

Add to existing `~/.claude/docker/docker-compose.yml`:

```yaml
services:
  lightpanda:
    image: lightpanda/browser:nightly
    container_name: lightpanda
    ports:
      - "9223:9222"
    mem_limit: 512m
    restart: unless-stopped
```

This ensures Lightpanda starts alongside the existing PostgreSQL container.

---

## 8. Risks & Mitigations

### 8.1 AGPL-3.0 License

| Aspect | Detail |
|--------|--------|
| **Risk** | AGPL-3.0 is copyleft. If Lightpanda code is modified and deployed as a network service, modifications must be open-sourced. |
| **Our exposure** | LOW. We use Lightpanda as a Docker container via CDP/MCP -- no code modification, no embedding in our applications. We connect to it as an external service. |
| **Mitigation** | Do not fork or modify Lightpanda source. Do not embed its libraries. Use only via Docker + CDP/MCP protocol. This is standard "using a tool" usage. |
| **Escalation** | If ever considering embedding Lightpanda in a product, consult legal. For internal tooling use, AGPL is not a concern. |

### 8.2 Windows Support

| Aspect | Detail |
|--------|--------|
| **Risk** | No native Windows binary. Docker adds a layer of indirection. |
| **Impact** | Minor latency overhead. Docker Desktop must be running. |
| **Mitigation** | Docker is already a dependency (PostgreSQL). The 61MB image is trivial. Map to docker-compose for auto-start. |
| **Tracking** | GitHub issue #369 tracks native Windows support. Monitor quarterly. |

### 8.3 Maturity & Stability

| Aspect | Detail |
|--------|--------|
| **Risk** | Beta software. ~2,139 total binary downloads. Known segfaults on some sites. Partial SPA support. |
| **Impact** | Cannot be relied upon for production-critical paths. May produce incorrect DOM for complex SPAs. |
| **Mitigation** | Use only for Tier 0 (non-critical scraping). Always have Playwright as fallback. Implement try/catch with automatic fallback to Tier 1 on Lightpanda failure. Pin to specific image tags, not nightly. |

### 8.4 Performance Claims

| Aspect | Detail |
|--------|--------|
| **Risk** | 11x/9x/30x claims are from Lightpanda own benchmarks with no independent verification. |
| **Impact** | If performance gains are overstated, the primary value proposition weakens. |
| **Mitigation** | Run our own benchmarks during PoC phase. Compare Lightpanda markdown extraction vs Playwright-based extraction on 10 representative pages. Measure wall-clock time, memory, and output quality. |

### 8.5 Single CDP Connection Limit

| Aspect | Detail |
|--------|--------|
| **Risk** | Lightpanda supports only 1 CDP connection per process. |
| **Impact** | Cannot run parallel scraping within a single instance. |
| **Mitigation** | For parallel workloads, run multiple Docker containers (trivial given 24MB memory per instance). Or use sequential scraping -- still fast given the startup time advantage. |

### 8.6 Missing Web APIs

| Aspect | Detail |
|--------|--------|
| **Risk** | Missing AbortController, partial Fetch API, other Web APIs. |
| **Impact** | SPAs that depend on these APIs will not render correctly. Data extraction will be incomplete or incorrect. |
| **Mitigation** | Validate each target site works with Lightpanda before adding to automated workflows. Maintain a tested-sites list. Fall back to Playwright for sites that fail. |

---

## 9. Next Steps

### Phase 1: Proof of Concept (1-2 hours)

- [ ] Pull Lightpanda Docker image: `docker pull lightpanda/browser:nightly`
- [ ] Add to `docker-compose.yml` on port 9223
- [ ] Verify CDP connectivity: `curl http://localhost:9223/json/version`
- [ ] Test 5 representative pages:
  - A documentation site (e.g., MDN, Next.js docs)
  - A static marketing page
  - A React SPA (test SPA compatibility)
  - A site with heavy JavaScript
  - An internal tool page
- [ ] Compare against Playwright on same 5 pages: wall-clock time, memory, output quality
- [ ] Document which pages work and which fail

### Phase 2: Integration (if PoC passes) (1-2 hours)

- [ ] Create `lightpanda-scraper` skill file
- [ ] Add MCP server configuration
- [ ] Update `browser-dev-cycle` skill to reference Tier 0
- [ ] Add Lightpanda to `browser-automation.md` rules
- [ ] Update port registry (`dev-server-cleanup.md`)

### Phase 3: Monitoring (ongoing)

- [ ] Track Lightpanda releases quarterly (stability improvements, Windows support, Web API additions)
- [ ] Monitor GitHub issue #369 (native Windows binary)
- [ ] Re-evaluate if/when Lightpanda reaches v1.0 stable
- [ ] Re-assess if a competitor emerges with similar speed but better compatibility

### Decision Gate

**Proceed with Phase 2 only if the PoC demonstrates:**
1. At least 3 of 5 test pages produce correct, usable output
2. Measurable speed improvement over Playwright for DOM extraction (at least 3x)
3. Docker container runs stably for 1 hour without segfaults
4. Markdown/structured data output quality is comparable to manual Playwright extraction

**Abort if:**
- Fewer than 3 test pages work correctly
- Speed improvement is less than 2x
- Container crashes within the test period
- Output quality is significantly worse than Playwright

---

## Appendix A: Tool Count Summary

| System | MCP Tools | Capabilities |
|--------|-----------|-------------|
| @playwright/mcp | ~70+ | Full browser automation |
| Chrome DevTools MCP | 26 | Performance, network, CSS |
| Playwright-core CDP | N/A (scripting) | Advanced automation |
| Lightpanda built-in MCP | 4 | goto, evaluate, interactiveElements, structuredData |
| Lightpanda gomcp | ~6 | goto, evaluate, markdown, links, search, structuredData |
| Lightpanda cloud | 4 | search, goto, markdown, links |

## Appendix B: Resource Comparison

| Resource | Playwright (Chromium) | Lightpanda |
|----------|----------------------|------------|
| Docker image size | ~400MB+ | ~61MB |
| RAM per instance | ~200MB | ~24MB (claimed) |
| Startup time | 3-4 seconds | ~0.1 seconds (claimed) |
| Disk footprint (native) | ~400MB | N/A on Windows |
| Docker footprint | ~1GB+ | ~61MB |

## Appendix C: References

- Lightpanda GitHub: https://github.com/lightpanda-io/browser
- Lightpanda gomcp: https://github.com/nicobailey/gomcp-lightpanda
- Lightpanda Windows issue: https://github.com/lightpanda-io/browser/issues/369
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- Chrome DevTools MCP: https://www.npmjs.com/package/chrome-devtools-mcp
- Current stack skill: `.claude/skills/browser-dev-cycle/SKILL.md`
- Current automation rules: `.claude/rules/browser-automation.md`
