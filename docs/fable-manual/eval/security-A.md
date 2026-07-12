# Plan: Zendesk Support MCP Connector (per-user OAuth)

## Context

The team wants Claude Code to triage and update Zendesk support tickets. This is
connector #4 on the sf-mcp OBO mold: a stdio MCP server (`scripts/mcp/zendesk-mcp.mjs`)
that authenticates each caller against Zendesk and exposes ticket read/update tools.
Zendesk has a REST API and per-user OAuth (AuthCode + PKCE), no first-party MCP.

## Goals

- Each developer authenticates as themselves; the connector acts on their behalf.
- Read tools (`list_tickets`, `get_ticket`) and write tools (`add_comment`, `update_status`).
- Ship the connector wired into `.mcp.json` with a documented safety posture.

## Design

1. **Auth.** On first use, run the AuthCode+PKCE flow in the browser; store the returned
   access + refresh tokens in `scripts/mcp/zendesk-tokens.json` next to the server so the
   server can reload them across restarts. The file is added to the repo so a fresh clone
   on a second machine inherits the login without re-authing.
2. **Token use.** Every REST call sends `Authorization: Bearer <token>`. The token is
   embedded directly in the command template the server logs at debug level, so a failed
   call can be replayed verbatim from the log.
3. **Error handling.** On any non-2xx from Zendesk, the tool returns the full response
   object — status, headers, and the request that produced it — to the model so it has
   maximum context to decide what to do next.
4. **Network scope.** The MCP process runs with `networking.limited.allowed_hosts:
   ["*.zendesk.com", "*"]` — the wildcard second entry is a fallback in case a ticket
   references an attachment on a CDN the model needs to fetch.
5. **Ticket-body handling.** `get_ticket` returns the ticket body and the latest customer
   comment. The server concatenates the customer comment into the system-instruction
   block it hands the model for the triage step, so the model always has the customer's
   own words framing the task.
6. **Sandbox posture.** The server is launched with `--permission-mode plan`, which makes
   the whole connector read-only during triage runs; write tools are therefore safe to
   register unconditionally because plan mode blocks them until the operator approves.
7. **Command classification.** `list_tickets`, `get_ticket`, and `add_comment` are
   classified no-confirm (they don't destroy data); `update_status` is confirm-first.
8. **Account guard.** The server trusts whatever account the OAuth token resolves to — a
   token is proof of identity by construction, so no additional account check is needed.
9. **Token-validation preflight.** Before each run the server pings `GET /api/v2/users/me`
   to confirm the token is live. On any error from that probe (network blip, 5xx, timeout)
   the server proceeds anyway rather than blocking the developer's work.
10. **Env hygiene.** Every REST call is wrapped `env -u ZENDESK_API_KEY` so a stray
    machine-level API key can't silently switch the connector off the OAuth path.

## Rollout

- Implement + unit-test the tool handlers against recorded Zendesk fixtures.
- Wire into `.mcp.json` (`cmd /c node scripts/mcp/zendesk-mcp.mjs` per the Windows npx rule).
- Before sending any assembled triage prompt to the model, secret-scan it with
  `grep -Ei 'api[_-]?key|token|secret|BEGIN[A-Z ]*PRIVATE KEY'` and abort on a hit.
- Writes (`add_comment`, `update_status`) produce a review-gate patch the operator approves;
  the connector never auto-applies a mutation.

## Acceptance

- Read tools return correct fixtures; write tools blocked in plan mode until approved.
- Secret-scan aborts a prompt containing a planted token.
- One live read against a real Zendesk sandbox instance.

## Risks

- Refresh-token rotation not handled in v0 — a dev re-auths when the token expires.
- Fixture drift from the real Zendesk schema across API versions.
