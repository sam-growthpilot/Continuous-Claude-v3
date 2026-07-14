# Facilitator Cheat Sheet — Claude for Sales @ SKO

**Print double-sided. Keep it in your hand while you float.** One page of firewall + degraded modes, one page of "say this" + the veto gate. Dave floats the 0:08–0:42 failure-dense window; you own your room.

---

## 1. THE TUESDAY CARD — say it out loud, point at it when a rep is confused

This is the tool-confusion firewall. Reproduce it **verbatim** every time a rep mixes up what Claude is for:

- **Claude** = "my thinking partner that researches and drafts."
- **Fourth Encyclopedia** = "my phone lookup for product facts."
- **Fourth Brain** = "coming later — Claude plugged into our internal docs."

**One-line enforcement:** Claude researches the *prospect* and drafts the *plan*. It does **not** answer "what does Fourth's forecasting module do?" — that's the **Encyclopedia**. It does **not** read our internal docs — that's **Brain, not live yet**.

---

## 2. DEGRADED-MODE TABLE — when the tech breaks, nobody debugs on the clock

Rule of the room: **auth and installs are finished in the 15-min Setup Block at plenary-end, before any breakout clock starts.** If something fails, the rep does NOT lose exercise time — they **flag the IT floater and switch to the fallback pack (`example-plan.md`)**. The Harbor & Vine worked example lets any rep participate fully by studying "what good looks like."

| Failure | What the rep sees | Facilitator move (exact fallback) |
|---|---|---|
| **Salesforce auth fails** (login/MFA won't complete, "opportunities" don't appear) | On-screen success check "your account's opportunities appear" never lands | Flag **IT floater**. Rep runs the breakout **hand-filling the 6-field context** — SF demotes to demo-only for them. Study `example-plan.md` PART B §1 for what a fused snapshot looks like. Never burn breakout time debugging auth. |
| **Built-in web search off** (admin-disabled, no results) | `account-research` returns nothing / errors on C1–C5 | Flag **IT floater**. Rep uses the **fallback pack (`example-plan.md`)** as the worked example and follows along; they build the *shape* by hand from the Harbor & Vine brief. |
| **Skill won't install** (App Skill not visible / install errors) | No `account-research` or `account-planner` in the Project | Flag **IT floater** for the admin-push path. Rep works from the **fallback pack** + pasted prompt cards for this session; skill install gets fixed after the room. |
| **Connector throttles / slows** (SF pulls hang under concurrent load) | Snapshot pull spins, especially many reps at once | **Stagger SF pulls by table** — call tables in waves (Table 1 pulls, then Table 2, …). Reps waiting read `example-plan.md` §1 meanwhile. This is the pilot-tested concurrency plan. |

**Universal fallback:** `docs/claude-for-sales/account-planning-kit/example-plan.md` (Harbor & Vine). It is the fallback pack **and** the gold standard. A rep who can't get live tooling still participates by studying it. Screen-share **only** this anonymized demo account — never a rep's live Project.

---

## 3. DATA-HANDLING — facilitator DO / DON'T

| DO | DON'T |
|---|---|
| Keep reps on **their own-territory accounts** — Salesforce sharing rules are the boundary. | **Don't** ask any rep to widen their SF access to "see more." Sparse data = *check your access*, not an error. |
| Screen-share **only the anonymized demo/fallback account** (Harbor & Vine). | **Don't** project a rep's live Project or real pipeline account on the room screen. |
| Keep contact data **inside the rep's own Project**. | **Don't** let any prompt or skill produce a **bulk contact export** — it's banned in every card. |
| Remind reps: "your account Project is a working tool — treat its contents like Salesforce data." | **Don't** use another rep's live pipeline account as a competition surprise account (those are public-web or synthetic composites only). |

---

## 4. WHEN A REP ASKS X, SAY Y

