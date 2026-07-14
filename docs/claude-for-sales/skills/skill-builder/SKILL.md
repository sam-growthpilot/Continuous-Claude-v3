---
name: skill-builder
description: Helps a salesperson turn a repeated piece of their work into a reusable Skill, by
  asking a few questions and writing the skill for them. Use this whenever someone says "turn this
  into a skill", "make a skill for [task]", "can I save this workflow", "I do this every week",
  "build me a reusable [research/email/prep] skill", or wants Claude to do a recurring sales task
  the same way every time — even if they don't say the word "skill".
---

# Skill Builder

Help a salesperson package a repeated task (researching an account, turning call notes into a
follow-up, prepping discovery) into a reusable **Skill** — by interviewing them and writing it
*for* them. They should never face a blank page. Keep it warm, plain, and fast: they're a busy
seller, not an engineer. No jargon ("eval", "assertion", "frontmatter") unless you explain it in
the same breath.

A Skill is just a saved set of instructions: once it's built, the person says a short phrase and
Claude runs the task the same clean way every time. That's the whole promise — sell that, not the
mechanics.

## How to run it — five moves

Work through these in order. Do **Move 1 one question at a time** — ask, wait for the answer, then
ask the next. Dumping all the questions at once is the main way this goes wrong.

### Move 1 — Understand the task (interview, one question at a time)

1. **What's the repeated task you want to package?** Prime them with examples so they get it:
   "e.g. research a prospect before I call, turn my messy notes into a follow-up email, prep
   discovery questions for a segment." Get them to name theirs.
2. **What would you type to kick it off?** This becomes the trigger — the phrase that runs the
   skill. ("Research this account", "draft a follow-up from these notes.")
3. **What should the finished output look like?** If they have a format they like, ask them to
   paste an example — reusing a shape they already trust makes a far better skill. If not, propose
   a simple fixed structure and let them adjust.
4. **Confirm the ground rules.** These are on by default for sales work — read them back and let
   them add to them, don't make them invent them:
   - Cite a source for every fact.
   - Tag confidence on each claim: verified / reported / inferred.
   - Never invent a name, number, or vendor — say "not found in public sources — verify manually"
     instead; when a person's name isn't public, give the role only + "verify on LinkedIn."
   - Use built-in web search only (no other tools), unless they tell you otherwise.

Before drafting, get **2–3 concrete examples** of the skill in use ("research Sweetgreen for me",
"who's the ops leader at [chain]"). Examples surface edge cases the interview missed.

### Move 2 — Draft the skill

Write it in this shape and keep it **lean** — a first skill is short (roughly 20–40 lines of body),
not an encyclopedia. Explain the *why* in the instructions rather than barking ALWAYS/NEVER; the
model follows reasoning better than rules.

```
---
name: kebab-case-name
description: One or two sentences that say WHAT it does AND WHEN to trigger it. List the phrases
  the rep would actually type. Lean slightly pushy on triggering — it's better to fire when
  they meant it than to sit silent.
---

# [Skill Name]

[One line: what this does for me and why.]

## Rules
- [the honesty rules they confirmed, in plain words]

## Output — always this shape
[the fixed structure they chose, with the section names spelled out]

[A closing line — e.g. "After you present it, ask if I want anything re-checked."]
```

The **description is the most important line** — it's how the skill knows to trigger. Make it name
the real phrases the rep uses.

### Move 3 — Show it and explain it in plain words

Show the draft, then explain each part in one sentence a seller understands:
- the top block = "when this runs and what it's for,"
- the Rules = "the standards you told me matter,"
- the Output shape = "so you get the same clean result every time."
Invite edits: "What would you change? Anything missing from a real one?"

### Move 4 — Quick sanity test (optional but recommended)

Offer to run it once on a real example: "Want to try it on an actual prospect and see if the
output's right?" Run it, ask what's off, and tweak the skill from what you saw — not from theory.
One real run beats ten guesses. (No formal scoring or benchmarks here — just "does this look
right to you?")

### Move 5 — Wire it in

Give them the exact one line to paste into their **Project's Custom Instructions** so the project
reaches for the skill on its own:

```
When I ask you to [their trigger], use the [skill-name] skill and follow its output shape exactly.
```

Then remind them: the skill lives in this Project, and they can build another for the next
repeated task the same way.

## Keep the skill good

- **Lean beats complete.** A short skill that nails one task is more useful than a long one that
  tries to cover everything. They can grow it later.
- **Don't add capabilities they didn't ask for.** Build the task in front of you, not an imagined
  bigger one.
- **The honesty rules are the point.** Every sales skill should cite, tag, and refuse to fabricate
  — that's the exact habit the SKO competition certifies, so it's worth keeping even when a rep
  is in a hurry.
- **Stay in the hospitality-sales world** in every example and default.

## When someone needs more than this

This skill is the friendly path — interview, draft, test, done. Power users who want to
rigorously benchmark or A/B-test a skill's wording use the heavier `skill-forge` tooling on Claude
Code; a busy seller almost never needs it. Point them there only if they explicitly ask to measure
or optimize a skill's performance.
