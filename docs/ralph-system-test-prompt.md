# Ralph System Test Prompt — Full Pipeline Validation

> **Purpose:** Copy-paste this entire prompt into a fresh Claude Code session (in the `continuous-claude` project directory) to test all 6 Ralph v4.0 enhancements end-to-end.
>
> **What it tests:**
> 1. Structured PRD template (spec-kit) — user stories, Given/When/Then, non-goals
> 2. Cross-artifact validation gate — ralph-validate-plan.py catches gaps
> 3. Two-stage code review — spec compliance then quality review
> 4. Rationalization prevention tables — visible in delegation context
> 5. Task parallelism markers — parallel_group and user_story fields
> 6. Hard gates — XML gates at phase transitions
>
> **Expected duration:** 15-25 minutes for full pipeline

---

## The Prompt

```
I want to use /ralph to build a new feature for the Workbook platform (spark-platform project).

**Feature:** Cross-Department AI Communication Layer (Phase 4 from the SPARK Evolution Guide)

Here's the context:

The Workbook platform (~\spark-platform) is an AI-powered executive meeting and workspace platform. It's a Next.js 15 + React 19 monorepo with:
- `apps/web/` — main Next.js app
- `packages/database/` — Drizzle ORM + Neon Postgres schema (18 tables)
- `packages/types/` — shared TypeScript types

The platform currently has workspace-scoped AI agents (one per department). Phase 4 calls for a **multi-agent communication layer** where department AI agents can:

1. **Publish events** to a shared bus when decisions, action items, or escalations happen in their workspace
2. **Subscribe to relevant cross-department events** (e.g., OPS agent subscribes to Professional Services delivery updates that affect ops scheduling)
3. **Roll up summaries to the ELT portal** — Shannon (exec assistant) needs a unified view of all department decisions and pending action items
4. **Escalate automatically** — when a department AI detects a cross-cutting decision that needs ELT approval, it creates an escalation in the ELT workspace

Technical constraints:
- Must use the existing Drizzle schema pattern (workspace-scoped, all queries enforce workspace isolation)
- Must work with the Agent SDK (`@anthropic-ai/claude-agent-sdk`) already in use
- Must be implementable as new MCP tools added to the existing `mcp-tools.ts` pattern
- Events should be stored in Postgres (not a separate message broker) — keep it simple
- The ELT workspace is a special "super-workspace" that can read events from all departments
- No new external dependencies — use existing stack only

Stakeholder requirements (from the evolution guide):
- Jay (COO): Needs to see when Professional Services decisions affect OPS scheduling
- Shannon (Exec Assistant): Needs unified dashboard of all dept decisions + pending items for board prep
- Action items created in one department that reference another department should appear in both

This is a MEDIUM-sized feature (not small, not huge). I expect roughly 8-12 tasks.

Please go through the full Ralph workflow — PRD with user stories, task breakdown, validation, and delegation plan. Stop after the validation gate (Phase 2.6) so I can review the plan before you start delegating.
```

---

## What to Verify After Running

### Enhancement 1: Structured PRD Template
- [ ] PRD file created at `/tasks/prd-cross-dept-comm.md` (or similar)
- [ ] Contains `### US1 [P1]:` style user stories with priorities
- [ ] Each user story has `**Given** ... **When** ... **Then** ...` acceptance criteria
- [ ] Has an explicit **Non-Goals** section
- [ ] Has **Success Metrics** table (technology-agnostic)
- [ ] Has `[NEEDS CLARIFICATION]` markers (max 3) or states none needed
- [ ] Has **Technical Considerations** section populated with actual project info

### Enhancement 2: Validation Gate
- [ ] Ralph ran `ralph-validate-plan.py` after task breakdown
- [ ] Output shows story coverage count (e.g., "3/3 stories covered")
- [ ] Output shows task count and flags if >15
- [ ] Validation result explicitly shown before asking to proceed

### Enhancement 3: Two-Stage Review (visible in plan)
- [ ] SKILL.md Phase 4 references 4a (spec compliance) and 4b (code quality)
- [ ] If Ralph mentions the review plan, it describes TWO stages (not one)

### Enhancement 4: Rationalization Prevention
- [ ] Phase 3 delegation section includes the rationalization prevention table
- [ ] If Ralph resists delegating (e.g., "I can just do it"), the table should counter it

### Enhancement 5: Parallelism Markers
- [ ] Task breakdown includes `[P]` markers or `parallel_group` labels
- [ ] Tasks reference `[US1]`, `[US2]` etc. linking back to user stories
- [ ] If tasks stored in `.ralph/state.json`, check for `parallel_group` and `user_story` fields

### Enhancement 6: Hard Gates
- [ ] `<HARD-GATE>` appears in Ralph's output at phase transitions
- [ ] Ralph explicitly stops at the validation gate (Phase 2.6) as requested
- [ ] Ralph does NOT enter delegation loop before validation passes

---

## Grading Rubric

| Grade | Criteria |
|-------|----------|
| **A** | All 6 enhancements visible in output. Structured PRD with real user stories. Validation runs and reports. Parallelism markers present. Hard gates respected. |
| **B** | 4-5 enhancements visible. PRD has structure but may skip some sections. Validation runs. Some markers missing. |
| **C** | 2-3 enhancements visible. PRD is semi-structured. Validation may be skipped. Minimal parallelism metadata. |
| **D** | Only 1 enhancement visible. PRD is freeform. No validation. No markers. |
| **F** | Ralph ignores the new enhancements entirely and runs the old v3.2 workflow. |

---

## Known Limitations

- Ralph may not literally output `<HARD-GATE>` XML tags to the user — they're internal skill markers that guide behavior. Check if Ralph *respects* the gates (stops before delegation) even if it doesn't display them.
- The validation script may flag "no tasks file found" if Ralph uses a different naming convention — check the path it generates.
- The `spark-platform` project isn't in the project registry — Ralph may need to be told the path explicitly.
- If Ralph asks clarifying questions during Phase 1, that's correct behavior (not a failure). Answer with the stakeholder info from the evolution guide.

---

## Quick Answers for Ralph's Interview Questions

If Ralph asks clarifying questions during Phase 1, use these:

- **Primary user?** Shannon (exec assistant) for ELT view, Jay (COO) for OPS workspace
- **Auth model?** Demo mode (bypassed) — no auth constraints for now
- **Event types?** Decisions, action items, escalations, status changes
- **Volume?** Low — maybe 20-50 events per week across all departments
- **Real-time?** No — polling or page refresh is fine for MVP
- **Which departments first?** OPS and Professional Services (2 departments + ELT)
- **Notification preference?** In-app only (no email/Slack for MVP)