| Rep asks… | You say… |
|---|---|
| **"Claude made up a name / a stat — is that real?"** | "No — that breaks the **no-fabrication hard rule** (it's judged). Every named person must trace to a **clickable source**, or be role-only with **'title to verify on LinkedIn (rep's manual step)'.** Unknown facts must read the verbatim **'not found in public sources — verify manually.'** If it invented one, call it out and re-run that card." |
| **"Where do I find the decision-maker / who do I call?"** | "Public sources give you the **role**; the **person** you verify on **LinkedIn — that's your manual step**, the skill never scrapes it. C2 outputs the role plus 'title to verify on LinkedIn (rep's manual step)' when the name isn't public." |
| **"Which tool do I use for product facts (what does module X do)?"** | "The **Fourth Encyclopedia** — your phone lookup for product facts. Claude is your thinking partner for *prospect* research and drafting, not Fourth product answers." (Tuesday Card.) |
| **"Can I research an account outside my territory / my buddy's account?"** | "No — **own-territory only.** Salesforce sharing rules are the boundary. Pick something you own." |
| **"Salesforce is sparse / almost empty — is it broken?"** | "That means **check your access**, not an error. Write the plan defensively — don't assume Activities/Tasks are in scope, and never read sparse activity as 'nothing happened.'" |
| **"Can Claude just pull all the contacts for me?"** | "No **bulk contact exports** — ever. Contact data stays in your Project. Map roles + one public name, that's it." |
| **"Do I say renewal date?"** | "No — it's an **opportunity close date**. This is a **new-logo** motion. Vocabulary is **sales**: prospect, buying committee, opportunity — not customer/renewal." |
| **"It's asking me to approve — what do I say to move forward?"** (Enterprise Cockpit gates) | "The planner runs **3 gates**: **Gate 1 Account Brief**, **Gate 2 Plan Outline**, **Gate 3 Qualification-Translation Quality Pass.** Advance each with an explicit phrase — **'looks good' / 'proceed' / 'build it' / 'approved' / 'go ahead' / 'that's right' / 'continue.'** 'Nice/cool' is NOT approval. To change something, tell it what to fix — it re-presents the same gate." |
| **"My plan looks done — is it?"** | "Check **Section 8 (Qualification Translation)** against Harbor & Vine. If it reads like a **field dump** ('stage = Discovery', 'ownership = PE') it's NOT done — it must read as **health language** ('economic buyer not yet identified,' 'single-threaded — the #1 risk,' 'Compelling Event candidate,' 'metrics unquantified')." |
| **"Can I use the browser tool / Playwright I saw Dave demo?"** | "No — reps use **built-in web search only.** The Playwright demo is Dave's facilitator/Fourth Brain teaser, not in your flow." |
| **"I'm stuck on setup / auth."** | "Flag the **IT floater** and jump to the **fallback pack (`example-plan.md`)** — don't spend breakout time debugging." |

---

## 5. COMPETITION QUALITY-VETO GATE — facilitator disqualifies on the spot

The 10-min timer starts at the **surprise-account REVEAL** in the fresh blank Competition Arena Project (setup done in the 5-min pre-window — never counts against the clock). Judges verify against the **pre-built answer-key packet**, not the rep's own citations.

**A brief is DISQUALIFIED (facilitator veto) if ANY of these fails:**

- [ ] **A section is missing.** Beginner brief = all of **C1 Company Snapshot · C2 Buying-Committee Map · C3 Buying-Signal Scan · C4 Incumbent-Vendor Check · C5 Contact-Ready Cold-Call Brief** (C5 must carry its four sub-fields: **Opener / First call target / Sharpest signal / Fourth angle**). Enterprise plan = all **8 sections in order**. Any section absent → **veto.**
- [ ] **An untraceable named person.** Every named person must trace to the **answer key or a clickable source**, or be role-only "title to verify on LinkedIn (rep's manual step)." A fabricated name → **instant veto** (this is the certification bar).
- [ ] **Confidence tags missing.** Every factual claim carries exactly one **[VERIFIED] / [REPORTED] / [INFERRED]**. Untagged assertions → **veto.**
- [ ] **Unknowns not flagged verbatim.** Gaps must read the exact string **"not found in public sources — verify manually"** — no padding, no invented fill.
- [ ] **(Enterprise) Section 8 is a field dump, not qualification translation** → **veto.** It must read as MEDDPICC-style health language.

**Judges spot-check 2 random claims per finalist against the answer key.** Fastest **VALID** brief wins = the certification moment. **Speed never beats validity — a fast brief with a fabricated name loses to a slower clean one.**

---

*Fallback / gold standard / acceptance fixture is one file: `account-planning-kit/example-plan.md` (Harbor & Vine — fictional). If a rep's live output doesn't look like that, it isn't done.*
