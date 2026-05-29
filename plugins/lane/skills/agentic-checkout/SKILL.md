---
name: agentic-checkout
description: Hand a Lane intent off to checkout-mcp's autonomous agent. The agent walks each mandate via a LangGraph state machine, drives Stagehand on Browserbase to populate the cart, then the Lane API gate-checks + retrieves credentials + the agent submits + the API confirms to VGS — all in one `/agent/checkout` SSE call.
metadata:
  display_name: Lane — Agentic Checkout via MCP
  version: 1.0.0
disable-model-invocation: false
---

# Agentic Checkout (Agent Flow, MCP-driven)

`POST /agent/checkout` on the **checkout-mcp** service is the autonomous
counterpart to [`payment-execution`](../payment-execution/SKILL.md). The
human-driven `lane-cli pay` walks one mandate at a time with explicit
passkey + cryptogram steps; `/agent/checkout` hands the whole purchase intent
to an LLM that drives a real browser end-to-end.

Use this flow when the **caller is itself an LLM agent** that holds a
Lane apiKey and wants checkout-mcp to drive the merchant's site
autonomously.

## When to choose this flow

| Flow                               | Driver  | Per-mandate | Cryptogram step | Submit step |
| ---------------------------------- | ------- | ----------- | --------------- | ----------- |
| `lane-cli pay` (payment-execution) | Human   | One at a time | CLI ceremony   | Direct CLI  |
| `/agent/checkout` (this skill)     | LLM     | Walks all   | Internal       | Stagehand   |

Pick this skill when the user prompt is "buy X" and you want the agent
to find a merchant, populate a cart, and complete the order without
further intervention.

## Prerequisites

- A `lint_*` purchase intent in `active` status with at least one mandate.
  Drafted via the **intent-mcp** service (`mcp__intent-mcp__submit` →
  user approves the draft).
- The user has at least one passkey-enrolled card on file (the intent
  draft binds the agentic token id to that card).
- A valid Lane apiKey for the caller (Bearer auth on every request).

## Wire format

```bash
curl -N \
  -H "Authorization: Bearer ${LANE_API_KEY}" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  https://checkout.getonlane.com/agent/checkout \
  -d '{
    "prompt": "buy a small iced latte from Equator Coffees",
    "intentId": "lint_abc123"
  }'
```

**Required body fields**

| Field      | Type   | Notes                                          |
| ---------- | ------ | ---------------------------------------------- |
| `prompt`   | string | User-facing instruction the agent acts on.     |
| `intentId` | string | intent id (`lint_*`). The graph fetches it. |

There is **no** `mandateId` parameter — the LangGraph loop walks every
mandate on the intent sequentially. Pass-through fields like
`merchantUrl` are also absent: the agent picks the merchant.

**SSE event types** the server emits:

| Event       | Payload                                                          |
| ----------- | ---------------------------------------------------------------- |
| `phase`     | `{phase: 'init' \| 'mandate:<id>' \| 'complete' \| 'error'}`      |
| `assistant` | `{text}` — model's narration.                                    |
| `tool_call` | `{name, durationMs, ok, error?}` — one per tool invocation.      |
| `complete`  | `{ok, laneIntentId}` — terminal success.                         |
| `error`     | `{code, message}` — terminal failure.                            |

## What happens inside checkout-mcp

```
START
  │
  ▼
loadIntent ──▶ fetch all mandates
  │
  ▼
selectNext ── pick next active mandate ──▶ runMandate
  │                                         │
  │                                         ▼
  │               ┌── per-mandate ReAct agent (Claude) ───┐
  │               │  init_session                          │
  │               │  choose_merchant                       │
  │               │  view_product                          │
  │               │  add_to_cart                           │
  │               │  checkout  ◀── atomic, fires ONCE      │
  │               └────────────────────────────────────────┘
  │                                         │
  ▼                                         ▼
finalize ◀──── (more mandates? yes → loop) ── outcome
  │
  ▼
END
```

The `checkout` tool is the atomic finisher. It:

1. Detects the merchant's payment form.
2. Gate-checks the agent's audit log (every prior tool call) against the
   mandate's conditions. On denial it stops the run cleanly with
   `condition_gate_denied`.
3. On allow: retrieves the single-use cryptogram.
4. Fills the payment form and submits.
5. Polls the page for a confirmation indicator (bounded retry).
6. Extracts the order id + line items.
7. Records the confirmed outcome with Lane.

The agent never sees the cryptogram bytes. The Lane apiKey on the SSE
request authorizes both `/payment-credential` and
`/payment-confirmation`.

## Tools the agent has access to

Surface inside the ReAct loop (you do **not** invoke these — the LLM
does):

- **Semantic** — `init_session`, `choose_merchant`, `view_product`,
  `add_to_cart`, `checkout`, `get_session_state`, `end_session`.
- **Primitives** — `goto`, `act`, `observe`, `extract`, `screenshot`,
  `dom_snapshot` (escape hatches when a semantic tool fails).
- **Knowledge** — `get_sitemap`, `list_known_merchants`,
  `record_sitemap_observation`.

`submit_agentic_credentials` is **not** in the agent's tool surface —
`checkout` folds credential filling inside.

## Browserbase lifetime

Sessions have a Browserbase-enforced 30-minute ceiling. We do not track
this client-side: if a tool call returns a `SESSION_EXPIRED` error
(HTTP 440 at the boundary, `code: SESSION_EXPIRED` inside the SSE
`error` event), open a fresh `/agent/checkout` connection with the
same `intentId`.

## Failure modes

| Error code                  | Meaning                                                                 | Recovery                                                                |
| --------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `INTENT_NOT_FOUND`          | intent id doesn't exist or isn't owned by the caller.                | Re-draft via intent-mcp.                                                |
| `CONDITION_GATE_DENIED`     | Lane API gate said the audit log doesn't satisfy the mandate.            | Tell the user *what* mismatched; do NOT retry the same prompt.          |
| `CREDENTIAL_FILL_FAILED`    | Page isn't a payment form, or selectors didn't match.                    | Capture a screenshot via the agent; surface to the user.                |
| `VERIFICATION_TIMEOUT`      | Submit clicked but no confirmation page observed within 30s.             | Order may still have succeeded — instruct the user to check email.      |
| `SESSION_EXPIRED`           | Browserbase reaped the upstream session.                                 | Reconnect to `/agent/checkout`; do not retry on the same SSE channel.   |
| `MAX_ITERATIONS_REACHED`    | Agent hit the 25-iteration cap without completing the mandate.           | Drop a hint in the prompt; retry once at most.                          |

`mandate_failed` for one mandate stops the whole run (fail-fast). Later
mandates on the same intent stay `pending` — the user can re-issue the
intent or pick the failing mandate manually via the human flow.

## When to fall back to `lane-cli pay`

- The merchant requires a CAPTCHA, 3DS challenge, or any input the
  agent can't satisfy.
- The mandate is one-of-a-kind (rare item, time-critical) and the user
  wants to drive it personally.
- The intent has more than ~3 mandates — the longer the run, the higher
  the chance one mandate trips the gate and stalls the rest.
