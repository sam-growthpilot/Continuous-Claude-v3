# FastMCP v3 Connector Playbook

A reusable recipe for designing and shipping FastMCP v3 HTTP connectors:
**local dev → Railway (test/staging) → Azure Container Apps in `rg-agent-architecture` (gated production) → Anthropic Custom Connector (team distribution)**.

**Audience:** A new Claude Code session asked to build a connector to some upstream API (e.g., Salesforce, HubSpot, Notion, Jira, an internal service). Hand this doc to that session as the design + build spec.

**Last verified:** 2026-05-06 (infra) + **2026-05-29 (Claude Custom Connector OAuth — see Phase 10)** against live `rg-agent-architecture`, the claude.ai connector UI, FastMCP 3.2.4, and Microsoft Learn + ISE guidance.

**Reference implementations:**
- `C:\Users\david.hayes\Projects\gong-mcp\` — small working example. v1 on Railway is live with no auth (DEV-ONLY). v2 plan in `docs/v2-plan.md` predates this playbook update — re-baseline against this doc before executing.
- `C:\Users\david.hayes\fourth-marketing-brain\` — production deployment, but **diverges from the patterns in this doc**. See [Addendum A — Marketing Brain migration](#addendum-a--marketing-brain-migration). Use it for FastMCP middleware + apps patterns, NOT for auth or secrets handling.

---

## When to use this playbook

Use it when **all** of the following are true:

- The upstream is a REST or GraphQL API the user wants to expose to Claude/MCP clients
- The connector should run as a long-lived HTTP server (not stdio per-process)
- Distribution is to a team inside an Anthropic workspace, gated to specific people
- The team has access to the Fourth Azure tenant (`75cd3b18-...`) and `rg-agent-architecture` resource group

If the upstream needs SDK-only access, or the connector is a personal-use stdio tool, this playbook is overkill — write a smaller stdio FastMCP server instead.

---

## Stack (proven on gong-mcp + fourth-marketing-brain, verified May 2026)

| Layer | Choice | Why |
|-------|--------|-----|
| Language | Python 3.12 | FastMCP v3 minimum; `python:3.12-slim` is the container baseline |
| Package manager | `uv` (Astral) | Fast, lockfile, single tool for venv + deps |
| MCP framework | `fastmcp[apps]>=3.2.0,<4` | Apps surface unlocks Prefab UI; `[apps,tasks]` if you need long-running operations |
| HTTP client | `httpx>=0.27` | Async, connection-pooling |
| Env loading | `python-dotenv>=1.0` | `load_dotenv()` at server.py top so `python server.py` Just Works |
| Tests | `pytest`, `pytest-asyncio`, `pytest-httpx` | Mock the upstream, exercise real client code |
| Lint/format | `ruff` | One tool, fast |
| Container base | `python:3.12-slim` + `uv` from `ghcr.io/astral-sh/uv:latest` | Minimal, layer-cached |
| Dev hosting | Railway | Test/staging — fast iteration, no auth |
| Prod hosting | Azure Container Apps in `rg-agent-architecture` / `locmap-env` (Sweden Central) | Easy Auth at platform layer; CAF naming `ca-mcp-<service>` |
| Identity | Entra ID app registration with custom App Role + `appRoleAssignmentRequired=true` | Per-user gate enforced at OAuth time |
| Auth pattern | **Easy Auth + `Return401` + `EasyAuthGate`** for token-bearing clients; **FastMCP `RemoteAuthProvider` + `AzureJWTVerifier`** (app-owned, validate-only) when a **Claude Custom Connector** is the client | Easy Auth alone does NOT advertise OAuth discovery (PRM) on ACA, so connectors can't complete OAuth — see Phase 10 (2026-05-29) |
| ACR pull | **Managed Identity** (`AcrPull` role) | Admin-user is dev-only per Microsoft + PSRule |
| Secrets | **Key Vault references** (`keyvaultref:`) | Plaintext env vars are visible to anyone with read access on the container app |
| Image tagging | **Dual: `<service>:<semver>` + `<service>:sha-<short-sha>`, deploy by digest** | Microsoft 2026 guidance; rejects `:latest` in production |
| Distribution | Anthropic Custom Connector (workspace) | OAuth 2.1, **user-delegated, requires PRM discovery (RFC 9728)** — see Phase 10; egress `160.79.104.0/21` |

> ⚠️ **FastMCP `OAuthProxy` is dev-only.** Active CVEs as of May 2026: [CVE-2026-27124](https://advisories.gitlab.com/pkg/pypi/fastmcp/CVE-2026-27124/) (Confused Deputy), [CVE-2025-69196](https://advisories.gitlab.com/pkg/pypi/fastmcp/CVE-2025-69196/) (token reuse). FastMCP's own release notes describe it as "intended only for development and testing." Do NOT use in production — use Easy Auth instead.

---

## Architecture (per-MCP + shared services)

```
                          rg-agent-architecture (Subscription: engineering-csp)
┌────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                    │
│  Container Apps Environment: locmap-env (Sweden Central, Consumption)              │
│  ┌────────────────────────────────────────────────────────────────────────────┐    │
│  │   ca-agent-arch (dashboard, optional)                                      │    │
│  │   ca-mcp-marketing-brain    ┐                                              │    │
│  │   ca-mcp-sales-enablement   │                                              │    │
│  │   ca-mcp-brand-assets       ├── each: SystemAssigned MI, Easy Auth on,     │    │
│  │   ca-mcp-analytics          │   Return401, ingress external, target 8000  │    │
│  │   ca-mcp-gong               ┘                                              │    │
│  └────────────────────────────────────────────────────────────────────────────┘    │
│           │ image pull (managed identity, AcrPull role)                            │
│           ▼                                                                        │
│  ┌─────────────────────────────────────────┐                                       │
│  │ Azure Container Registry: agentarchacr  │  ← shared, one repo per service       │
│  │   marketing-brain  : 1.2.0 / sha-abc12… │                                       │
│  │   gong             : 0.1.0 / sha-fb273… │                                       │
│  │   sales-enablement : ...                │                                       │
│  └─────────────────────────────────────────┘                                       │
│                                                                                    │
│  Shared data services (per-service logical separation):                            │
│  ┌──────────────────────────────┐  ┌────────────────────────────────────┐          │
│  │ Cosmos DB Serverless         │  │ Azure AI Search (Basic)            │          │
│  │   account: agent-architecture-cosmos        service: agent-demo-search           │
│  │   db: mcp-marketing  ←─ marketing-brain    indexes:                  │          │
│  │   db: mcp-sales      ←─ sales-enablement     mcp-marketing  ←─ MB    │          │
│  │   db: mcp-brand      ←─ brand-assets         mcp-analytics  ←─ ana   │          │
│  │   db: mcp-gong       ←─ gong (if needed)                             │          │
│  └──────────────────────────────┘  └────────────────────────────────────┘          │
│                                                                                    │
│  Shared secret store:                                                              │
│  ┌─────────────────────────────────────────┐                                       │
│  │ Key Vault: agent-arch-kv-prod            │  ← keyvaultref: from each CA         │
│  │   mcp-marketing-cosmos-key  …            │                                       │
│  │   mcp-gong-access-key  …                 │                                       │
│  │   mcp-<svc>-* per service                │                                       │
│  └─────────────────────────────────────────┘                                       │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
                          │ build & push (GitHub Actions, az acr build)
                          ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  Independent Git Repos (one per MCP)                                               │
