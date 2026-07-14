# Salesforce Connector Runbook — Account Cockpit (Enterprise Tier)

**What this file is for:** the single reference for how the Salesforce connector gets set up before
SKO, how a rep authenticates it at the table, what to do when data looks sparse, and what to do if
auth fails during the event. Print-ready — the facilitator cheat sheet and the Setup Block script
both point here instead of re-explaining it.

**Confidence tags used throughout:** `[VERIFIED]` direct from a named clickable source OR Salesforce ·
`[REPORTED]` secondary/press source · `[INFERRED]` reasoned, not directly sourced.

---

## 1. Admin Provisioning Summary (IT pre-work — NOT a live SKO step)

The Salesforce connector is a **Hosted MCP Server** — Salesforce's own integration surface for
Claude, not a Fourth-built tool. It is **admin-provisioned before the event**. No rep, facilitator,
or IT floater does any part of this section at the table.

| Item | What it is | Who does it | When |
|------|-----------|-------------|------|
| External Client App + OAuth config | Salesforce admin registers Claude as a connected app and configures the OAuth flow | Salesforce admin | Before SKO — day-1 platform gate |
| MCP server enablement | Admin turns on the specific hosted server(s) the workspace will use | Salesforce admin | Before SKO |
| Server = **`sobject-reads`** | Read-only record access (Accounts, Opportunities, Contacts, and — pending Gate C — Activities). **No write, no delete, no mutation server enabled for reps.** This is a deliberate scope choice: the Account Cockpit is a research and planning tool, not a Salesforce editing tool. | Salesforce admin | Before SKO |
| Rep-tier test authentication | Confirm a rep-tier test account can authenticate and pull a known account's Opportunities | Dave + Salesforce admin | Day-1 platform gate (Gate C1) |

**Why read-only:** reps drafting record updates back into Salesforce mid-conversation is a real
connector capability, but it is explicitly **out of scope for the Account Cockpit v1** — the kit's
job is producing the account plan, not touching the CRM. If this changes post-pilot, it requires a
new admin decision and a new gate, not a silent scope creep at SKO.

**This is IT/admin pre-work, full stop.** If any row above is not done by day 3 before SKO, Gate C
in `02-DAY1-PLATFORM-GATE.md` fails and the fallback in §5 below activates for the whole Enterprise
tier — not just for individual reps whose auth breaks at the table.

---

## 2. The Rep Auth Step (Setup Block, ~2 minutes of the 15-minute block)

This is the only Salesforce-connector action a rep performs, and it happens **before the breakout
clock starts** — in the 15-minute Setup Block at the end of the Claude 101 plenary, alongside device
check, workspace login, Project creation, and skill install.

**Steps (facilitator-led, IT floater present):**
1. In the rep's Account Cockpit Project, connect the Salesforce connector (workspace-provisioned —
   reps are not creating a new connection, just authorizing their own session).
2. Complete the OAuth prompt with the rep's own Salesforce credentials.
3. Ask Claude a one-line confirmation prompt (e.g., "show my open opportunities").

**On-screen success check (verbatim, matches Gate C1):**

> **"Your account's opportunities appear."**

If that line of text is on screen — real opportunity names/stages the rep recognizes — auth
succeeded and the rep is cleared for the breakout. Nothing else needs to be verified at the table.

**If it does NOT appear** (blank result, an error, a stuck OAuth prompt): the rep does **not**
troubleshoot during exercise time. Flag to the IT floater immediately (see §5 — Fallback) and move
on with the rest of the Setup Block.

---

## 3. Sparse-Data / Sharing-Rules Callout

**Sparse or empty results are not a connector failure.** Every Salesforce connector call executes
as the *authenticated rep* — the same profile, permission-set, and sharing-rule restrictions that
apply in the Salesforce UI apply identically here. If a rep can't see a record in Salesforce, Claude
cannot see it for them either, and it will not surface an error explaining why — it just returns
less than expected.

**What this means in practice:**
- A rep planning an account **outside their own territory** will get an incomplete or empty pull.
  This is expected behavior, not a bug.
- **The Account Cockpit is scoped to own-territory accounts only** (data-handling rule, §4) — this
  is not just a policy boundary, it's also the condition under which the connector returns full data.
- If a rep's *own* account looks unexpectedly sparse: the first troubleshooting step is **"check
  your Salesforce access,"** not "assume Claude failed" or "assume the connector is broken."

