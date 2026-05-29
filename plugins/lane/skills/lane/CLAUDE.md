---
name: lane
description: Lane CLI router skill. Decides which sub-skill applies based on whether the user needs to set up an account / cards (setup flows), draft a purchase via the intent-mcp (LLM flow), or pay a stored purchase intent (agent-scriptable flow).
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
| "Buy X" / "I need a flight" / "approve $N for Y"                | `mcp__intent-mcp__submit` to draft, then `payment-execution` to charge          | Agent  |
| "Pay this draft" / "charge `lint_…`" / "complete the purchase"  | `payment-execution` with `lane-cli pay --lane-intent <lint_*>`                  | Agent  |
| "Show me my drafts" / "list my intents"                         | `lane-cli intents`                                                              | Agent  |

If the user starts with no Lane account, walk them through `lane-cli init --intent login` → `lane-cli wallet add` → `lane-cli wallet enable-agentic` automatically. After that, the per-purchase loop is: **(a)** draft via intent-mcp → **(b)** `payment-execution`.

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
| `mcp__intent-mcp__submit({prompt, session_id?})`                                             | Agent                         | Draft / clarify a purchase intent. Returns `draft_ready` + `approval_url`, `needs_info`, or `complete`.     |
| `mcp__intent-mcp__get_intent_status({session_id})`                                           | Agent                         | Poll after sharing `approval_url`. Flips to `complete` once the user finishes the FIDO ceremony.        |
| `lane-cli pay --lane-intent <lint_*> [--mandate-id <mand_*>] --card <last4>`                 | Agent                         | Per-mandate: preflight + passkey ceremony + cryptogram. Run once per mandate, sequentially. Does NOT auto-confirm. |
| `lane-cli confirm --intent-id <iid> [--mandate-id <mid>] --result <approved\|declined>`      | Agent                         | Record the merchant outcome. Mandatory after every `pay` call.                                          |
| `lane-cli request --config <intent.json>`                                                    | Direct                        | **Legacy / non-LLM**. Hand-rolled intent for scripts & manual testing. Returns `intent_*`.              |
| `lane-cli pay --intent-id <intent_*>`                                                        | Direct                        | **Legacy / non-LLM**. Cryptogram against an existing direct intent.                                     |
| `lane-cli logout`                                                                            | Agent                         | Clear local credentials.                                                                                |

---

## Hard Rules

1. **The user should never have to type a `lane-cli` command themselves.** The agent runs every command. When a command opens a browser, run it, narrate what the user needs to do in the browser, then verify completion before continuing.
2. **The LLM-driven purchase flow uses the intent-mcp + `lane-cli pay --lane-intent`.** Do NOT use `lane-cli request` for LLM-driven purchases — `request` is the direct / script path that skips the conversational drafting.
3. **A card must be passkey-enabled** before `lane-cli pay` will work. If the user just added a card, run `lane-cli wallet enable-agentic` before any purchase flow.
4. **Treat cryptograms and network tokens as one-time secrets.** Pass them to the merchant; don't echo them into long-lived chat history.
5. **Always confirm.** Run `lane-cli confirm` after every `lane-cli pay`. Without it the audit log is incomplete.
6. **Iterate multi-mandate intents sequentially.** Mint → checkout → confirm mandate N, then move to mandate N+1.

---

## Status Check

Before any purchase flow, confirm the user is set up:

```bash
lane-cli wallet ls
```

- "Lane isn't set up on this machine yet" → run `lane-cli init --intent login`, browser opens automatically, guide user through auth, verify.
- "No cards yet" → run `lane-cli wallet add`, guide user through card entry in browser, then run `lane-cli wallet enable-agentic`, guide user through passkey tap, verify.
- Cards listed but none agentic-enabled → run `lane-cli wallet enable-agentic <last4>`, guide user through passkey tap, verify.
- At least one enabled card → safe to call `mcp__intent-mcp__submit`.

---

## Sub-Skills

- [`account-setup`](../account-setup/SKILL.md) — `lane-cli init` flow detail.
- [`wallet-setup`](../wallet-setup/SKILL.md) — `lane-cli wallet add` + `enable-agentic` flow detail.
- [`create-intent`](../create-intent/SKILL.md) — **legacy / direct** `lane-cli request` path. NOT for LLM-driven purchases.
- [`payment-execution`](../payment-execution/SKILL.md) — `lane-cli pay --lane-intent <lint_*>` in full detail.