│   github.com/Rev4nchist/gong-mcp                                                   │
│   github.com/Rev4nchist/mcp-marketing-brain   ←── push to main triggers GH Actions │
│   github.com/Rev4nchist/mcp-sales-enablement                                       │
│   github.com/Rev4nchist/mcp-brand-assets                                           │
│   github.com/Rev4nchist/mcp-analytics                                              │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Per-MCP Azure footprint:**
- 1 × Container App (`ca-mcp-<service>`)
- 1 × Entra ID App Registration with custom App Role
- 1 × ACR repository (`<service>`)
- 1 × Cosmos DB database (`mcp-<service>`) — only if persistence needed
- 1 × AI Search index (`mcp-<service>`) — only if search needed
- N × Key Vault secrets (`mcp-<service>-<name>`)

**Shared:** RG, CAE, ACR, Cosmos account, AI Search service, Key Vault, Log Analytics workspace.

---

## Naming convention (CAF-aligned)

| Resource | Pattern | Example |
|----------|---------|---------|
| Container App | `ca-mcp-<service>` | `ca-mcp-gong` |
| Entra ID App Registration | `MCP: <Service Display>` | `MCP: Gong` |
| App Role value | `Mcp.User` (or service-specific) | `Mcp.User` for shared, `GongApprovedUser` for explicit |
| ACR repository | `<service>` (no prefix) | `gong`, `marketing-brain` |
| Image tag | `<service>:<semver>` AND `<service>:sha-<short>` | `gong:0.1.0`, `gong:sha-fb273a9` |
| Cosmos DB | `mcp-<service>` | `mcp-content` (MB), `mcp-gong` |
| AI Search index | `mcp-<service>` | `mcp-marketing`, `mcp-gong` |
| Key Vault secret | `mcp-<service>-<name>` | `mcp-gong-access-key` |
| GitHub repo | `<service>-mcp` or `mcp-<service>` (your call, be consistent) | `gong-mcp`, `mcp-sales-enablement` |

Reference: [Azure CAF abbreviations](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations).

---

## Project layout

```
<project>/
├── server.py                       # FastMCP app + tool registration + run
├── pyproject.toml                  # uv manifest
├── uv.lock                         # committed
├── Dockerfile                      # python:3.12-slim + uv layer cache
├── .dockerignore
├── Procfile                        # web: .venv/bin/python server.py     ← Railway
├── railway.toml                    # startCommand = .venv/bin/python server.py
├── .env.example                    # placeholders only
├── .gitignore
├── README.md                       # team-facing setup + deploy
├── CLAUDE.md                       # session-facing project instructions
├── ROADMAP.md
├── <project>_mcp/                  # importable Python package
│   ├── __init__.py
│   ├── config.py                   # env-driven Config dataclass
│   ├── auth.py                     # EasyAuthGate middleware (production-required)
│   ├── rate_limit.py
│   ├── <upstream>_client.py
│   └── <other domain modules>
├── tests/
│   ├── conftest.py
│   ├── test_<modules>.py
│   └── test_auth.py                # principal decode + role check
├── scripts/
│   ├── smoke_test.py
│   └── smoke_test_remote.py
├── .github/workflows/
│   └── deploy.yml                  # build → ACR → ACA revision update
└── docs/
    ├── v2-plan.md                  # phase plan for ACA deploy
    └── azure-deployment.md         # az CLI runbook
```

Single source of truth: `pyproject.toml` (deps), `Dockerfile` (CMD), `server.py` (entry). Don't duplicate behavior across `Procfile` / `railway.toml` / `Dockerfile` CMD — pick one and align the others. (Railway lets you override via `railway.toml` startCommand — keep it identical to the Dockerfile CMD.)

---

## Build phases (ordered)

### Phase 0 — Discovery

Before scaffolding, get clarity on:
1. **Upstream API** — base URL, auth scheme (Basic / Bearer / OAuth2), rate limit, pagination shape
2. **Tools** — name + signature + endpoint mapping for each MCP tool
3. **Distribution** — Anthropic Custom Connector? Workspace name? Per-user CLI install?
4. **Access control** — defaults to App Role + `appRoleAssignmentRequired=true`. Confirm role name and initial assignees.
5. **Persistence** — does the connector need Cosmos / AI Search? Or is it a thin proxy?
6. **Secrets** — list every credential that needs to exist; they all go to Key Vault.

Make these explicit in the project's `CLAUDE.md`.

### Phase 1 — Scaffold

Create the layout above with placeholder content. At minimum:
- `pyproject.toml` with `fastmcp[apps]>=3.2.0,<4`, `httpx`, `python-dotenv`, dev extras (`pytest`, `pytest-httpx`, `ruff`)
- `<project>_mcp/config.py` — Config dataclass; **`port` honors `$PORT` first**: `int(os.getenv("PORT") or os.getenv("MCP_PORT") or "8000")`
- Stub `<upstream>_client.py` with a `Client` class taking `Config`, owning an httpx `AsyncClient`, with `close()`
- Stub `server.py` with `mcp = FastMCP("Name", instructions="...")`, `load_dotenv()` at top, and a `/health` custom route
- `tests/conftest.py` with autouse env isolation
- `.env.example` with every env var (placeholders only)

Run `uv sync --extra dev`. Commit `uv.lock`.

### Phase 2 — Upstream client