**Card language to reuse verbatim** (already baked into `example-plan.md` and the account-context
template): *"if data looks sparse, check your Salesforce access before assuming Claude failed."*

---

## 4. Object-Scope Caveat — UNVERIFIED (tied to Gate C)

The connector's high-level behavior (session-bound, sharing-rules-respecting, admin-provisioned) is
confirmed [VERIFIED — Salesforce Developers Blog, Salesforce Developers Docs]. **The exact
object-level default scope against Fourth's specific org is NOT yet confirmed** [INFERRED — flagged
in `external-best-practices.md` §2 and tracked as Gate C in `02-DAY1-PLATFORM-GATE.md`].

| Object | Status | Confidence |
|--------|--------|-----------|
| Accounts | Expected in scope by default | [INFERRED — pending Gate C2] |
| Opportunities / pipeline | Expected in scope by default | [INFERRED — pending Gate C3] |
| Contacts | Expected in scope by default | [INFERRED — pending Gate C4] |
| **Activities / Tasks** | **UNVERIFIED — may require an explicit permission-set grant, not default** | **[INFERRED — pending Gate C5, the specific open gap]** |

**Write defensively until Gate C resolves.** The account-context template and the account-plan
Section 1 caveat both state: if Activity history is sparse or absent, that means *check the gate
decision / check access* — do NOT read it as "no activity happened" and do NOT let the
`account-planner` skill's qualification-translation step silently assume Activities are populated.

**Before finalizing this section for SKO:** confirm Gate C's decision row in
`02-DAY1-PLATFORM-GATE.md` ("which objects are in-scope by default = ___") and update this table from
INFERRED to VERIFIED/CONFIRMED per object. Do not ship this runbook to reps with open INFERRED rows
in the Activities line without at least the gate's interim decision recorded.

---

## 5. Fallback: Rep's Salesforce Auth Fails at SKO

If a rep's connector auth fails during the Setup Block (or breaks mid-breakout) and cannot be
resolved in the moment:

1. **Flag to the IT floater immediately** — do not let the rep spend breakout time debugging OAuth.
   The IT floater triages: retry once, or defer.
2. **The rep uses `example-plan.md`** as their working reference for the rest of the session. It is
   built for exactly this: study the worked Harbor & Vine account plan (Part B) to see what a
   completed Salesforce-fused Section 1 (Account Snapshot) and Section 8 (Qualification Translation)
   look like, and hand-fill their own account-context template using what they already know about
   their real account instead of a live SF pull.
3. **The rep still participates fully** in the rest of the breakout (web research via
   `account-research`, synthesis, qualification translation) — only the Salesforce-pull prompt
   (breakout prompt 2) is skipped or replaced with hand-entry.
4. **This does not block the competition.** The Competition Arena is a fresh Project with no account
   context regardless of what happened in the breakout — a rep whose SF auth failed earlier competes
   on equal footing.

**Org-wide fallback (not an individual failure):** if Gate C or Gate D fails *before* SKO (connector
not provisioned in time, or pilot licenses refused), Salesforce demotes to **facilitator-demo only**
for the entire Enterprise tier, and hand-filled account context becomes the primary data path for
everyone — not just individual stragglers. That decision is recorded in
`02-DAY1-PLATFORM-GATE.md` Gate D, not here.

---

## 6. Data-Handling Note — **review with Sarah before SKO**

> This runbook, and every Salesforce-connector interaction it describes, is scoped to a rep's **own
> territory only** — Salesforce sharing rules are the access boundary, and the kit never asks a rep
> to widen visibility beyond what they already have. **No bulk contact exports** happen anywhere in
> this flow; contact data pulled via the connector stays inside the rep's own Project and is never
> aggregated, downloaded, or shared outside it. When a screen is projected to the room (Setup Block
> demo, facilitator walkthrough), only the anonymized `example-plan.md` account is shown — a rep's
> live Project with real prospect data is never screen-shared. Post-event, each Project remains
> rep-owned inside the Fourth-managed Enterprise workspace, subject to the org's existing retention
> controls — nothing new is created outside that boundary. **This paragraph needs a review pass with
> Sarah before SKO** to confirm it matches Fourth's actual data-handling expectations for the room.

---

*Print-ready. Companion files: `02-DAY1-PLATFORM-GATE.md` (Gate C, the object-scope decision this
runbook depends on), `example-plan.md` (the fallback pack + acceptance fixture referenced in §5),
`account-context-template.md` (where the sparse-data callout also appears on the rep-facing side).*
