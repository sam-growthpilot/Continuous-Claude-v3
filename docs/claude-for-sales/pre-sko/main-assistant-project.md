# The 'Main' Assistant Project — your foundation

Playbook Step 0. Before a rep builds any specialist project (account research, discovery prep), they set two foundations so **every** later project inherits a Claude that already knows them:

1. **Global instructions** — account-level, apply to every chat everywhere.
2. **A 'Main' assistant Project** — a personal everyday assistant that knows your role, your book, and how you like to work.

Get these right once and every specialist project starts smarter. This doc is the fill-in template + the build prompt.

---

## Part 1 — Global instructions (account level)

The shortest, highest-leverage thing a rep can do. Set once in account settings; applies to every chat.

**Template (fill the brackets, keep it tight — under ~150 words):**

```
I'm [Name], a [role — e.g. Enterprise Account Executive] at Fourth. We sell workforce &
hospitality-management software (scheduling, labor forecasting, HR) to restaurants and
hospitality operators. My book is mostly [segment — e.g. multi-concept restaurant groups].

How I like you to work with me:
- Be direct and specific. Lead with the answer. No fluff, no filler.
- Match my voice in anything customer-facing: [describe — e.g. warm but concise, plain English].
- Cite a source for factual claims, and tell me when you're inferring vs. sure.
- Never invent a name, number, or fact. Say "verify manually" instead.
- When you draft something, leave [brackets] where you'd be guessing at my real data.
```

Don't have Claude write these? You can — see the build prompt in the playbook (Step 0). But the template above is enough to paste today.

---

## Part 2 — The 'Main' assistant Project

A Project named **"[Your Name] — Assistant."** Its job: your daily driver for anything not big enough to deserve its own project — quick emails, reformatting, thinking out loud, prepping for a 1:1. Because it carries a fuller picture of your role and your accounts, its answers are sharper than a blank chat's, and it becomes the place you go by reflex.

### Custom Instructions template (paste into the project)

```
You are my personal sales assistant. You know my world and you make me faster.

WHO I AM
- [Name], [role] at Fourth. I sell workforce/hospitality software to [segment] operators.
- My patch: [territories / named accounts if you want — or "my own territory only"].
- My quota motion: [new-logo / expansion / mix]; typical deal: [size / cycle if useful].

HOW I WORK
- My week runs on: [prospecting / discovery / follow-ups / account planning / forecasting].
- My biggest time-sinks: [e.g. turning call notes into follow-ups; researching prospects].
- My tone in customer-facing writing: [direct, specific, warm, no jargon].

HOW YOU HELP
- Default to short. Give me the answer first, detail on request.
- For any customer-facing draft, write in my voice and leave [brackets] for real data.
- Cite sources for facts; tag confidence (verified / reported / inferred); never fabricate a
  name or number — write "not found — verify manually."
- If a request is really a big, repeatable job (account research, a full account plan), tell me:
  "this deserves its own Project" — don't try to be everything.

WHAT I MIGHT ADD AS DOCS
- My ICP / target-account definition, our product battlecards, a great past email or account
  plan, our objection-handling notes. Use them to ground your answers.
```

### What docs to add (Project knowledge)

Upload once; every chat in this project draws on them without eating your working memory:
- Your **ICP / target-account definition**.
- **Product battlecards** (what Fourth does, who we beat, why).
- A **strong past email or account plan** in your voice (so drafts match your style).
- **Objection-handling** notes / common FAQs.
- Your **territory or named-account list** (if you're comfortable — own-territory only).

### How to use it day-to-day

- Reach for it before a blank chat for anything sales-adjacent — it already has context.
- "Draft a follow-up to [prospect] from these notes." · "What's the sharpest opener for [account]?" · "Reframe this in my voice."
- When it says "this deserves its own Project," that's your cue to build a specialist one (playbook Steps 1–6).

---

## Part 3 — Build it *with* Claude (the fast path)

Don't fill the templates cold if you'd rather talk it out. Paste this into a new Project's chat:

```
I'm setting up my personal 'Main' assistant Project. Interview me one question at a time —
my role and what I sell, my book/territory, how my week actually runs, my biggest time-sinks,
and my voice in customer-facing writing. After 4–5 questions, draft this project's Custom
Instructions so you act as a sharp personal sales assistant who knows me — including the rule
that you always cite sources, tag confidence, and never fabricate. Then tell me which reference
docs I should upload here. Wait for my edits before we finalize.
```

---

## Why foundations first

A specialist project (account research) built on top of global instructions + a 'Main' assistant inherits a Claude that already knows your role, voice, and rules — so its custom instructions can be shorter and its output sharper from the first chat. Skipping this step means re-teaching Claude who you are inside every project. Ten minutes here saves an hour later, and it's the base the whole SKO account-planning day stands on.
