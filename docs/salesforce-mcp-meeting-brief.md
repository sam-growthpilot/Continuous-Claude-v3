# Salesforce MCP Server — Meeting Brief

> **Date:** 2026-03-27 | **Purpose:** Architecture review + decision sign-off | **Duration:** 60 min

---

## 1. What We Are Building

We are building a **custom MCP (Model Context Protocol) server** that gives every AI assistant in the company — Claude, Copilot Studio, Teams, Cowork — secure, governed access to our Salesforce data through a single endpoint.

**Why custom?** Salesforce's own hosted MCP covers basic CRUD. It does not cover department-specific analytics, Bulk API, Entra ID integration, multi-org support, or the tool governance our security posture requires.

---

## 2. Architecture at a Glance

```
  AI CLIENTS                        AZURE                        SALESFORCE
  ──────────                        ─────                        ──────────
  Claude.ai  ──┐
  Claude Code ──┤  OAuth DCR /   ┌─────────────────┐
  Copilot Studio┤  Entra ID   ──>│ Azure API Mgmt  │──> ┌────────────────────┐
  Teams ────────┤               │  (Auth gateway,  │    │ FastMCP Server     │
  Cowork ───────┘               │   rate limits,   │    │ (Container Apps)   │
                                │   analytics)     │    │                    │
                                └─────────────────┘    │  40+ tools         │
                                                        │  Auth middleware   │
                                          ┌─────────────│  SF client pool    │
                                          │             └────────────────────┘
                                          │
                              ┌───────────┴────────────┐
                              │                        │
                         ┌────┴──────┐         ┌──────┴────┐
                         │ Azure Key │         │ Azure     │
                         │ Vault     │         │ Monitor   │
                         │ (certs,   │         │ (logs,    │
                         │  keys)    │         │  metrics) │
                         └──────────┘         └───────────┘
                                          Salesforce REST / SOQL / Bulk / Reports
```

**Request path:** User asks AI → APIM validates token → FastMCP maps Entra user to SF user → JWT Bearer gets SF access token → SF enforces field-level security → response returned.

---

## 3. Key Decisions for This Meeting

| # | Decision | Options | **Recommendation** | Owner |
|---|----------|---------|-------------------|-------|
| 1 | Single-org vs multi-org from day 1? | A) Single org first B) Multi-org now | **A — Single org first.** Reduces Phase 1 complexity ~40%. Multi-org is additive later. | SF Admin, IT |
| 2 | APIM from day 1 or add later? | A) Direct to Container Apps B) APIM from start | **B — APIM from start.** Claude DCR and Entra ID require different auth handling; adding later means rewiring all clients. | DevOps |
| 3 | soql_query tool: free-form or restricted? | A) Accept any SOQL with validation B) Parameterized queries only | **A — Free-form with allowlist.** LLMs are effective SOQL generators. Parameterized queries kill the natural-language-to-data value prop. Allowlist prevents injection. | Security, SF Admin |
| 4 | Include delete_record tool? | A) Include with confirmation prompt B) Exclude from v1 | **B — Exclude from v1.** High risk, rarely needed via AI. Revisit after v1 usage patterns are understood. | Business stakeholders |
| 5 | User-to-Salesforce mapping method | A) Email match (Entra = SF email) B) Custom attribute C) Mapping table | **A — Email match** unless SF usernames diverge. Works for 90% of orgs, simplest to implement. | SF Admin, IT |
| 6 | Bulk API access: who gets it? | A) Ops/Admin only B) Ops + Executive C) All departments | **A — Ops/Admin only.** Bulk can move large data volumes; restrict to trained users initially. | Security, Ops |
| 7 | Development environment | A) SF sandbox + Azure dev B) SF Developer Edition + Azure C) Shared SF sandbox only | **A — SF sandbox + Azure dev.** Mirrors production topology; Developer Edition lacks needed features. | SF Admin, Budget |
| 8 | Monitoring visibility | A) Central IT only B) Per-department dashboards C) Both | **C — Both.** IT needs operational visibility; department leads need adoption metrics. Azure Monitor supports both at no extra cost. | IT, Dept leads |

---

## 4. What Each Department Gets

**Sales**
- Ask "How does my pipeline look this quarter?" and get a stage-by-stage breakdown
- Move opportunity stages, log calls/meetings, pull forecast data
- Run any saved pipeline report with natural-language filters

**Marketing**
- Campaign performance: responses, conversions, ROI in one question
- Find leads by score range or source; add them to campaigns instantly
- Compare campaign ROI across time periods

**Support / Success**
- Create and escalate cases with validated required fields
- Search Knowledge articles while on a call to find resolutions faster
- Pull SLA entitlements and support metrics on demand

**Ops / Admin**
- Bulk update up to 10K records via a single instruction
- Run data quality reports to find records with missing required fields
- Inspect object metadata, automation status, and API usage limits

**Executive**
- "Give me a business snapshot" returns KPIs, pipeline, and trend vs. prior period
- Run any saved dashboard or report by name
- Cross-object queries spanning multiple SF objects in one call

---

## 5. Tech Stack Summary

