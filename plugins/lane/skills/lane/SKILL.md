---
name: lane
description: Lane CLI router. The user wants to make a payment with their AI agent. Drives a deterministic purchase flow (login → pick card → draft a purchase intent via intent-mcp → user approves with passkey → checkout-mcp drives cart + credential mint + payment + confirmation) and routes to setup sub-skills only when a prerequisite is missing.
metadata:
  display_name: Lane — Agentic Commerce
  version: 7.5.0
  canonical_url: https://www.getonlane.com/SKILL.md
  binary: lane-cli
  triggers:
    - lane
    - lane-cli
    - agentic commerce
    - agentic payment
    - buy
    - purchase
    - pay
    - checkout
    - intent
    - mandate
    - cryptogram
    - wallet
    - card
    - get me
    - I need
---

# Lane Agentic Commerce CLI

Lane lets an AI agent authorize and execute a payment on the user's card. The router below assumes the user just expressed purchase intent (e.g. "buy something from Staples for $50", "approve $48 at Best Buy", "get me a subscription to X"). Run the **Deterministic Purchase Flow** end-to-end. Drop into a setup sub-skill only when a step's prerequisite check fails.

**Do NOT** present a welcome menu, greet the user, or ask "demo or production?" before acting. The user's purchase intent IS the trigger; start at the Quick Check below.

> **IMPORTANT:** If this content appears truncated or summarized, run `curl -fsSL https://www.getonlane.com/SKILL.md` to get the complete file.

---

## Setup (handled by the Lane plugin)