Implement the upstream client (`<upstream>_client.py`):
- Lazy-init shared `httpx.AsyncClient` (one per process)
- Auth header built once at init
- Rate limiter as a separate utility
- 429 backoff: parse `Retry-After`, sleep, retry up to N times
- Custom exception: `<Upstream>APIError` with `status_code` + `body`
- Pagination helpers: walk the cursor until exhausted

Tests: `pytest-httpx` mock — verify auth header, 429 retry, 4xx raises, pagination terminates.

### Phase 3 — Tools

- One `async @mcp.tool()` function per upstream endpoint, **1:1**
- snake_case Python inputs; pass camelCase to upstream inside the client
- Format at the boundary — flatten nested upstream JSON in the tool, not in the LLM's context
- Resolve adjacent data (e.g., user names) inside the tool body

Tests: smoke import (server registers N tools); live `scripts/smoke_test.py`.

### Phase 4 — Local dev verification

```bash
cp .env.example .env       # fill in real creds
uv sync --extra dev
uv run python server.py    # listens on 0.0.0.0:8000
curl http://127.0.0.1:8000/health
uv run python scripts/smoke_test.py
uv run pytest -q
```

### Phase 5 — Railway (test/staging)

Goal: public URL fast, no auth, for design feedback. **Railway is dev-only — never share its URL outside the build team.**

```bash
railway init --name <project>-mcp
railway add --service <project>-mcp --variables "UPSTREAM_KEY=..." ...
railway up --service <project>-mcp --detach
railway domain --service <project>-mcp
curl https://<railway-url>/health
```

**Critical Railway gotchas** (each one ate a previous session):
1. **`$PORT`** — Railway dynamically injects PORT. Hardcoding 8000 fails healthcheck with "service unavailable". Pattern: `int(os.getenv("PORT") or os.getenv("MCP_PORT") or "8000")`.
2. **No `uv run` at boot** — does an implicit editable install which crashes on missing README. Use `.venv/bin/python server.py`.
3. **One start-command source** — `railway.toml` > `Procfile` > Dockerfile CMD. Align them.
4. **Healthcheck timeout 60s** — 30s is tight. Set in `railway.toml`.
5. **Diagnosis ladder** — `railway logs --build` shows healthcheck retries; `railway logs --deployment` shows app boot. 404 from the public URL = no active deployment.
6. **`PORT` not in `railway variables`** — runtime-injected. Trust it.

Verbatim text in `gong-mcp/CLAUDE.md` "Railway Deployment — Lessons Learned".

### Phase 6 — Auth implementation (server-side)

This is **mandatory before** ACA deploy. Two pieces in code, two pieces in Azure (Phase 7).

**Code piece 1: `<project>_mcp/config.py`**
```python
auth_mode: str = field(default_factory=lambda: os.getenv("AUTH_MODE", "none"))
approved_role: str = field(default_factory=lambda: os.getenv("MCP_APPROVED_ROLE", "Mcp.User"))
```

**Code piece 2: `<project>_mcp/auth.py` — `EasyAuthGate` middleware**

```python
"""EasyAuthGate — server-side defense-in-depth for ACA Easy Auth.

Reads the X-MS-CLIENT-PRINCIPAL header injected by Easy Auth (after Easy Auth
has validated the JWT at the platform edge), decodes the claims, and verifies
the configured App Role is present before any tool call, resource read,
listing call, or prompt render runs.

If Easy Auth is misconfigured or someone hits the container directly bypassing
the edge, this middleware still says no.
"""
import base64, binascii, json, logging
from fastmcp.server.dependencies import get_http_request
from fastmcp.server.middleware import Middleware, MiddlewareContext, CallNext
from mcp.shared.exceptions import McpError
from mcp.types import ErrorData

ROLE_CLAIM_TYPES = {
    "roles",
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
}
# Easy Auth places the UPN (or equivalent) in a claim whose `typ` is one of
# these forms. The non-existent `name_typ_value` key on the principal root
# is NOT one of them — see pitfalls table.
UPN_CLAIM_TYPES = (
    "preferred_username",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
)
log = logging.getLogger(__name__)

def extract_principal(headers: dict) -> dict | None:
    blob = headers.get("x-ms-client-principal") or headers.get("X-MS-Client-Principal")
    if not blob:
        return None
    try:
        parsed = json.loads(base64.b64decode(blob))
    except (ValueError, binascii.Error, json.JSONDecodeError):
        return None
    # Defensive: a top-level list / scalar would crash has_role()'s
    # `.get(...)` with AttributeError. Treat as malformed → deny.
    if not isinstance(parsed, dict):
        return None
    return parsed

def has_role(principal: dict, role: str) -> bool:
    for claim in principal.get("claims", []):
        if claim.get("typ") in ROLE_CLAIM_TYPES and claim.get("val") == role:
            return True
    return False

def _principal_upn(principal: dict | None) -> str:
    """Walk the claims list for a UPN-like claim; '<unknown>' if missing."""
    if not isinstance(principal, dict):
        return "<unknown>"
    for claim in principal.get("claims", []) or []:
        if isinstance(claim, dict) and claim.get("typ") in UPN_CLAIM_TYPES:
            val = claim.get("val")
            if val:
                return val
    return "<unknown>"

class EasyAuthGate(Middleware):
    """Gate tool calls, resource reads, prompt renders, AND listings.

    Gating only on_call_tool / on_read_resource leaves the tool roster
    enumerable via tools/list to anyone who reaches the container's
    internal IP — bypassing Easy Auth at the edge. Gate every listing
    hook too. `on_initialize` is intentionally NOT gated: gating it
    breaks the MCP handshake before the client can present credentials.
    """

    def __init__(self, role_name: str) -> None:
        self.role_name = role_name

    async def on_call_tool(self, ctx, call_next): return await self._gate(ctx, call_next)
    async def on_read_resource(self, ctx, call_next): return await self._gate(ctx, call_next)
    async def on_get_prompt(self, ctx, call_next): return await self._gate(ctx, call_next)
    async def on_list_tools(self, ctx, call_next): return await self._gate(ctx, call_next)
    async def on_list_resources(self, ctx, call_next): return await self._gate(ctx, call_next)
    async def on_list_resource_templates(self, ctx, call_next): return await self._gate(ctx, call_next)
    async def on_list_prompts(self, ctx, call_next): return await self._gate(ctx, call_next)

    async def _gate(self, ctx: MiddlewareContext, call_next: CallNext):
        # Use FastMCP's documented helper. It uses the MCP SDK's request_ctx
        # (set during normal request handling) with a fallback to FastMCP's
        # HTTP context var. Raises RuntimeError when no HTTP request is in
        # scope (STDIO transport, background tasks without snapshot);
        # LookupError is also possible if the contextvar plumbing is
        # exercised in an unusual order. Fail CLOSED in both cases.
        try:
            req = get_http_request()
            headers = dict(req.headers)
        except (RuntimeError, LookupError):
            headers = {}
        principal = extract_principal(headers)
        if not principal or not has_role(principal, self.role_name):
            upn = _principal_upn(principal)
            log.warning("EasyAuthGate denied: upn=%s role=%s", upn, self.role_name)
            raise McpError(ErrorData(code=-32001, message=f"forbidden: missing {self.role_name} role"))
        return await call_next(ctx)
```

