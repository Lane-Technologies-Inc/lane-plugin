---
name: lane
description: Lane CLI router skill. Decides which sub-skill applies based on whether the user needs to set up an account / cards (setup flows) or make a purchase — draft a purchase intent, approve it with a passkey, then drive the autonomous checkout, all via the single lane-mcp server.
metadata:
  display_name: Lane — Agentic Commerce
  version: 6.0.0
  triggers:
    - lane
    - lane-cli cli
    - agentic commerce
    - agentic payment
    - buy
    - purchase
    - pay
    - intent
    - mandate
    - wallet
    - card
    - cryptogram
---

# Lane — Agentic Commerce CLI

Lane lets an AI agent authorize and execute payments on the user's card. The agent runs every command — the user should never have to type a CLI command themselves. When a command opens a browser, the agent runs it, narrates what the user needs to do in that browser, and verifies completion before continuing.

Pick the workflow below based on what the user is asking for.

---

## Intent / Mandate Model

**Rule 1 — One intent per user session/errand.**
Never create one intent per item. "Buy a tent and a backpack" → ONE intent, total ceiling. Multiple intents = multiple passkey ceremonies, fragmented audit log.

**Rule 2 — One mandate per merchant, as granular as possible.**
Multiple items from the same merchant stay in ONE mandate. Different merchants = different mandates inside the same intent.

**Rule 3 — Each `lane-cli pay --mandate-id` call mints a unique cryptogram.**
Run it once per mandate, sequentially. Never reuse a cryptogram; never run mandates in parallel.

---

## Decision Tree

| User says...                                                    | Where to go                                                                     | Driver |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| "Sign me up" / "create an account" / "log in to Lane"           | Run `lane-cli init --intent login`; browser opens automatically; tell user to complete auth | Agent  |
| "Add a card" / "enable agentic" / "set up my wallet"            | Run `lane-cli wallet add` then `enable-agentic`; tell user to complete in browser | Agent  |
| "Buy X" / "I need a flight" / "approve $N for Y"                | `lane` skill: `mcp__lane-mcp__intent_submit` to draft → user approves → `mcp__lane-mcp__start_session` drives checkout | Agent  |
| "Pay this draft" / "charge `lint_…`" / "complete the purchase"  | `lane` skill Step 3: `mcp__lane-mcp__start_session({intent_id})`, poll `get_session_status`, resume on `needs_human` | Agent  |
| "Show me my drafts" / "list my intents"                         | `lane-cli intents`                                                              | Agent  |

If the user starts with no Lane account, walk them through `lane-cli init --intent login` → `lane-cli wallet add` → `lane-cli wallet enable-agentic` automatically. After that, the per-purchase loop is: **(a)** draft via `intent_submit` → **(b)** user approves with a passkey → **(c)** `start_session` drives the autonomous checkout. See the `lane` skill for the full loop.

---

## Quick Command Map