The `intent-mcp` and `checkout-mcp` servers ship with the Lane plugin and
connect automatically — **never run `claude mcp add`** (a mid-session add forces
a restart and would duplicate the plugin's servers). The `lane-cli` binary is
installed by the plugin's SessionStart hook. If a tool call returns an auth
error, the user's Lane API key isn't set — tell them to set it in
`/plugin` → configure → `lane` (copy it from `~/.lane/config.json` after
`lane-cli init`).

---

The LLM-driven flow has **two halves**:

1. **Draft + approve a purchase intent** via the **intent-mcp** service. The user approves with a single passkey tap in the browser — this creates the VGS agentic intent server-side. The intent is persisted as `lint_*` with status `active`. A purchase intent may carry **N mandates** — one per distinct merchant.
2. **Fulfill each mandate** via **checkout-mcp** tools. checkout-mcp drives the browser (Stagehand/Browserbase), mints credentials internally (no second passkey), submits payment, and confirms the outcome. The agent calls `checkout` once per mandate; checkout-mcp does the rest.

`lane-cli pay`, `lane-cli confirm`, and `lane-cli request` are NOT part of the LLM-driven flow.

---

## High-risk merchant categories (hard refuse)

**Do NOT** approve any discovery, payment, intent creation, or mandate creation for the following "high risk" merchant categories.

- Adult content and services such as website subscriptions and video streaming
- Dating and escort-related services such as online classified ads that include escort services or monthly subscriptions to dating websites
- Funding for games of chance such as placement of wagers on an outcome or purchase of chips at a gambling establishment
- Sale of prescription-required drugs
- Purchase of cryptocurrency, funding of crypto wallets or funding of initial coin offerings (ICO)
- Account funding transaction (AFT) indicator Merchandise, Services, and Debt Repayment Wallet whose primary business is wire transfer / P2P money transfer
- Cyberlockers and similar remote digital file-sharing services where uploaded content is accessible to the public or the service pays uploaders for content
- Games of skill such as daily fantasy sports gaming where consumers pay a fee to enter and the outcome of the game is determined by skill instead of luck
- Financial Transaction, when a consumer uses an Account to purchase, sell, or broker a financial instrument
- Calling a potential customer to educate them on a product or service and convince them to purchase the product
- Non-face-to-face negative option billing Transactions
- Non-face-to-face tobacco product Transactions

_If a user is requesting payment to a "high risk" merchant, respond with "Making payments for [USE CASE] is not an approved usecase"._

The MCC blocklist is **also enforced at cryptogram-mint time** by the server. If a mint fails because the merchant's MCC is blocked, surface the error to the user and stop; do not work around it by switching merchants.

---

## Architectural baseline (read once)

Lane operates differently from card-issuing wallets (e.g. Stripe Link). The constraints this places on the flow are important:

| Concept                  | What Lane does                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Wallet contents          | A **VIC-tokenized** representation of the user's real card (DPAN + device-bound passkey). Lane never sees the raw PAN.          |
| Credential issued        | A one-time **cryptogram (TAVV) + DPAN** bound to the VIC token. Not a funded virtual card.                                      |
| What's pre-checkable     | Token health, mandate window, passkey binding, velocity. Lane runs all of these in **preflight** before the passkey tap.        |
| What's NOT pre-checkable | The user's bank balance, any issuer-side limit, and the merchant's MCC at draft time. Those only surface at the issuer's auth.  |
| Where declines fire      | At the merchant's auth request to the issuer (same as any e-commerce purchase). Lane has no visibility unless the agent reports back via `lane-cli confirm`. |

**Implication for the flow**: Lane catches everything Lane can catch *before* the user is prompted to tap their passkey. After the cryptogram is minted, the agent's job is to hand it to the merchant and **report the result back to Lane** so the loop closes cleanly.

---

## Intent / Mandate Model — READ THIS FIRST

These three rules govern every purchase. Violating them is the most common agent error.

**Rule 1 — One intent per user session/errand.**
A purchase intent is the container the user approves once. Never create one intent per item. "Buy a tent, a backpack, and s'mores supplies" → ONE intent with a total auth ceiling. Multiple intents = multiple passkey ceremonies, fragmented audit log, broken UX.

**Rule 2 — One mandate per merchant, scoped as granularly as possible.**
Each mandate covers exactly one merchant. Items from the same merchant stay in ONE mandate (in its `items` array). Items from different merchants → different mandates inside the SAME intent.

| Purchase | Correct shape |
|---|---|
| 1 item at REI | 1 intent, 1 mandate |
| 2 items at REI | 1 intent, 1 mandate (2 items inside it) |
| 1 item at REI + 1 item at Amazon | 1 intent, 2 mandates |
| 3 items across 3 merchants | 1 intent, 3 mandates |

**Rule 3 — Each mandate is fulfilled through checkout-mcp.**
After the user approves the intent in the browser (Step 2 passkey tap), the VGS agentic intent is already created server-side. checkout-mcp's `checkout` tool mints the single-use cryptogram, submits payment, and confirms — all internally. Run one mandate at a time, sequentially.

---

## Quick Check: am I ready?

Run this before anything else:

```bash
lane-cli wallet ls
```

| Output                                  | Action                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Cards listed, ≥ 1 passkey-enabled       | Continue to Step 1.                                                      |
| `Lane isn't set up on this machine yet` | Run `lane-cli init --intent login`. A browser opens automatically. Tell user: "A browser just opened — please sign in to your Lane account." Re-run `wallet ls` to confirm, then resume at Step 1. |
| `No cards yet`                          | Run `lane-cli wallet add`. Tell user: "A browser just opened — please enter your card details." Re-run `wallet ls` to confirm the card appears, then run `lane-cli wallet enable-agentic <last4>` and tell user: "A browser just opened — tap your passkey to enable this card for agent use." Re-run `wallet ls` to confirm passkey-enabled, then resume at Step 1. |
| Cards listed but none agentic-enabled   | Run `lane-cli wallet enable-agentic <last4>`. Tell user: "A browser just opened — please tap your passkey to enable this card." Re-run `wallet ls` to confirm, then resume at Step 1. |

---

## Deterministic Purchase Flow

### Step 1 — Confirm the user is logged in

Same as Quick Check above. Don't skip it even if a previous command in the conversation showed success; wallet state changes (cards revoked, passkey expired, etc.) outside the agent's visibility.

### Step 2 — Instruct the agent (via intent-mcp)

Call the **intent-mcp** server with the user's natural-language request:

```
mcp__intent-mcp__submit({
  prompt: "<the user's purchase request, verbatim>"
})
```

Save the returned `session_id` — every follow-up call uses it.

The server responds with one of:

- **`needs_info`** — clarifying questions are needed. Ask the user in plain language — **never use terms like "draft", "intent", "mandate", or "purchase intent"**. Just say "I need a couple more details to set this up" and ask naturally (e.g. "What's your budget?" not "What authentication_amount should I use?"). Then call `submit` again with the same `session_id` and the answers inlined into the prompt.
- **`draft_ready`** — a structured purchase plan the user should review, plus an `approval_url` and a `draft` object with full mandate details. Summarize it as a plain English purchase summary (items, merchants, total ceiling). **Save the mandate details now — you need them in Step 3:**
  ```text
  For each mandate in draft.mandates[]:
    mandate_id              → --mandate-id
    amount                  → --amount
    preferred_merchant_name → --merchant-name
    (derive merchant_url)   → --merchant-url  (e.g. "REI" → "https://www.rei.com")
  ```
  Then **automatically open the browser**:
  ```bash
  open "<approval_url>"   # macOS
  # xdg-open "<approval_url>"  # Linux fallback
  ```
  Tell the user: _"A browser just opened — tap your passkey to authorize the purchase."_

  **Immediately start polling** — do not wait, do not ask the user to tell you when they've approved. Call `get_intent_status` now and keep looping until `kind: "complete"`:
  
  ```
  mcp__intent-mcp__get_intent_status({ session_id: "<from submit>" })
  ```
  
  Show the user a live status line (update in place if your terminal supports it, otherwise emit one line per poll):
  ```
  Waiting for approval... (tap your passkey in the browser)
  ```
  Transition to "Approved! Moving to checkout." the moment `kind: "complete"` fires.
- **`complete`** — returns `lane_intent_id` (a `lint_*` value). **Capture it** — the mandate details were already saved from `draft_ready`. Proceed to Step 3.

#### Polling for approval

After surfacing the `approval_url`, the user runs the FIDO ceremony in their browser (passkey tap, card-picker, etc.). Lane's API drives the graph to completion server-side once the ceremony lands — the agent never needs to call `submit` with `"approve"`. Instead, poll status:

```
mcp__intent-mcp__get_intent_status({ session_id: "<from submit>" })
```

Returns the same shape as `submit`:

| `kind`         | What to do                                                                                                 |
|----------------|------------------------------------------------------------------------------------------------------------|
| `draft_ready`  | User hasn't approved yet. Wait ~3–5s and poll again. Don't spam — once every few seconds is plenty.        |
| `needs_info`   | Drafter re-routed to clarifications mid-flight (rare). Forward questions to user, send answers via `submit`. |
| `complete`     | Done. Capture `lane_intent_id` and proceed to Step 3.                                                       |
| `rejected`     | User rejected past the retry budget. Stop and tell them what was rejected; don't auto-retry.                |
| `error` w/ `SESSION_NOT_FOUND` | The session expired or doesn't exist. Mint a fresh `submit`.                                      |
| `error` w/ `retryable: true`   | Benign mid-flight race. Wait briefly and poll again.                                              |

A reasonable polling cadence is every 3 seconds for the first ~30 seconds, then every 5–10 seconds. Cap total wait around 5 minutes; if still `draft_ready` after that, ask the user whether they want to retry.

**Do NOT** stop polling to ask the user "just let me know when you've tapped your passkey." Poll continuously — the terminal must always show a status line so the user knows what's happening. Automatically proceed to Step 3 the moment `kind: "complete"` is received.

**Alternative:** calling `submit` again with the same `session_id` also short-circuits to `complete` once the graph terminates — but `get_intent_status` is preferred because it's read-only and won't accidentally drive the graph if the state isn't what you expect.

#### Notes

- The MCP draft loop is conversational. Treat each `needs_info` round as a real clarification — don't synthesize answers the user hasn't given.
- The passkey tap happens exactly **once**: in the browser via the `approval_url`. This single tap approves the intent AND creates the VGS agentic intent server-side. No further passkey ceremony is needed — checkout-mcp mints credentials from the already-created VGS intent.
- Each mandate carries an `items` array — one entry per product covered (e.g. a "s'mores supplies" mandate has `items: ["graham crackers", "marshmallows", "chocolate bars"]`). Conditions reference items by name (`{"item":"marshmallows","claim":"quantity","operation":"<=","value":4}`). When showing the draft, surface the items, not just the mandate amounts.
- Multi-merchant intents have **N mandates, one per merchant**. Example: a single intent for "buy camping gear under $100" can carry `mand_xyz_0` REI $60 (tent + backpack) and `mand_xyz_1` KIND $40 (bars).
- To inspect drafts the user has on file, run `lane-cli intents` (lists active purchase intents newest-first). To inspect mandates under a specific intent (e.g. after losing the mandate list to long conversation scroll), run `lane-cli intent status <lint_*>` — it lists every mandate with its current `status` (`active`, `used`) and a `_next:` hint pointing at the next active mandate.

### Step 3 — Hand off to checkout-mcp

Once intent approval is confirmed (`kind: "complete"` from polling), pass the intent to checkout-mcp. checkout-mcp handles merchant discovery, cart, credential minting (no passkey ceremony — the VGS agentic intent was already created when the user tapped their passkey in Step 2), payment submission, and confirmation.

For each mandate, iterate sequentially — complete mandate N before starting N+1:

```
mcp__checkout-mcp__init_session({ intentId: "<lint_id>", mandateId: "<mand_id>" })
mcp__checkout-mcp__choose_merchant({ ... })
mcp__checkout-mcp__view_product({ ... })
mcp__checkout-mcp__add_to_cart({ ... })
mcp__checkout-mcp__checkout({ ... })
```

The `checkout` tool is the atomic finisher: it gate-checks the mandate conditions, retrieves the single-use cryptogram from Lane's API, fills the payment form, submits, and records the confirmed outcome with Lane — no separate `lane-cli confirm` call needed.

**CRITICAL: ONLY checkout-mcp tools may be used for browser interaction.**

- **NEVER** call `mcp__plugin_playwright_playwright__*` tools directly
- **NEVER** use Bash commands or shell scripts for page navigation
- **NEVER** use Python to parse tool results
If checkout-mcp is blocked (bot detection, CAPTCHA, session expired), surface the error to the user and stop. Do not attempt workarounds with external tools. The mandate stays `pending` in Lane's log; the user can retry or the agent can re-issue via checkout-mcp.

After `checkout` succeeds, checkout-mcp has already closed the audit loop with Lane. No additional confirm step is required.

---

## Recovery Patterns

When a step fails, follow this table. Do not improvise. Each `error_code` has a single correct action.

| `error_code`                  | What it means                                                                                                                                                          | Agent action                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `PREFLIGHT_TOKEN_REVOKED`     | VIC token is not ACTIVE (revoked, suspended, or deactivated).                                                                                                          | Run `lane-cli wallet enable-agentic <last4>` to re-enroll, then retry Step 3.                                                             |
| `PREFLIGHT_DEVICE_NOT_BOUND`  | Passkey ceremony never completed for this card.                                                                                                                        | Run `lane-cli wallet enable-agentic <last4>`; wait for the passkey session to land in `complete` state, then retry Step 3.                |
| `PREFLIGHT_VELOCITY`          | Too many recent mint attempts on this token.                                                                                                                           | Wait the suggested cooldown (printed in the error), then retry. Do not loop.                                                              |
| `MERCHANT_DECLINE_ISSUER`     | Merchant relayed an issuer decline (insufficient funds, fraud hold, etc.) reported by checkout-mcp.                                                                    | Re-run Step 3 via checkout-mcp with a different card to switch funding sources. Do **not** retry the same card.                           |
| `MERCHANT_DECLINE_FRAUD_HOLD` | Issuer fraud rule fired on the user's card.                                                                                                                            | Ask the user to contact their bank. Lane cannot fix this from the CLI.                                                                    |
| `CRYPTOGRAM_EXPIRED`          | Cryptogram older than its validity window.                                                                                                                             | Re-run Step 3 (`checkout-mcp`) for the same mandate to mint a fresh cryptogram.                                                           |
| `INTENT_EXPIRED`              | Intent past its `effective_until` timestamp.                                                                                                                           | Re-draft via intent-mcp (Step 2). The old intent can't be revived; preflight will reject it.                                              |
| `CRYPTOGRAM_REPLAY`           | The cryptogram has already been spent.                                                                                                                                 | Mint a new cryptogram for the same mandate via Step 3. Never reuse a cryptogram across two checkouts.                                     |
| `MANDATE_ALREADY_USED`        | Server-side guard fired: this mandate is already in `status: used`. The conditional update on `LaneMandates` blocks a second mint against the same mandate.            | Run `lane-cli intent status <intent_id>` to find the next active mandate. Do NOT retry the used mandate.                                  |
| `MCC_BLOCKED`                 | Cryptogram-mint refused because the merchant's resolved MCC is on the blocklist (see High-risk merchant categories above).                                              | Stop. Surface the block to the user; do not switch merchants to work around it.                                                           |

**Universal rule**: never retry the same cryptogram, never silently retry on decline, and always show the user which `error_code` fired plus the action you propose to take.

---

## Hard Rules

1. **No welcome menu, no demo prompt.** Purchase intent triggers the flow above.
2. **LLM-driven purchases go through intent-mcp (Step 2) + checkout-mcp (Step 3).** `lane-cli pay` and `lane-cli request` are not part of this flow.
3. **ONLY checkout-mcp tools for browser interaction.** Never call `mcp__plugin_playwright_playwright__*`, Bash page commands, or Python scripts to drive checkout. checkout-mcp drives Stagehand internally.
4. **checkout-mcp's `checkout` tool handles confirmation.** Do NOT call `lane-cli confirm` after a successful checkout — it's already done.
5. **The user should never have to type a `lane-cli` command themselves.** The agent runs every command. When a command opens a browser, the agent runs it, then narrates exactly what the user needs to do in that browser, then verifies completion before continuing. `lane-cli wallet rm` is the only exception — confirm the user's intent verbally before running it.
6. **Iterate multi-mandate intents sequentially.** Complete mandate N through checkout-mcp before starting N+1. Never run mandates in parallel.
7. **Never run `lane-cli --help` or `lane-cli <cmd> --help`.** This skill contains the complete command reference. Running help adds unnecessary steps and should never be needed.
8. **Resuming interrupted sessions.** If the user says a previous purchase was interrupted, check for existing active intents before creating a new one:
   ```bash
   lane-cli intents
   ```
   If an active `lint_*` intent exists that matches what the user wants, resume from Step 3 with that intent ID instead of re-drafting via intent-mcp. Intents are stored for up to 3 hours by default. Only create a new intent if no suitable active one exists.

---

## Safeguards

Before requesting credentials for any merchant the agent hasn't transacted with before:

- **Verify merchant legitimacy.** Probe `/agents.txt`, `/llms.txt`, `/.well-known/acp`, `/.well-known/ucp` for protocol manifests. If none exist, treat the merchant with extra scrutiny.
- **Respect `/agents.txt` and `/llms.txt` directives** if present. Bot-disallow rules apply to agents acting on behalf of users.
- **Confirm the user understands the merchant.** If the merchant is unusual for this user (geography, category, amount), state it clearly before Step 3.
- **Mask sensitive output by default.** DPANs, cryptograms, billing addresses are PII. Show only what the user needs to verify the action.
- **MCC blocklist is enforced at cryptogram-mint, not preflight.** The agent does not classify merchant categories at intent-creation time; Lane resolves the MCC after the user has authorized the intent. If a cryptogram-mint fails because the merchant's MCC is blocked, surface it to the user and stop. Do not work around it.

---

## Reference: Sub-Skill Routing

Use these only when the deterministic flow detects a missing prerequisite.

| Sub-skill                                            | Triggers when…                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`account-setup`](../account-setup/SKILL.md)         | `lane-cli wallet ls` reports `Lane isn't set up on this machine yet`.                                |
| [`wallet-setup`](../wallet-setup/SKILL.md)           | Logged in but no cards, or cards present but none agentic-enabled.                                   |
| [`payment-execution`](../payment-execution/SKILL.md) | Detailed reference for Steps 4–6 (cryptogram fields, security, retries, error table).                |