**Why integration tests are required.** Unit tests that mock the FastMCP `Context` shape will pass even when the middleware can't read headers in production — the mock looks fine, the real `Context` has no `http_request` attribute, and the gate silently fails closed on every request including legitimate ones. Always add at least one integration test that uses `fastmcp.Client` + `StreamableHttpTransport` against a real `mcp.http_app()` instance hosted on a real port (uvicorn on `127.0.0.1:0` is enough). This catches the most dangerous failure mode of any auth middleware (silent fail-closed) before it ever ships. Reference: `gong-mcp/tests/test_auth_integration.py` for a working example covering the allow path, the missing-header / wrong-role deny paths, the listing-hook deny path (regression guard against tool-roster enumeration), and the `/health` public-route path.

**Code piece 3: register in `server.py`**
```python
from <project>_mcp.config import config

mcp = FastMCP("Service", instructions="...")  # NOTE: auth=None on ACA — Easy Auth handles JWT
if config.auth_mode == "easyauth":
    from <project>_mcp.auth import EasyAuthGate
    mcp.add_middleware(EasyAuthGate(role_name=config.approved_role))   # outermost
```

Tests in `tests/test_auth.py`: missing header → deny; bad base64 → deny; principal without role → deny; principal with role → allow; both claim type forms recognized.

### Phase 7 — Azure setup (one-time per service)

Three Azure objects: AAD app + role, ACR auth, Key Vault secrets.

**7a. Entra ID App Registration with App Role**
```bash
TENANT_ID=75cd3b18-d23a-40ee-ad06-ad4484fc72fe
APP_NAME="MCP: <Service>"
CA_NAME="ca-mcp-<service>"
ENV_DOMAIN="happyhill-92303561.swedencentral.azurecontainerapps.io"

# 1. Create app registration
APP_ID=$(az ad app create \
  --display-name "$APP_NAME" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "https://${CA_NAME}.${ENV_DOMAIN}/.auth/login/aad/callback" \
  --query appId -o tsv)

# 2. Delegated Graph perms
az ad app permission add --id $APP_ID --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions \
    37f7f235-527c-4136-accd-4a02d197296e=Scope \
    14dad69e-099b-42c9-810b-d002981feec1=Scope \
    e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope

# 3. Define Mcp.User App Role
ROLE_ID=$(uuidgen)
az ad app update --id $APP_ID --set "appRoles=[{
  \"allowedMemberTypes\": [\"User\"],
  \"description\": \"Approved user of $APP_NAME\",
  \"displayName\": \"MCP User\",
  \"id\": \"$ROLE_ID\",
  \"isEnabled\": true,
  \"value\": \"Mcp.User\"
}]"

# 4. Create SP, require role assignment
SP_ID=$(az ad sp create --id $APP_ID --query id -o tsv)
az ad sp update --id $SP_ID --set appRoleAssignmentRequired=true

# 5. Assign initial users
USER_OID=$(az ad user show --id "user@fourth.com" --query id -o tsv)
az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$SP_ID/appRoleAssignments" \
  --body "{\"principalId\":\"$USER_OID\",\"resourceId\":\"$SP_ID\",\"appRoleId\":\"$ROLE_ID\"}"
```

Capture: `APP_ID`, `ROLE_ID`, `SP_ID`.

**7b. Key Vault secrets**
```bash
KV=agent-arch-kv-prod

az keyvault secret set --vault-name $KV --name "mcp-<service>-upstream-key" --value "<paste>"
az keyvault secret set --vault-name $KV --name "mcp-<service>-upstream-secret" --value "<paste>"
# repeat for every credential — never paste secrets into env vars
```

**7c. Cosmos DB / AI Search (skip if not needed)**
```bash
# Cosmos DB — separate logical database, throughput per container
az cosmosdb sql database create --account-name agent-architecture-cosmos -g rg-agent-architecture --name mcp-<service>
az cosmosdb sql container create --account-name agent-architecture-cosmos -g rg-agent-architecture \
  --database-name mcp-<service> --name <container> --partition-key-path "/<key>" --throughput 400

# AI Search index — created by your seed script, not by az CLI; service is shared
```

### Phase 8 — ACA deploy

