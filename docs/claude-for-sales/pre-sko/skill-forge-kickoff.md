# skill-forge Kickoff — build a Skill *with* Claude

Playbook Step 5. A rep turns a repeated piece of their work into a reusable Skill by answering questions, not by writing from a blank page. This is the paste-prompt that starts it, calibrated against the real `skill-forge` skill's **Capture Intent** flow and its **Claude.ai platform adaptation**.

## What skill-forge actually does on claude.ai (be honest with reps)

`skill-forge` is a full skill-authoring lifecycle (author → validate → test → optimize → package). On **Claude Code / Cowork** it runs the heavy machinery — subagent eval runs, quantitative benchmarks, description-optimization loops. On **claude.ai the core still works** and is exactly what reps need:

- **Capture Intent** — Claude interviews you: what the skill enables, when it triggers, the output shape, and 3–5 concrete example uses.
- **Write the SKILL.md** — Claude drafts it (YAML frontmatter `name` + `description`, then markdown instructions).
- **Sanity-test** — you run 1–2 real examples yourself and give feedback inline.
- **Improve** — Claude refines from your feedback.

What's **skipped on claude.ai** (set expectations, don't promise it): parallel baseline eval runs, quantitative benchmark viewer, the `claude`-CLI description-optimization loop, blind A/B. Reps don't need those to make a useful first skill.

**Prerequisite:** custom Skills must be enabled for the workspace, and the `skill-forge` skill installed there (enablement team's job — ties to the Day-1 platform gate, Gate A). If it isn't installed, the prompt below still works: Claude runs the same interview-and-author method conversationally, just without the named skill.

## The kickoff prompt (paste inside a Project)

```
Use the skill-forge skill to help me turn a repeated piece of my sales work into a reusable
Skill. If skill-forge isn't available, just run the same method conversationally.

The task I want to package: [describe it — e.g. "research a hospitality prospect and produce a
confidence-tagged 5-card brief"].

Capture intent first — interview me ONE question at a time to learn:
1. What should this skill let you do for me?
2. When should it trigger — what would I type or ask?
3. What's the exact output shape I want?
4. The hard rules (for me: cite a source per fact, tag confidence verified/reported/inferred,
   never fabricate a name — role-only + "verify on LinkedIn" when a name isn't public).
Also get 3 concrete example uses from me before drafting.

Then draft the SKILL.md — YAML frontmatter (name, description that says when to trigger), then
clear markdown instructions with my output shape and rules baked in. Show it to me before we
finalize. Keep it lean — a first skill, not an encyclopedia. After I approve, tell me the one
line to add to this project's Custom Instructions so you know when to use it.
```

## Wire-it-in (after the skill is saved)

Add to the project's Custom Instructions so the project reaches for the skill on its own:

```
When I ask you to research an account, use the account-research skill and follow its output
shape exactly — every fact confidence-tagged, no fabricated names.
```

---

## Dry-run — kickoff on a real task

Ran the kickoff's logic on **"research a hospitality prospect and produce a confidence-tagged brief."** The Capture-Intent exchange (abbreviated):

- **Q: What should it let me do?** → Turn a prospect name + segment into a research brief I can prospect with.
- **Q: When does it trigger?** → "Research this account," "build a brief on [company]," "who do I call at…"
- **Q: Output shape?** → A fixed 5-card brief (snapshot, buying committee, buying signals, incumbent vendor, cold-call brief), every fact tagged.
- **Q: Hard rules?** → Cite sources; tag confidence; never invent a name — role-only + "verify on LinkedIn" when not public; built-in web search only.
- **3 examples given** → "Research Sweetgreen for me," "who's the ops leader at [chain]," "what scheduling tool does [group] use."

The SKILL.md it drafts (a lean first skill — the fuller production version is `../skills/account-research/SKILL.md`):

```markdown
---
name: account-research
description: Research a hospitality prospect and produce a confidence-tagged 5-card brief using
  built-in web search. Trigger when I say "research this account", "build a brief on [company]",
  "who do I call at [company]", "what are they using today", or ask for outside-in context on a
  prospect I'm about to work.
---

# Account Research

Turn a hospitality prospect (a restaurant or hospitality company) into a 5-card research brief
I can prospect with. Use built-in web search only. The goal is a brief I trust enough to open a
real conversation.

## Rules (these are the point, not footnotes)
- Put exactly one confidence tag on every fact: [VERIFIED] (named clickable source), [REPORTED]
  (press/secondary), [INFERRED] (reasoned).
- Never invent a name, title, or vendor. Unknown = "not found in public sources — verify manually."
  When a person's name isn't public, give the role only + "verify on LinkedIn (my manual step)."
- Start at the prospect's own site (/news, /about, /leadership) + hospitality trade press before
  a generic search. If a search comes back empty, don't retry it — go to a direct source.

## Output — always this shape
# Research Brief: [Prospect]
## C1 — Company Snapshot — what they do · segment/locations · ownership · recent headline (each tagged)
## C2 — Buying-Committee Map — roles, plus public names where a source exists (role-only otherwise)
## C3 — Buying-Signal Scan — expansion / funding / leadership change / ops job postings (dated, tagged)
## C4 — Incumbent-Vendor Check — current scheduling/labor software, or "verify manually"
## C5 — Cold-Call Brief — Opener · First call target · Sharpest signal · Fourth angle
## Research Gaps — what's honestly unknown

After presenting, ask if I want any card re-checked before I start dialing.
```

**Why this proves the kickoff works:** the output is a valid claude.ai Agent Skill (correct frontmatter + a triggering description + a fixed output shape + the honesty rules), it's lean enough for a rep's first skill, and it's the same shape as the production `account-research` skill — so a rep who builds this pre-SKO already owns the muscle the SKO Account Cockpit relies on. It also aligns 1:1 with the mock interview transcript in the Work-Area Playbook artifact.

## Next layer

Once a rep has 2–3 skills or a multi-step process, the playbook's Step 6 prompt has Claude suggest an **orchestrator** that sequences them — the same pattern as the SKO `account-planner`.