| Command                                                                                      | Driver                        | Notes                                                                                                   |
| -------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `lane-cli init --intent login\|signup`                                                       | Agent runs, browser required  | Sign-up / log-in. Agent runs it with `--intent` flag (no TTY prompt); browser opens automatically; verifies with `wallet ls`. |
| `lane-cli` (no args)                                                                         | Agent                         | Interactive home menu.                                                                                  |
| `lane-cli wallet add`                                                                        | Agent runs, browser required  | Add a card. Agent runs it; tells user to enter card in browser; verifies with `wallet ls`.              |
| `lane-cli wallet enable-agentic [last4]`                                                     | Agent runs, browser required  | Passkey ceremony. Agent runs it; tells user to tap passkey; verifies with `wallet ls`.                  |
| `lane-cli wallet ls`                                                                         | Agent                         | Read-only status check.                                                                                 |
| `lane-cli wallet default <last4>`                                                            | Agent                         | Set the default card. Always pass `--card` explicitly regardless.                                       |
| `lane-cli wallet rm <last4> --yes`                                                           | Agent (confirm first)         | Destructive — agent confirms user intent verbally, then runs it.                                        |
| `lane-cli intents` / `lane-cli intents ls [--status=<s>]`                                    | Agent                         | List active purchase intents on file.                                                                        |
| `mcp__lane-mcp__intent_submit({prompt, session_id?})`                                             | Agent                         | Draft / clarify a purchase intent. Returns `draft_ready` + `approval_url`, `needs_info`, or `complete`.     |
| `mcp__lane-mcp__intent_get_status({session_id})`                                           | Agent                         | Poll after sharing `approval_url`. Flips to `complete` once the user finishes the FIDO ceremony.        |
| `mcp__lane-mcp__intent_get_terms({session_id, draft_session_id})`                          | Agent (chat surfaces)         | Chat surfaces (iMessage/WhatsApp/SMS via the `X-Lane-Surface` connection header) + card-on-file wallet: returns `inline_terms` to paste in-thread instead of a browser link. `use_link` on rich/passkey wallets → share `approval_url`. |
| `mcp__lane-mcp__intent_approve({session_id, draft_session_id, confirmation})`              | Agent (chat surfaces)         | Record the in-thread "yes" and approve card-on-file (no passkey/browser). COF-only; refuses passkey wallets. |
| `lane-cli pay --lane-intent <lint_*> [--mandate-id <mand_*>] --card <last4>`                 | Agent                         | Per-mandate: preflight + passkey ceremony + cryptogram. Run once per mandate, sequentially. Does NOT auto-confirm. |
| `lane-cli confirm --intent-id <iid> [--mandate-id <mid>] --result <approved\|declined>`      | Agent                         | Record the merchant outcome. Mandatory after every `pay` call.                                          |
| `lane-cli request --config <intent.json>`                                                    | Direct                        | **Legacy / non-LLM**. Hand-rolled intent for scripts & manual testing. Returns `intent_*`.              |
| `lane-cli pay --intent-id <intent_*>`                                                        | Direct                        | **Legacy / non-LLM**. Cryptogram against an existing direct intent.                                     |
| `lane-cli logout`                                                                            | Agent                         | Clear local credentials.                                                                                |

---

## Hard Rules

1. **The user should never have to type a `lane-cli` command themselves.** The agent runs every command. When a command opens a browser, run it, narrate what the user needs to do in the browser, then verify completion before continuing.
2. **The whole purchase flow runs through `lane-mcp`.** Draft/approve via the `intent_*` tools, then drive checkout via `start_session` / `get_session_status` / `resume_session`. `lane-cli pay`, `lane-cli confirm`, and `lane-cli request` are NOT part of the LLM-driven flow.
3. **A card must be passkey-enabled** before a purchase will work. If the user just added a card, run `lane-cli wallet enable-agentic` before any purchase flow.
4. **The checkout engine drives the merchant browser — you do NOT.** Never use Playwright/Bash/Python to navigate the merchant site; `start_session` runs it autonomously server-side. Poll its status and relay `needs_human` asks.
5. **Poll, don't wait.** After `start_session`, poll `get_session_status` (~3-5s) until terminal and `resume_session` (~5s) through every `needs_human` suspend — the live browser is reaped seconds after a suspend.
6. **One `start_session` per intent.** The engine walks every mandate itself; never spawn a second run for the same intent (dedup attaches to the live one).

---

## Status Check

Before any purchase flow, confirm the user is set up:

```bash
lane-cli wallet ls
```

- "Lane isn't set up on this machine yet" → run `lane-cli init --intent login`, browser opens automatically, guide user through auth, verify.
- "No cards yet" → run `lane-cli wallet add`, guide user through card entry in browser, then run `lane-cli wallet enable-agentic`, guide user through passkey tap, verify.
- Cards listed but none agentic-enabled → run `lane-cli wallet enable-agentic <last4>`, guide user through passkey tap, verify.
- At least one enabled card → safe to call `mcp__lane-mcp__intent_submit`.

---

## Sub-Skills

- [`account-setup`](../account-setup/SKILL.md) — `lane-cli init` flow detail.
- [`wallet-setup`](../wallet-setup/SKILL.md) — `lane-cli wallet add` + `enable-agentic` flow detail.