```bash
RG=rg-agent-architecture
ENV=locmap-env
APP=ca-mcp-<service>
ACR=agentarchacr
KV=agent-arch-kv-prod

# 1. Build first image (dual-tag: SHA + initial semver 0.1.0)
SHORT_SHA=$(git rev-parse --short=7 HEAD)
az acr build --registry $ACR \
  --image <service>:0.1.0 \
  --image <service>:sha-$SHORT_SHA \
  --file Dockerfile .

# 2. Pin the deployed digest (NEVER use :latest in CD)
DIGEST=$(az acr repository show --name $ACR --image <service>:sha-$SHORT_SHA --query "digest" -o tsv)
IMAGE="$ACR.azurecr.io/<service>@$DIGEST"

# 3. Create container app with SystemAssigned identity
az containerapp create \
  --name $APP --resource-group $RG --environment $ENV \
  --image "$IMAGE" \
  --target-port 8000 --ingress external \
  --min-replicas 1 --max-replicas 3 --cpu 0.5 --memory 1.0Gi \
  --system-assigned

# 4. Grant the CA's identity AcrPull on the registry
PRINCIPAL_ID=$(az containerapp show --name $APP -g $RG --query identity.principalId -o tsv)
ACR_ID=$(az acr show --name $ACR --query id -o tsv)
az role assignment create --assignee $PRINCIPAL_ID --role AcrPull --scope $ACR_ID

# 5. Switch the registry credential to managed identity
az containerapp registry set --name $APP -g $RG --server "$ACR.azurecr.io" --identity system

# 6. Grant Key Vault access to the CA's identity
KV_ID=$(az keyvault show --name $KV --query id -o tsv)
az role assignment create --assignee $PRINCIPAL_ID --role "Key Vault Secrets User" --scope $KV_ID

# 7. Wire env vars + Key Vault references
KV_URI=$(az keyvault show --name $KV --query properties.vaultUri -o tsv | sed 's|/$||')

az containerapp secret set --name $APP -g $RG --secrets \
  "upstream-key=keyvaultref:${KV_URI}/secrets/mcp-<service>-upstream-key,identityref:system" \
  "upstream-secret=keyvaultref:${KV_URI}/secrets/mcp-<service>-upstream-secret,identityref:system"

az containerapp update --name $APP -g $RG \
  --set-env-vars \
    "AUTH_MODE=easyauth" \
    "MCP_APPROVED_ROLE=Mcp.User" \
    "MCP_TRANSPORT=http" \
    "UPSTREAM_KEY=secretref:upstream-key" \
    "UPSTREAM_SECRET=secretref:upstream-secret"

# 8. CONFIRM /health is reachable BEFORE enabling Easy Auth (else 401-loop forever)
curl https://${APP}.${ENV}.swedencentral.azurecontainerapps.io/health   # expect 200

# 9. Enable Easy Auth — Microsoft provider, Return401 (NOT RedirectToLoginPage)
az containerapp auth microsoft update \
  --name $APP -g $RG \
  --client-id $APP_ID \
  --tenant-id $TENANT_ID \
  --yes

az containerapp auth update \
  --name $APP -g $RG \
  --enabled true \
  --action Return401 \
  --require-authentication true \
  --redirect-provider azureactivedirectory

# 10. Verify gated path
curl https://${APP}.${ENV}.swedencentral.azurecontainerapps.io/health           # expect 401 (no token)
curl https://${APP}.${ENV}.swedencentral.azurecontainerapps.io/health -H "Authorization: Bearer <user-token>"  # expect 200
```