---

## Command Map

| Command                                                                                                                                          | Driver | Purpose                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `lane-cli init`                                                                                                                                  | Agent runs, browser required | Sign up / log in. Agent runs it; tells user to complete browser auth; verifies with `wallet ls`.                                                                                          |
| `lane-cli` (no args)                                                                                                                             | Agent | Interactive home menu — Wallet / Create Intent / Pay / Help.                                                           |
| `lane-cli wallet add`                                                                                                                            | Agent runs, browser required | Add a card. Agent runs it; tells user to enter card in browser; verifies with `wallet ls`.                                                                                                            |
| `lane-cli wallet enable-agentic [last4]`                                                                                                         | Agent runs, browser required | Passkey ceremony. Agent runs it; tells user to tap passkey in browser; verifies with `wallet ls`.                                                                             |
| `lane-cli wallet ls`                                                                                                                             | Agent | Read-only — safe for an agent.                                                                                         |
| `lane-cli wallet default <last4>`                                                                                                                | Agent | Set the default card. Always pass `--card` explicitly regardless.                                                    |
| `lane-cli wallet rm <last4> --yes`                                                                                                               | Agent (confirm first) | Destructive — agent confirms user intent verbally, then runs it.                                                                           |
| `lane-cli intents` / `lane-cli intents ls`                                                                                                       | Agent | List active purchase intents on file (read-only).                                                                           |
| `lane-cli intent status <lint_*>`                                                                                                                | Agent  | List mandates under an intent + their fulfillment state. Returns a `_next:` hint pointing at the next active mandate.   |
| `mcp__intent-mcp__submit({prompt, session_id?})`                                                                                                 | Agent  | Step 2 — draft / clarify a purchase intent. Returns `draft_ready` with `approval_url`, `needs_info`, or `complete`. Re-pass `session_id` to advance. |
| `mcp__intent-mcp__get_intent_status({session_id})`                                                                                               | Agent  | Step 2 — poll after sharing the `approval_url`. Read-only; returns the same shape as `submit`. Transitions to `complete` when the user finishes the FIDO ceremony. |
| `mcp__checkout-mcp__init_session({intentId, mandateId})`                                                                                         | Agent  | Step 3 — open a Browserbase session scoped to one mandate. |
| `mcp__checkout-mcp__choose_merchant({...})`                                                                                                      | Agent  | Step 3 — navigate to the merchant's site. |
| `mcp__checkout-mcp__view_product({...})`                                                                                                         | Agent  | Step 3 — find and view the target product. |
| `mcp__checkout-mcp__add_to_cart({...})`                                                                                                          | Agent  | Step 3 — add item(s) to cart. |
| `mcp__checkout-mcp__checkout({...})`                                                                                                             | Agent  | Step 3 — **atomic finisher**: gate-check + credential mint + form fill + submit + confirm. No separate `lane-cli confirm` needed after this. |
| `mcp__checkout-mcp__end_session({...})`                                                                                                          | Agent  | Step 3 — release the Browserbase session after mandate complete or failed. |
| `lane-cli logout`                                                                                                                                | Agent | Clear local credentials.                                                                                               |

---

## Self-test (verify this file is current)

If the agent is unsure whether it has the latest contract, run:

```bash
curl -fsSL https://www.getonlane.com/SKILL.md | head -10
```

The frontmatter `version:` field should read `7.5.0` or later. If older, refetch. v7.5.0 removes `lane-cli pay`, `lane-cli request`, and `lane-cli confirm` from the skill entirely — these are dead paths not used in the LLM-driven flow.

```bash
lane-cli --version
```

Should report `1.3.0` or later. If it does not, the Pre-Flight Bootstrap upgrade bundle should have caught this already. Run the version check from the Pre-Flight section to upgrade.

### Keeping current

The Lane plugin provides and updates `lane-cli`, `intent-mcp`, and
`checkout-mcp`. To update, update the plugin via `/plugin` — do not run
`claude mcp add` or hand-install the CLI.