| Component | Technology | Why |
|-----------|-----------|-----|
| MCP Framework | **FastMCP 3.1.1+ (Python 3.12)** | Decorator-based tools, built-in Azure auth, Streamable HTTP transport |
| Compute | **Azure Container Apps** | Serverless, auto-TLS, KEDA autoscaling, free-tier friendly for dev |
| Gateway | **Azure API Management** | Unifies Claude OAuth DCR + Entra ID behind one URL; rate limiting |
| Secrets | **Azure Key Vault** | Stores SF X.509 certs and private keys; accessed via Managed Identity |
| Identity | **Entra ID (Azure AD)** | User identity + group-based permission mapping |
| SF Auth | **JWT Bearer Token** | Per-user token; preserves SF field-level security and sharing rules |
| Observability | **Azure Monitor + OpenTelemetry** | Logs, metrics, traces; no record data ever logged |
| CI/CD | **GitHub Actions** | Build, test, push to Container Registry, deploy |

---

## 6. Auth Flow (Simplified)

Every request passes through three auth boundaries before touching Salesforce data.

```
User (Entra ID identity)
    |
    v
AI Client  ──[OAuth DCR or Entra token]──>  Azure APIM
                                                |
                                    Validates token (iss, aud, exp, sig)
                                    Extracts: email, groups, tenant ID
                                                |
                                                v
                                         FastMCP Server
                                                |
                                    Maps Entra email → SF username
                                    Fetches X.509 cert from Key Vault
                                    Signs JWT assertion, exchanges for SF token
                                                |
                                                v
                                         Salesforce API
                                    (FLS + sharing rules enforced per user)
```

**Key property:** The server never stores record data. Each user gets only what their Salesforce profile allows — the MCP layer cannot grant broader access than SF would allow directly.

---

## 7. Implementation Timeline

| Phase | Weeks | Goal | Key Milestones |
|-------|-------|------|----------------|
| **1 — Foundation** | 1–3 | Working server on Azure, accessible from Claude Code | Auth end-to-end, 9 universal tools, deployed to dev |
| **2 — Department Tools** | 4–7 | All 42 tools live, permission model enforced | Sales + Marketing + Support + Ops + Exec tools; rate limiting |
| **3 — Skills & Plugins** | 8–10 | Packaged workflows for each department | 5 department skills, prompt templates, distributable plugin bundle |
| **4 — Multi-Client** | 11–12 | All 5 platforms connected and tested | Claude.ai, Copilot Studio, Teams, Cowork; production hardening |

**First value delivered: end of Week 3.** Claude Code users can query Salesforce with natural language.

```
Wk:  1    2    3  |  4    5    6    7  |  8    9    10  |  11   12
     [===Phase 1==]  [======Phase 2=====]  [===Phase 3====]  [Phase 4]
     Foundation      Dept Tools            Skills            Multi-Client
```

---

## 8. Cost Estimate

| Environment | Monthly Cost | Notes |
|-------------|-------------|-------|
| **Dev** | $0–5 | Container Apps + APIM both have generous free tiers (1M calls/mo) |
| **Light Production** | $15–30 | Low usage, consumption pricing, no reserved capacity |
| **Medium Production** | $50–100 | ~50–200 active users, standard traffic patterns |
| **Heavy Production** | $200–500 | APIM Standard tier + high volume; budget alerts recommended |

Free tier covers: 180K vCPU-seconds/mo (Container Apps), 1M API calls/mo (APIM), 10K Key Vault operations/mo.

---

## 9. Top 5 Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|-----------|
| 1 | **SOQL injection via LLM** | CRITICAL | Allowlist objects/fields; escape string literals; never build SOQL from raw user input |
| 2 | **JWT cert expiration** | CRITICAL | Key Vault alerts at 30/7/1 day before expiry; automated rotation runbook |
| 3 | **SF API rate limit exhaustion** | HIGH | Composite API batching (3–5x reduction), 24h metadata cache, per-user quotas, circuit breaker |
| 4 | **Data leakage via LLM context** | HIGH | Per-user JWT (SF enforces FLS), never cache records, sanitize all error messages |
| 5 | **Entra ID outage** | HIGH | Token caching keeps existing sessions alive; fallback to cached group mappings |

---

## 10. Next Steps

Coming out of this meeting, the following actions are needed:

1. **Sign off on all 8 decisions** (table in Section 3) — assign owners to any that need follow-up research before sign-off
2. **SF Admin:** Confirm Entra email = SF username mapping is valid for our org; if not, define the custom attribute approach
3. **SF Admin + IT:** Provision a Salesforce sandbox and create a Connected App with JWT Bearer enabled
4. **DevOps:** Confirm Azure subscription and create resource group `rg-sf-mcp`; verify APIM Consumption tier is available
5. **Security:** Review and approve the SOQL allowlist approach (Decision 3) and data handling policy (no caching of records, no PII in logs)
6. **Engineering lead:** Assign Phase 1 team (est. 2–3 engineers for 3 weeks); kick off repo setup and FastMCP scaffolding
7. **IT + Dept leads:** Agree on Entra ID group naming convention (`SG-SF-Sales`, `SG-SF-Marketing`, etc.) and permission set names in SF

---

*Full architecture document: `docs/salesforce-mcp-architecture.md`*
