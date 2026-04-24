# Dashboard Improvement Report

**Date:** 2026-03-05
**Reviewed by:** Maestro via Chrome DevTools
**URL:** http://localhost:3434
**Method:** Visual inspection, a11y tree audit, performance trace, DOM/CSS evaluation, mobile + light mode testing

---

## Executive Summary

The dashboard is **solid overall** -- clean layout, good information hierarchy, functional dark/light themes, fast initial load (LCP 158ms), zero console errors, and proper semantic HTML. The issues found are mainly accessibility gaps and minor UX polish.

**Scores:**
| Dimension | Rating | Notes |
|-----------|--------|-------|
| Visual Design & UX | B+ | Clean bento grid, good typography, minor polish needed |
| Performance | A- | 158ms LCP, 0.01 CLS, but no cache headers and 512KB main bundle |
| Accessibility | C+ | Good ARIA regions, but missing focus indicators, skip link, and undersized targets |

---

## Prioritized Issues

### HIGH Severity

| # | Category | Issue | Detail | Fix Effort |
|---|----------|-------|--------|------------|
| 1 | [A11Y] | Page title is "frontend" | Screen readers and browser tabs show generic "frontend" instead of "Session Dashboard" | S -- change `<title>` in index.html |
| 2 | [A11Y] | No visible focus indicators | `outlineStyle: none` on all buttons. Keyboard users cannot see which element is focused | S -- add `focus-visible:ring-2 ring-ring ring-offset-2` to button base styles |
| 3 | [A11Y] | No skip-to-content link | Keyboard users must tab through all header items to reach main content | S -- add hidden skip link targeting `<main>` |
| 4 | [A11Y] | Touch targets too small | Header buttons are 36x36px, "Details" buttons are 83x32px. WCAG 2.2 requires minimum 24x24px (AAA: 44x44px) | M -- increase icon button size to 40x40px, Details button height to 36px |
| 5 | [PERF] | No cache headers on static assets | All JS/CSS bundles have TTL: 0 seconds. Every page load re-downloads 750KB+ | S -- add `Cache-Control: public, max-age=31536000, immutable` for hashed assets in uvicorn/StaticFiles config |
| 6 | [PERF] | Main JS bundle over 500KB | `index-Dk4pwMrB.js` is 512KB (145KB gzipped). Vite warns about this | M -- code-split detail panels like SkillsDetail (already lazy). Lazy-load MemoryDetail, RalphDetail, etc. |
| 7 | [UX] | Activity feed text at 10px | "Status" badges in activity feed rows render at 10px font size -- below comfortable reading threshold | S -- increase to 11-12px or use `text-xs` (12px) consistently |

### MEDIUM Severity

| # | Category | Issue | Detail | Fix Effort |
|---|----------|-------|--------|------------|
| 8 | [UX] | Grammar: "1 items" | Activity feed shows "ralph is online (1 items)" -- missing singular form | S -- use `${count} ${count === 1 ? 'item' : 'items'}` |
| 9 | [UX] | Redundant "Activity" headings | H3 "Activity" section heading immediately followed by H3 "Activity Feed" card heading | S -- remove the outer "Activity" heading or rename to "Recent Activity" |
| 10 | [UX] | Uninformative seed data | On first load, all activity entries show "just now" with identical "X is online (N items)" messages -- no real insight | M -- suppress seed entries or show a "No recent activity" empty state instead of pre-populating |
| 11 | [UX] | Detail panel has no backdrop | Clicking "Details" opens slide-over panel but doesn't dim or blur the background content. Panel competes visually with the grid | S -- add `bg-black/50` backdrop overlay that closes panel on click |
| 12 | [A11Y] | System theme preference ignored on first visit | Theme defaults to dark regardless of OS `prefers-color-scheme`. "System" option exists but isn't the default | S -- default to "System" instead of "Dark" in theme provider |
| 13 | [UX] | Quick Actions missing new pillars | Only 8 quick action buttons. No entries for Agents or MCP Servers (newly added pillars) | S -- add 2 more quick action buttons for agents and mcp-servers |
| 14 | [UX] | SR-only text causes overflow | Header toolbar SR-only labels ("Notifications", "User Guide", etc.) have `scrollWidth >> clientWidth` indicating CSS overflow on hidden spans | S -- ensure SR-only class uses `clip` or `clip-path` instead of just `width: 1px` |
| 15 | [A11Y] | `color-scheme` CSS property not set | `document.documentElement` has `colorScheme: "normal"`. Should be `dark` or `light` to style native elements (scrollbars, form controls) | S -- add `color-scheme: dark` to `:root.dark` and `color-scheme: light` to `:root.light` |

### LOW Severity

