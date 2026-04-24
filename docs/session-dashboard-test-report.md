# Session Dashboard — Test Report
**Date:** 2026-02-05 | **Tester:** Eve (Claude Opus 4.6 via Desktop Commander)  
**App:** `http://localhost:5174/` | **Stack:** Vite + React + TypeScript + FastAPI + PostgreSQL + WebSocket

---

## Executive Summary

The backend APIs are largely functional and the WebSocket layer works well. However, there are **3 critical frontend↔backend contract mismatches** that will cause the Memory Detail sheet and potentially other drill-down views to silently fail or show empty data. The Knowledge pillar is offline due to a missing file. One endpoint (`/api/pillars/memory/details`) returns 404 — it's referenced in frontend code but never implemented in the backend router.

---

## Test Results

### ✅ PASS — Health API (`/api/health`)
- **Status:** 200 OK
- **Response:** All 5 pillars returned with correct schema
- **Pillar statuses:**
  - `memory` → **online** (192 learnings)
  - `knowledge` → **offline** (error: "Knowledge tree file not found")
  - `pageindex` → **online** (32 indexed)
  - `roadmap` → **online** (23 items)
  - `handoffs` → **online** (1 document)
- **Frontend consumption:** ✅ `healthStore.ts` correctly maps `response.pillars` → store

### ✅ PASS — WebSocket (`/ws`)
- **Connection:** Opens successfully
- **Subscribe:** `{"action":"subscribe","project":"continuous-claude"}` → receives `{"type":"subscription","action":"subscribed","project":"continuous-claude"}`
- **Reconnect logic:** Frontend implements exponential backoff (1s → 30s max) — correct pattern
- **Health monitor:** Backend `HealthMonitor` pushes updates via `ConnectionManager` — architecture is sound

### ✅ PASS — Roadmap Goals (`/api/pillars/roadmap/goals`)
- **Status:** 200 OK
- **Response keys:** `goals`, `completed`, `total`, `completion_rate`
- **Data:** 23 goals returned with `text`, `completed`, `section` fields
- **Frontend match:** ✅ `RoadmapResponse` type matches backend response

### ✅ PASS — Handoffs List (`/api/pillars/handoffs`)
- **Status:** 200 OK
- **Response keys:** `handoffs`, `total`
- **Data:** Combines DB records + file-based HANDOFF-*.md files
- **⚠️ Minor:** Response lacks `page` and `page_size` fields (see BUG-003)

### ✅ PASS — Knowledge Tree (`/api/pillars/knowledge/tree`)
- **Status:** 200 OK
- **Response:** `{}` (empty object)
- **Root cause:** Knowledge tree file not found on disk — this is a data issue, not a code bug
- **Frontend handling:** `KnowledgeDetail` should handle empty response gracefully — verify it doesn't crash

---

## 🔴 CRITICAL BUGS

### BUG-001: Learnings API Response Contract Mismatch
**Severity:** 🔴 CRITICAL — Memory Detail sheet will show empty data  
**Location:** Backend `routers/memory.py` ↔ Frontend `lib/api.ts` + `types/index.ts`

**Backend returns:**
```json
{
  "items": [...],
  "total": 192,
  "skip": 0,
  "limit": 20
}
```

**Frontend expects (`LearningsResponse` type):**
```json
{
  "learnings": [...],
  "total": 192,
  "page": 1,
  "page_size": 20
}
```

**Impact:** `MemoryDetail.tsx` line ~248 accesses `response.learnings` which is `undefined`. The component will show the empty state or error state even though data exists.

**Also:** Frontend sends `?page=1&page_size=20` query params, but backend expects `?skip=0&limit=20`. The backend ignores unrecognized params, so it returns the default first 20 items regardless of page navigation.

**Fix options (pick one):**
1. **Fix backend** — Change router to accept `page`/`page_size` params and return `{"learnings": items, "page": page, "page_size": page_size, "total": total}`
2. **Fix frontend** — Update `api.ts` to send `skip`/`limit` and update `LearningsResponse` type to match `{items, total, skip, limit}`

**Recommended:** Option 1 (fix backend) — page-based pagination is more intuitive for frontend consumption.

---

### BUG-002: Memory Details Endpoint Returns 404
**Severity:** 🔴 CRITICAL — Feature completely broken  
**Location:** Frontend calls `GET /api/pillars/memory/details` but this route doesn't exist in `routers/memory.py`

**Evidence:**
```
GET /api/pillars/memory/details → 404 {"detail":"Not Found"}
```

**Frontend code** (`api.ts` line 73):
```typescript
export async function fetchMemoryDetails(): Promise<MemoryDetails> {
  return fetchJson<MemoryDetails>('/pillars/memory/details')
}
```

**Expected response type (`MemoryDetails`):**
```typescript
interface MemoryDetails {
  total_count: number
  by_type: Record<string, number>
  by_scope: Record<string, number>
  recent: Learning[]
}
```