**Why `Return401` and not `RedirectToLoginPage` or `AllowAnonymous`:**
- MCP clients (Claude.ai Custom Connector, Claude Code, VS Code) speak OAuth 2.1 + bearer tokens. They CANNOT follow HTML redirects.
- `AllowAnonymous` lets all traffic through to the container — Easy Auth still parses tokens when present, but unauthenticated traffic reaches your app. That's fine for Marketing Brain's old in-process OAuthProxy pattern but defeats the purpose of platform auth.
- `Return401` is the documented Microsoft pattern for MCP servers: [learn.microsoft.com/en-us/azure/container-apps/mcp-authentication](https://learn.microsoft.com/en-us/azure/container-apps/mcp-authentication).

### Phase 9 — GitHub Actions CI/CD

`.github/workflows/deploy.yml`:
```yaml
name: Deploy <service>
on:
  push:
    branches: [main]
    paths-ignore: ['docs/**', '*.md']

env:
  ACR_NAME: agentarchacr
  IMAGE_NAME: <service>
  CONTAINER_APP_NAME: ca-mcp-<service>
  RESOURCE_GROUP: rg-agent-architecture

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # for OIDC azure/login (preferred over SP secret)
      contents: read
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # need tags for semver

      - name: Compute version
        id: ver
        run: |
          # Semver from latest tag, fallback to 0.1.0 if none
          SEMVER=$(git describe --tags --abbrev=0 2>/dev/null || echo "0.1.0")
          SEMVER=${SEMVER#v}   # strip leading v
          SHORT_SHA=${GITHUB_SHA::7}
          echo "semver=$SEMVER" >> $GITHUB_OUTPUT
          echo "short_sha=$SHORT_SHA" >> $GITHUB_OUTPUT

      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}      # OIDC federated SP
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Build & dual-tag push to ACR
        run: |
          az acr build --registry ${{ env.ACR_NAME }} \
            --image ${{ env.IMAGE_NAME }}:${{ steps.ver.outputs.semver }} \
            --image ${{ env.IMAGE_NAME }}:sha-${{ steps.ver.outputs.short_sha }} \
            --file Dockerfile .

      - name: Resolve digest & deploy
        run: |
          DIGEST=$(az acr repository show \
            --name ${{ env.ACR_NAME }} \
            --image ${{ env.IMAGE_NAME }}:sha-${{ steps.ver.outputs.short_sha }} \
            --query digest -o tsv)
          az containerapp update \
            --name ${{ env.CONTAINER_APP_NAME }} \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --image ${{ env.ACR_NAME }}.azurecr.io/${{ env.IMAGE_NAME }}@$DIGEST
```

Repo secrets via `gh secret set`:
- `AZURE_CLIENT_ID` — federated identity SP (preferred over SDK auth secret)
- `AZURE_TENANT_ID` — `75cd3b18-d23a-40ee-ad06-ad4484fc72fe`
- `AZURE_SUBSCRIPTION_ID` — `c9bed202-c4a1-43e9-922d-9a38d966f83e`

Set up the federated identity once: [docs](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect).

### Phase 10 — Anthropic Custom Connector registration

> ⚠️ **2026-05-29 — the connector needs OAuth *discovery*, which Easy Auth alone does NOT provide on ACA.** This corrects the earlier assumption that the Easy Auth edge (Phase 6) is enough for a Claude connector. Read this before wiring one. Worked reference: `fourth-salesforce-mcp/docs/mcp-connector-architecture.md`.

**What Claude's connector actually requires.** The claude.ai "Add custom connector" UI takes only Name, MCP URL, and (optional) OAuth Client ID/Secret — there is **no field to type authorize/token endpoints**. Claude *discovers* the authorization server from the MCP server via **OAuth Protected Resource Metadata (RFC 9728)**: it expects a `401` on `/mcp` carrying `WWW-Authenticate: Bearer resource_metadata="…"`, plus a reachable `/.well-known/oauth-protected-resource`. The flow is **user-delegated** (the human signs in interactively), not pure server-to-server.

**Why an Easy-Auth-only endpoint fails.** ACA Easy Auth returns a *bare* `401` (`WWW-Authenticate: Bearer realm=…`, no `resource_metadata`) and 401s the `/.well-known/*` paths too — so Claude discovers nothing and never starts OAuth. The App-Service setting that makes Easy Auth emit PRM (`WEBSITE_AUTH_PRM_DEFAULT_WITH_SCOPES`) is **App-Service-only + preview; it does not exist on Container Apps**. On ACA, advertising discovery is an **application** responsibility.

**Recommended pattern — app-owned OAuth via FastMCP `RemoteAuthProvider` + `AzureJWTVerifier` (validate-only).** Auto-mounts `/.well-known/oauth-protected-resource`, emits the canonical challenge, validates the Entra token in-process. This is NOT the CVE-laden `OAuthProxy`/`AzureProvider` (those proxy the whole OAuth dance — still dev-only). Microsoft's ISE team ships exactly this on ACA (Feb 2026). It replaces the Phase-6 Easy Auth edge:

```python
from fastmcp.server.auth import RemoteAuthProvider
from fastmcp.server.auth.providers.azure import AzureJWTVerifier
verifier = AzureJWTVerifier(client_id="<RESOURCE_app_id>", tenant_id="<tenant>",
                            required_scopes=["access_as_user"])  # bare scp value
auth = RemoteAuthProvider(token_verifier=verifier,
    authorization_servers=["https://login.microsoftonline.com/<tenant>/v2.0"],
    base_url="https://ca-mcp-<svc>.<region>.azurecontainerapps.io/mcp")  # FULL /mcp URL
mcp = FastMCP("Service", auth=auth)
```

Tools read identity via `get_access_token()` (`.claims` for oid/roles, `.token` for the downstream subject) — replacing the `X-MS-CLIENT-PRINCIPAL` header read. Keep a `RoleGate` middleware checking the `Mcp.User` role from `.claims["roles"]`.

**Client/resource app separation (security requirement).** The connector's `client_id`+`client_secret` are handed to Anthropic, so do NOT hand over a multi-purpose app's secret. Use **two** app registrations:
- **CLIENT** = a dedicated app (`HS MCP <Service> Connector`) — Anthropic holds only this secret; carries the `https://claude.ai/api/mcp/auth_callback` redirect URI.
- **RESOURCE / audience** = the service's API app — exposes `access_as_user`, owns the `Mcp.User` role, stays the token audience (and what any downstream RFC 8693 handler already trusts). The proxy validates this audience and **pins `azp`** to the client app.

**Register in claude.ai:** Workspace → Connectors → New. Name, URL `…/mcp`, Advanced → the CLIENT app's id + secret. Visibility workspace-only. Anthropic egresses from `160.79.104.0/21`.

**Gotchas (each verified on fourth-salesforce-mcp, 2026-05-29):**
- **`aiohttp` missing** → `azure.identity.aio.DefaultAzureCredential` (Cosmos/KeyVault aio) raises `ImportError` building its async pipeline. azure-core does NOT pull it transitively. Add `aiohttp>=3.9` to deps. Masked by SDK-mocked tests; fires on the first live data-plane call.
- **Scope-format split** → PRM advertises the full `api://<id>/access_as_user`; the verifier's `required_scopes` wants the bare `access_as_user`. Two different config values.
- **`roles` claim** → `appRoleAssignmentRequired=true` gates *issuance*, not the *claim*. Confirm the delegated token actually carries `roles:[Mcp.User]`; `RoleGate` must DENY (never 500 / fail-open) on a missing claim.
- **`azp` pinning** → audience+scope alone let any consented tenant app present a token; pin `azp`/`appid` to the client app and set `adminConsentRequired=true`.
- **PRM `resource` at root** (FastMCP issue #1348) → set `base_url` to the full `/mcp` URL; CI-assert the advertised `resource` equals the `/mcp` URL. **Pin FastMCP to an exact patch version** — discovery rides version-sensitive behavior.
- **Downstream token-exchange audience** → if the proxy brokers to an upstream via RFC 8693, the inbound token's audience must be one the upstream handler trusts. Keeping the audience on the existing resource app preserves that. Validate a real *user* token end-to-end before cutover — app-only `client_credentials` spike tokens lack the user-identity claim the handler demands.
- **Operators can't read Cosmos** → human users (even control-plane Owners) lack Cosmos *data-plane* RBAC; grant `Cosmos DB Built-in Data Reader` to run audit-verification scripts locally.

**De-risk before retiring a working edge.** If Easy Auth is already live, prove the three unknowns first via the cheap path (app-served PRM on an Easy-Auth `--excluded-paths` route): (a) Claude discovers + completes OAuth, (b) the user token carries `roles`, (c) any downstream exchange works with a real user token. Only then commit to the full app-owned-auth cutover (which is reversible: `az containerapp auth update --enabled true` **plus** redeploy the prior image).

CLI users (Claude Code) add a per-user `~/.claude.json` entry — same URL, same discovery flow.

### Phase 11 — Verification + Railway retirement

End-to-end before declaring done:
1. **Approved user** — Claude.ai workspace, sign in, tool runs.
2. **Unassigned user** — Azure AD blocks with `AADSTS50105`.
3. **Forged principal** — middleware returns JSON-RPC `forbidden` and logs the rejected UPN.
4. **Audit** — Azure AD sign-in logs only show role-assigned users; container logs show middleware denials.

Then retire Railway: scale to zero, repoint `~/.claude.json` to ACA URL, mark Railway DEV-ONLY in `CLAUDE.md`, keep ~2 weeks as rollback.

---

## Auth modes (config.py pattern)

| Mode | When | Server behavior |
|------|------|----------------|
| `none` | local dev / smoke tests | `auth=None`, no middleware. Anything can hit. |
| `easyauth` | **ACA prod (primary)** | `auth=None` (platform validated upstream); `EasyAuthGate` middleware enforces role check. |
| `proxy` | **DEV ONLY** — never use in prod | `auth=AzureADOAuthProxy(...)` in process. ⚠️ Has open CVEs. Marketing Brain currently uses this; see Addendum A for migration plan. |

Default to `none`.

---

## Code conventions (encode in CLAUDE.md per-project)

- **Async everywhere.** Tools are `async def`, share one `httpx.AsyncClient`.
- **Config via env, validate at startup.** Everything env-driven through a `Config` dataclass with `validate()`.
- **One tool = one upstream endpoint** (1:1 in v1). Apps in v2+ compose them.
- **Format at the boundary.** Tools return clean output, never raw nested upstream JSON.
- **Rate limit at the client, not the tool.** All tools inherit it free.
- **No comments restating code.** Document non-obvious WHY only.
- **Logging:** structured, ASCII-only (Windows-safe), never includes auth headers, secrets, or sensitive content (transcripts, customer data).
- **Stateless servers.** Don't keep per-user state in process — Multiple revision mode + traffic split for blue-green requires it.
- **No sticky sessions** in production. (Marketing Brain currently has them; that's tied to its in-process OAuthProxy and will go away with the migration.)

---

## Common pitfalls (each saved a session)

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Hardcoded port | Railway/ACA healthcheck "service unavailable" | `int(os.getenv("PORT") or os.getenv("MCP_PORT") or "8000")` |
| `uv run` at boot | Container exits with `OSError: Readme file does not exist` | Use `.venv/bin/python server.py` |
| Multiple start-command sources | Boot doesn't match what you read in repo | Pick one, align the others |
| `.env` not loaded in container | Server crashes "Missing required env vars" | `from dotenv import load_dotenv; load_dotenv()` at top of `server.py` |
| Easy Auth enabled before image is healthy | 401-loop forever | Deploy without auth → verify `/health` 200 → then enable auth |
| Easy Auth set to `RedirectToLoginPage` | MCP clients can't follow HTML redirect → opaque failures | Use `Return401` per Microsoft MCP-on-ACA doc |
| Plaintext secrets in env vars | Visible to anyone with `Microsoft.App/containerApps/read` | Always Key Vault references via `keyvaultref:` |
| Admin-user ACR pull | Flagged by PSRule, password rotation pain | Managed identity + `AcrPull` role |
| `:latest` tag in production | No rollback path, no audit trail | Dual-tag semver+sha; deploy by digest |
| Sticky sessions in prod | Forces Single revision; breaks blue-green | Stateless server, drop affinity |
| `appRoleAssignmentRequired=false` | Any tenant user can sign in | Always `true`; assign role explicitly |
| API ID resolution via `/users` | External participants show as numeric IDs | Many APIs have a `parties`/`extensive` endpoint that names everyone — check the upstream's data model |
| `Edit` on `~/.claude.json` | "File has been modified since read" | Node.js atomic read-modify-write (Claude Code writes continuously) |
| First Custom Connector install | Microsoft sign-in surprises users | Document in connector README so admins prep teammates |
| `ctx.fastmcp_context.http_request` accessed in middleware | Middleware fails closed silently; every authenticated user denied; unit tests with mocked context pass because the mock has the attribute the real `Context` doesn't | Use `get_http_request()` from `fastmcp.server.dependencies`, wrapped in `try/except (RuntimeError, LookupError)` to fail closed on STDIO / background tasks |
| Only `on_call_tool` and `on_read_resource` gated | Tool roster enumerable to unauthenticated callers via `list_tools` if they reach the container directly | Gate all listing + get hooks (`on_list_tools`, `on_list_resources`, `on_list_resource_templates`, `on_list_prompts`, `on_get_prompt`) — but NOT `on_initialize` (gating breaks the MCP handshake) |
| Audit log shows `upn=<unknown>` for every deny | `name_typ_value` is not a real Easy Auth principal key — UPN lives in `claims[*]` with `typ` in `("preferred_username", ".../upn", ".../name")` | Walk the claims list for one of those three `typ` values, fall back to `<unknown>` |
| Easy-Auth-only endpoint for a **Claude Custom Connector** | Connector can't complete OAuth — bare `401`, no `resource_metadata`, `.well-known` 401'd | App-owned OAuth: FastMCP `RemoteAuthProvider` + `AzureJWTVerifier` advertises PRM. See Phase 10 |
| `aiohttp` not in deps | `azure.identity.aio` raises `ImportError` building its async pipeline; masked by SDK-mocked tests, fires on first live Cosmos/KeyVault call | Add `aiohttp>=3.9` (azure-core doesn't pull it) |
| Connector secret = a multi-purpose app's secret | Anthropic-held credential compromise takes down SSO / token-exchange too | Dedicated CLIENT app reg; existing app stays RESOURCE/audience; pin `azp` |

---

## Memory hooks

When you (the future Claude Code session) successfully ship a connector following this playbook:
- Add a learning to global memory: `scope:global,fastmcp,connector,<name>`, type `WORKING_SOLUTION`
- Update this playbook with anything new you learned (new pitfall, simpler step, better default)
- Cross-reference back to the project's `CLAUDE.md` "Lessons Learned" section

---

## Reference projects

| Project | Use case |
|---------|----------|
| `gong-mcp` (`C:\Users\david.hayes\Projects\gong-mcp\`) | Smallest working example. v1 on Railway with no auth (DEV-ONLY). v2 plan in `docs/v2-plan.md` predates this update — re-baseline against this doc before executing. |
| `fourth-marketing-brain` (`C:\Users\david.hayes\fourth-marketing-brain\`) | Prod deployment showing FastMCP middleware + apps patterns. **Diverges on auth and secrets** — see Addendum A. Reference for tool/middleware patterns ONLY. |

---

# Addendum — Future Work Tracker

This section is a living list of architectural improvements we've decided are worth doing but aren't blocking new builds. Update as items land.

## A. Marketing Brain migration (out of compliance with this playbook)

**Current state of `mcp-marketing-prod` (verified 2026-05-06 via `az containerapp show`):**

| Aspect | Current | Should be |
|--------|---------|-----------|
| Auth | FastMCP `OAuthProxy` in-process (`AUTH_MODE=proxy`); has open CVEs | Easy Auth + `Return401` + `EasyAuthGate` middleware |
| Easy Auth | Disabled (`platform.enabled=false`) | Enabled with `Return401` |
| Per-user gating | `appRoleAssignmentRequired=false` — any tenant user can sign in | `appRoleAssignmentRequired=true`, custom App Role assigned |
| App Roles | None defined | One `Mcp.User` role |
| Secrets | Cosmos key, AI Search admin key, AAD client secret in PLAINTEXT env vars | All Key Vault references via `keyvaultref:` |
| ACR pull | admin-user with password (`agentarchacr` admin enabled) | Managed identity + `AcrPull` role |
| Naming | `mcp-marketing-prod` (legacy) | `ca-mcp-marketing-brain` (CAF) |
| Revisions | Single (sticky sessions on) | Multiple + traffic split (after dropping sticky sessions) |
| Tags | SHA-only (`mcp-marketing:1c6161f`) | Dual semver + SHA, pin by digest |

**Migration runbook (do in this order; each step is reversible until the next):**

1. **Move secrets to Key Vault** (no behavior change)
   - `az keyvault secret set` for cosmos-endpoint, cosmos-key, search-endpoint, search-key, aad-client-secret
   - Grant CA managed identity `Key Vault Secrets User` on `agent-arch-kv-prod`
   - Update CA env vars to `keyvaultref:` form
   - Verify `curl /health` still 200; tools still work
2. **Switch ACR pull to managed identity** (no behavior change)
   - `az role assignment create --assignee <CA-MI-principal> --role AcrPull --scope <ACR-id>`
   - `az containerapp registry set --identity system --server agentarchacr.azurecr.io`
   - Disable admin user: `az acr update --name agentarchacr --admin-enabled false`
   - Verify next deploy succeeds
3. **Add `EasyAuthGate` middleware to MB code**
   - Same code as in Phase 6 of this playbook
   - Set `auth_mode=easyauth` config switch but keep `AUTH_MODE=proxy` env var for now (no runtime change)
   - Tests + smoke test still pass
4. **Define App Role + assignment requirement on the AAD app**
   - Create `Mcp.User` role with new GUID
   - `az ad sp update --set appRoleAssignmentRequired=true`
   - Assign all current authorized users via `appRoleAssignments` POST
5. **Drop sticky sessions, switch to Multiple revision mode**
   - `az containerapp ingress sticky-sessions set --affinity none`
   - `az containerapp revision set-mode --mode Multiple`
6. **Switch to Easy Auth**
   - `az containerapp auth microsoft update` with the existing AAD app
   - `az containerapp auth update --action Return401 --enabled true`
   - Verify approved user works, unassigned user gets `AADSTS50105`
7. **Drop `OAuthProxy`**
   - Update env: `AUTH_MODE=easyauth` (drops AZURE_CLIENT_SECRET dependency)
   - Remove `auth=AzureADOAuthProxy(...)` from MB's `server.py`
   - Deploy
   - Verify `EasyAuthGate` denies forged principals
8. **Optional rename** — `ca-mcp-marketing-brain`
   - Container apps can't be renamed. Create new app with the new name pointing at the same image.
   - Repoint Anthropic Custom Connector URL.
   - Delete old `mcp-marketing-prod` after a 2-week grace period.

**Estimated effort:** 1-2 days end-to-end, mostly waiting for OAuth flows to verify each step. Steps 1-2 are background work with zero user impact; 5-7 are the user-impacting bits.

## B. Container Apps Environment migration to Workload Profiles v2

**Current:** `locmap-env` is a legacy Consumption-only environment. New environments default to Workload Profiles v2 (Consumption profile selected by default; Dedicated D-series/E-series profiles can be added without recreating the env).

**Trigger to migrate:** when we hit ~5 services in `locmap-env`, or when any single service needs more than 4 vCPU / 8 GB (Consumption ceiling), or when we need VNet integration.

**Plan:**
1. Create `cae-agent-prod` (or similar) in same RG, Sweden Central, Workload Profiles v2, Consumption profile selected
2. For each container app, deploy a copy in the new env (different name like `ca-mcp-<service>-v2`)
3. Verify all services healthy in the new env
4. Repoint Anthropic Custom Connector URLs and `~/.claude.json` entries
5. Delete the v2 suffix copies after rename to canonical names
6. Decommission `locmap-env` (delete container apps in old env first)

**Estimated effort:** 2-3 days when we hit the trigger.

## C. New CAEs for non-MCP workloads

Out of scope for this playbook, but tracking: `agent-arch-env` in West Europe (legacy) hosts older API. Long-term plan: consolidate to Sweden Central, retire West Europe env.

## D. Dashboard

The architecture diagram shows `ca-agent-arch (dashboard)` as a planned app. Not yet deployed. Whenever it lands, follow this playbook for naming + auth patterns.

## E. ACR replication / region co-location

Current: ACR `agentarchacr` is in North Europe; CAE `locmap-env` is in Sweden Central. Cross-region pull works but adds ~20-30 ms latency on cold starts and a small egress charge. Options:
- Enable ACR geo-replication to Sweden Central (Premium SKU; not Basic — would require SKU upgrade)
- Or accept the cost — for low-RPS MCPs it's negligible

**Trigger:** if we ever observe a perf issue traceable to image pull.

## F. Cosmos DB / AI Search co-location

Same story: data services in North Europe, compute in Sweden Central. ~20-30 ms RTT per call. Acceptable for current MCP volumes; if any service starts doing high-RPS Cosmos point-reads or AI Search calls in a tight loop, add a Sweden Central read region to Cosmos and configure SDK preferred region.

## G. Marketing Brain GitHub Actions modernization

Current `fourth-marketing-brain/.github/workflows/deploy.yml` uses:
- SDK auth (`AZURE_CREDENTIALS` JSON secret) — should migrate to OIDC federated identity
- SHA-only tagging — should add semver
- Hardcoded `master` branch — should match repo default
- `:latest` second tag — should remove (or only use for non-prod)

Migration is low risk: update workflow file, set new repo secrets, test on a feature branch.

---

## Verification log (when this playbook itself was last verified)

| Item | Verified | How |
|------|----------|-----|
| `locmap-env` exists in Sweden Central | 2026-05-06 | `az containerapp env list -g rg-agent-architecture` |
| `agentarchacr` is shared registry | 2026-05-06 | `az acr repository list --name agentarchacr` |
| MB at `mcp-marketing-prod` runs `auth_mode=proxy` with Easy Auth disabled | 2026-05-06 | `az containerapp show` + `az containerapp auth show` |
| MB plaintext secrets | 2026-05-06 | `az containerapp show` showing `COSMOS_KEY`, `SEARCH_KEY`, `AZURE_CLIENT_SECRET` as `value:` not `secretRef:` |
| MB `appRoleAssignmentRequired=false` | 2026-05-06 | `az ad sp show --id <APP_ID>` |
| Microsoft `mcp-authentication` doc says `Return401` | 2026-05-06 | [learn.microsoft.com/en-us/azure/container-apps/mcp-authentication](https://learn.microsoft.com/en-us/azure/container-apps/mcp-authentication) |
| FastMCP OAuthProxy CVEs | 2026-05-06 | [CVE-2026-27124](https://advisories.gitlab.com/pkg/pypi/fastmcp/CVE-2026-27124/), [CVE-2025-69196](https://advisories.gitlab.com/pkg/pypi/fastmcp/CVE-2025-69196/) |
| Anthropic Custom Connector OAuth 2.1 + DCR | 2026-05-06 | [platform.claude.com/docs/en/agents-and-tools/mcp-connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) |
| CAF naming `ca-` for Container App | 2026-05-06 | [Microsoft CAF abbreviations](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) |

When you re-verify this doc in the future, refresh this table.