| # | Category | Issue | Detail | Fix Effort |
|---|----------|-------|--------|------------|
| 16 | [UX] | "Never" for last activity | PageIndex, Roadmap, Braintrust show "Never" for last activity -- could be more descriptive | S -- show "No activity recorded" or hide the field entirely |
| 17 | [UX] | Hardcoded version "v1.0" in footer | Footer reads "Session Dashboard v1.0" -- will become stale | S -- read version from package.json or environment |
| 18 | [UX] | No sparklines or trend indicators | Pillar cards show a single count number with no visual trend. Users can't tell if counts are stable, rising, or falling | L -- add 7-day sparkline or up/down arrow based on recent history |
| 19 | [PERF] | HTTP/1.1 protocol | All requests use http/1.1. HTTP/2 would allow multiplexing for parallel asset loads | M -- configure uvicorn with HTTP/2 or put behind a reverse proxy |
| 20 | [PERF] | Minor CLS (0.01) | Two layout shifts at 417ms and 698ms during load. Scores are negligible (0.0098 total) but exist | S -- investigate skeleton-to-content transition timing |
| 21 | [UX] | No empty state for activity feed | If all activity is filtered out, feed shows blank space with no guidance | S -- add "No matching activity" message when filter returns empty |
| 22 | [UX] | Pillar card labels inconsistent | Some show relative time ("21m ago"), some show absolute dates ("1/23/2026"), some show "Never" | M -- standardize: always use relative time, with absolute in tooltip |

---

## Performance Metrics

| Metric | Value | Rating |
|--------|-------|--------|
| LCP (Largest Contentful Paint) | 158ms | Excellent (< 2.5s) |
| CLS (Cumulative Layout Shift) | 0.01 | Excellent (< 0.1) |
| TTFB (Time to First Byte) | 2ms | Excellent (localhost) |
| Render Delay | 156ms | Good |
| Network Requests | 7 total | Lean |
| Main Bundle | 512KB / 145KB gzip | Needs code splitting |
| CSS | 75KB / 13KB gzip | Acceptable |
| DOM Elements | 434 | Good (< 1500) |
| Console Errors | 0 | Clean |

---

## Accessibility Audit Summary

| Check | Status | Notes |
|-------|--------|-------|
| Heading hierarchy | PASS | H1 > H2 > H3, no skipped levels |
| ARIA landmarks | PASS | banner, main, contentinfo, regions for each pillar |
| ARIA labels on status badges | PASS | "Status: Online" labels present |
| Pillar card regions | PASS | Each card is `role="region"` with descriptive label |
| Button labels | PASS | All 22 buttons have accessible text |
| Duplicate IDs | PASS | None found |
| HTML lang attribute | PASS | `lang="en"` present |
| Live regions | PASS | Notification area has `aria-live="polite"` |
| Viewport meta | PASS | `width=device-width, initial-scale=1.0` |
| Skip-to-content link | FAIL | Missing -- keyboard users trapped in header |
| Focus indicators | FAIL | Outline removed globally, no visible focus ring |
| Touch target size | FAIL | 36x36px header buttons, 32px-tall Details buttons |
| Color scheme property | FAIL | Not set on root element |
| Page title | FAIL | Generic "frontend" instead of descriptive title |

---

## What Works Well

- **Clean bento grid layout** -- pillar cards are well-organized with consistent visual language
- **Status indicators** -- color-coded badges + Unicode symbols (not color-only) for status
- **WebSocket live updates** -- real-time status with clear "Live" indicator in header
- **Theme support** -- Light/Dark/System toggle with smooth transitions
- **Responsive design** -- single-column mobile layout works, no horizontal overflow
- **Semantic HTML** -- proper landmarks, headings, ARIA attributes
- **Code-split SkillsDetail** -- already lazy-loaded as a separate chunk (228KB)
- **Error boundary** -- ErrorBoundary wraps the entire app
- **Zero console errors** -- clean runtime with no warnings

---

## Recommended Fix Order

**Quick wins (< 1 hour total):**
1. Fix page title (#1)
2. Add focus indicators (#2)
3. Fix grammar pluralization (#8)
4. Add cache headers (#5)
5. Set `color-scheme` CSS property (#15)
6. Remove redundant heading (#9)

**Next sprint:**
7. Add skip link (#3)
8. Increase touch targets (#4)
9. Add backdrop to detail panel (#11)
10. Default to system theme (#12)
11. Lazy-load remaining detail panels (#6)
12. Add agents/mcp-servers quick actions (#13)

**Backlog:**
13-22: Sparklines, HTTP/2, empty states, time format standardization

---

*Screenshots saved to `test-screenshots/` for reference.*