**Fix:** Implement the `/api/pillars/memory/details` endpoint in `routers/memory.py` that queries aggregate stats from `archival_memory`.

---

### BUG-003: Nullable `tags` Will Crash LearningCard
**Severity:** 🔴 CRITICAL — Runtime crash on render  
**Location:** `MemoryDetail.tsx` → `LearningCard` component

**Problem:** The backend returns `"tags": null` for many learnings (confirmed in API response), but `LearningCard` accesses `learning.tags.length` without null checking:

```tsx
{learning.tags.length > 0 && (  // 💥 TypeError: Cannot read property 'length' of null
```

**Also:** The `Learning` type defines `tags: string[]` but the API can return `null`.

**Fix:**
1. Update type: `tags: string[] | null`
2. Update template: `{learning.tags?.length > 0 && (`
3. OR fix backend to always return `[]` instead of `null` for tags

---

## 🟡 MODERATE ISSUES

### BUG-004: Handoffs Pagination Params Mismatch
**Severity:** 🟡 MODERATE — Pagination won't work correctly  
**Location:** Frontend `api.ts` sends `page`/`page_size`, backend expects `skip`/`limit`

**Frontend sends:** `?page=1&page_size=5`  
**Backend expects:** `?skip=0&limit=20`  
**Backend response:** Returns `{handoffs, total}` — missing `page`/`page_size` in response

**Frontend type expects:**
```typescript
interface HandoffsResponse {
  handoffs: HandoffSummary[]
  total: number
  page: number    // ← not in response
  page_size: number  // ← not in response
}
```

**Fix:** Same approach as BUG-001 — align either frontend or backend. Recommend adding page-based params to backend.

---

### BUG-005: Learning `confidence` Field Missing from Backend
**Severity:** 🟡 MODERATE — Type mismatch  
**Location:** Frontend `Learning` type includes `confidence: string` but backend doesn't return this field

The backend extracts `type`, `context`, and `tags` from metadata, but not `confidence`. If the frontend tries to display confidence, it will be `undefined`.

**Fix:** Either remove `confidence` from the `Learning` type, or extract it from metadata in the backend.

---

### BUG-006: Learning `metadata` Field Missing from Backend Response
**Severity:** 🟡 MODERATE  
**Location:** Frontend `Learning` type includes `metadata: Record<string, unknown>` but backend doesn't return raw metadata

Backend extracts specific fields from metadata (type, context, tags) but doesn't include the raw `metadata` object. If any component needs arbitrary metadata access, it won't work.

---

## 🟢 WORKING CORRECTLY

| Component | Status | Notes |
|-----------|--------|-------|
| Health API polling (10s interval) | ✅ | Correct implementation |
| WebSocket connection + subscription | ✅ | Proper reconnect with backoff |
| Zustand health store | ✅ | Clean state management |
| PillarCard rendering | ✅ | Handles all status types |
| PillarGrid layout | ✅ | Responsive grid |
| Status change notifications | ✅ | Toast + browser notifications |
| Error boundary | ✅ | Catches component crashes |
| Theme support | ✅ | Dark mode via Header toggle |
| SPA routing + fallback | ✅ | FastAPI serves index.html for non-API routes |
| Vite HMR (dev mode) | ✅ | Hot reload working |
| Roadmap goals display | ✅ | Data structure matches |
| Quick Actions buttons | ✅ | Open correct detail sheets |

---

## Recommended Fix Priority

| Priority | Bug | Effort | Impact |
|----------|-----|--------|--------|
| 1 | BUG-001 (Learnings contract) | ~30 min | Memory sheet completely broken |
| 2 | BUG-003 (Null tags crash) | ~5 min | Runtime crash on real data |
| 3 | BUG-002 (Missing endpoint) | ~45 min | Memory details feature missing |
| 4 | BUG-004 (Handoffs pagination) | ~20 min | Pagination silently broken |
| 5 | BUG-005 (Confidence field) | ~5 min | Type safety |
| 6 | BUG-006 (Metadata field) | ~5 min | Type safety |

---

## Architecture Notes for Claude Code

**Backend entry point:** `opc/scripts/dashboard/main.py`  
**Backend routers:** `opc/scripts/dashboard/routers/` (health, memory, knowledge, roadmap, handoffs)  
**Frontend entry point:** `opc/scripts/dashboard/frontend/src/App.tsx`  
**API layer:** `opc/scripts/dashboard/frontend/src/lib/api.ts`  
**Types:** `opc/scripts/dashboard/frontend/src/types/index.ts`  
**Key stores:** `healthStore.ts`, `activityStore.ts`, `notificationStore.ts` (all Zustand)

The core pattern to fix: **Backend uses `skip/limit` pagination, frontend uses `page/page_size` pagination.** Pick one convention and align everything.
