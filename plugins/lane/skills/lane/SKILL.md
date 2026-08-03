---
name: lane
description: Lane CLI router. The user wants to make a payment with their AI agent. Drives a deterministic purchase flow (login → pick card → draft a purchase intent via lane-mcp → user approves with a passkey → Lane drives the merchant checkout autonomously) and routes to setup sub-skills only when a prerequisite is missing.
metadata:
  display_name: Lane — Agentic Commerce
  version: 7.9.12
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

## Pre-Flight Bootstrap (run silently before every session — never ask the user)

Run this block before the Quick Check at the start of every session. The user should never have to manually update anything.

**Critical:** Never run upgrades or add MCPs mid-session. Doing so forces a session restart and loses all progress. Catch everything here, before any purchase work begins.

### Version check

```bash
INSTALLED=$(lane-cli --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
LATEST=$(npm view @getonlane/lane-cli version 2>/dev/null)
echo "lane-cli: installed=${INSTALLED:-none} latest=${LATEST:-unknown}"
```

If `INSTALLED` is empty, differs from `LATEST`, or `lane-cli` is not found at all, run the **upgrade bundle** as a single action — user approves once, not per component:

```bash
npm install -g @getonlane/lane-cli@latest

LANE_API_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.lane/config.json'))['apiKey'])" 2>/dev/null)
if [ -n "$LANE_API_KEY" ]; then
  claude mcp add --transport http lane-mcp \
    ${LANE_MCP_HOST:-https://mcp.getonlane.com}/mcp \
    -H "Authorization: Bearer $LANE_API_KEY"
fi
```

Tell the user: *"Upgrading Lane CLI and refreshing MCP connections — takes about 30 seconds."* Verify with `lane-cli --version` before continuing.

If `~/.lane/config.json` does not exist (first-time user), skip the MCP add steps above — proceed to the Quick Check (which will create the config via `lane-cli init`), then run the MCP add after `lane-cli init` completes.

### MCP check (when lane-cli is already current)

```bash
claude mcp list 2>/dev/null
```

If `lane-mcp` is missing from the output:

```bash
LANE_API_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.lane/config.json'))['apiKey'])" 2>/dev/null)
claude mcp add --transport http lane-mcp \
  ${LANE_MCP_HOST:-https://mcp.getonlane.com}/mcp \
  -H "Authorization: Bearer $LANE_API_KEY"
```

**Run silently. Do not mention version checks or MCP setup to the user unless an upgrade is actually needed.**

---

The LLM-driven flow has **two halves**, both served by the single **lane-mcp** server:

1. **Draft + approve a purchase intent** (intent tools). Draft with `mcp__lane-mcp__intent_submit`. Drafting **also finds the exact products**: the intent step resolves each item to a real product page — it scrapes the merchant's own catalog search, then falls back to a **Google `site:<merchant>` search (SERP)** — and attaches the links to the plan BEFORE you see it, so the purchase you present already names the specific products. The user approves with a single passkey tap in the browser. The intent is persisted as `lint_*` with status `active`. A purchase intent may carry **N mandates** — one per distinct merchant.
2. **Drive the checkout autonomously** (checkout tools). After approval, call `mcp__lane-mcp__start_session({ intent_id })`. Discovery already happened in step 1, so checkout is pure **execution**: it goes straight to the product pages the intent resolved, then login → add to cart → checkout → submit payment, per mandate. It does NOT re-search for the products (only if a link is somehow missing or stale does the engine fall back to searching mid-run). You poll `get_session_status` and, whenever it needs the user (sign-in, shipping, OTP, passkey), surface the ask and poll `resume_session` until it's answered. See **Step 3** for the exact loop.

`lane-cli pay`, `lane-cli confirm`, and `lane-cli request` are NOT part of the LLM-driven flow — checkout runs through the lane-mcp checkout tools, not the CLI.

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

> **INTERNAL ONLY — never say this vocabulary to the user.** The terms below
> (VGS, cryptogram, TAVV, DPAN, VIC token, agentic intent, mandate, draft) are
> for YOUR understanding of how Lane works. NEVER surface them in anything you
> say to the user — no "minted the VGS agentic intent", no "the cryptogram is
> single-use", no "approved your mandate". Speak in plain language about THEIR
> money and THEIR card: e.g. "Tap your passkey to approve up to $50 on your
> Visa - it's a one-time charge that can't go over that." / "Approved - I'm
> placing the order now." The user cares what's authorized and what's happening,
> not Lane's plumbing.

Lane operates differently from card-issuing wallets (e.g. Stripe Link). The constraints this places on the flow are important:

| Concept                  | What Lane does                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Wallet contents          | A **VIC-tokenized** representation of the user's real card (DPAN + device-bound passkey). Lane never sees the raw PAN.          |
| Credential issued        | A one-time **cryptogram (TAVV) + DPAN** bound to the VIC token. Not a funded virtual card.                                      |
| What's pre-checkable     | Token health, mandate window, passkey binding, velocity. Lane runs all of these in **preflight** before the passkey tap.        |
| What's NOT pre-checkable | The user's bank balance, any issuer-side limit, and the merchant's MCC at draft time. Those only surface at the issuer's auth.  |
| Where declines fire      | At the merchant's auth request to the issuer (same as any e-commerce purchase). Lane has limited visibility once the checkout engine submits — declines surface only if the engine reports them. |

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

**Rule 3 — Lane drives the checkout after approval.**
After the user approves the intent (Step 2 passkey tap), the VGS agentic intent is created server-side and you hand the intent to the checkout engine via `mcp__lane-mcp__start_session` (Step 3). It drives the merchant purchase autonomously across every mandate; you poll status and relay any `needs_human` asks. ("See card" remains available in the wallet as a manual fallback.)

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

### Step 2 — Draft the intent (lane-mcp `intent_*` tools)

Call the lane-mcp intent tools with the user's natural-language request:

```
mcp__lane-mcp__intent_submit({
  prompt: "<the user's purchase request, verbatim>"
})
```

Save the returned `session_id` — every follow-up call uses it.

The server responds with one of:

- **`needs_info`** — clarifying questions are needed. Ask the user in plain language — **never use terms like "draft", "intent", "mandate", or "purchase intent"**. Just say "I need a couple more details to set this up" and ask naturally (e.g. "What's your budget?" not "What authentication_amount should I use?"). Then call `submit` again with the same `session_id` and the answers inlined into the prompt.
- **`draft_ready`** — a structured purchase plan the user should review, plus an `approval_url` and a `draft` object with full mandate details. Summarize it as a plain English purchase summary (items, merchants, total ceiling). **Tell the user the SPECIFIC product the intent found** — each mandate's `items[]` carries the resolved `product_urls` (the exact page that will be purchased). Name it plainly ("Found it: the Wrinkle-Free Double L Chinos at L.L.Bean") so they're approving a concrete product, not a vague description. If a `product_urls` entry is missing for an item, the intent couldn't find that one — it will have already asked you to clarify it (a `needs_info` round) before reaching `draft_ready`; you should not be presenting an unresolved item here. **Save the mandate details now for reference:**
  ```text
  For each mandate in draft.mandates[]:
    mandate_id              → reference id
    amount                  → ceiling amount
    preferred_merchant_name → merchant name (tell the user which card is for which merchant in Step 3)
    items[].product_urls    → the exact product page(s) found for this mandate
  ```
  Then surface it for approval. The user's Lane wallet **auto-surfaces this step in their already-open dashboard** — the approval modal pops up there on its own. So PREFER the existing dashboard: do NOT open a second browser tab by default (that produces a duplicate modal). Tell the user: _"Approve the purchase in your open Lane wallet — the request just appeared there. Tap your passkey to authorize."_

  **Only if the user says they don't have the wallet open** (or asks for the link) do you open a new tab as a fallback:
  ```bash
  open "<approval_url>"   # macOS — FALLBACK ONLY when no dashboard is open
  # xdg-open "<approval_url>"  # Linux
  ```

  **Immediately start polling** — do not wait, do not ask the user to tell you when they've approved. Call `intent_get_status` now and keep looping until `kind: "complete"`:
  
  ```
  mcp__lane-mcp__intent_get_status({ session_id: "<from submit>" })
  ```
  
  Show the user a live status line (update in place if your terminal supports it, otherwise emit one line per poll):
  ```
  Waiting for approval... (tap your passkey in the browser)
  ```
  Transition to "Approved — starting checkout..." the moment `kind: "complete"` fires, then go straight into Step 3.
- **`complete`** — returns `lane_intent_id` (a `lint_*` value). **Capture it** — the mandate details were already saved from `draft_ready`. Proceed **immediately** to autonomous checkout: call `mcp__lane-mcp__start_session({ intent_id })` (Step 3 below). Do not tell the user to fetch or paste a card — Lane drives the checkout for them.

#### Polling for approval

After surfacing the `approval_url`, the user runs the FIDO ceremony in their browser (passkey tap, card-picker, etc.). Lane's API drives the graph to completion server-side once the ceremony lands — the agent never needs to call `submit` with `"approve"`. Instead, poll status:

```
mcp__lane-mcp__intent_get_status({ session_id: "<from submit>" })
```

Returns the same shape as `submit`:

| `kind`         | What to do                                                                                                 |
|----------------|------------------------------------------------------------------------------------------------------------|
| `draft_ready`  | User hasn't approved yet. Wait ~3–5s and poll again. Don't spam — once every few seconds is plenty.        |
| `needs_info`   | Drafter re-routed to clarifications mid-flight (rare). Forward questions to user, send answers via `submit`. |
| `complete`     | Approval landed. Capture `lane_intent_id`, then **immediately go to Step 3** — call `mcp__lane-mcp__start_session({ intent_id })` and drive the autonomous checkout. Never tell the user to fetch or paste a card. |
| `rejected`     | User rejected past the retry budget. Stop and tell them what was rejected; don't auto-retry.                |
| `error` w/ `SESSION_NOT_FOUND` | The session expired or doesn't exist. Mint a fresh `submit`.                                      |
| `error` w/ `retryable: true`   | Benign mid-flight race. Wait briefly and poll again.                                              |

A reasonable polling cadence is every 3 seconds for the first ~30 seconds, then every 5–10 seconds. Cap total wait around 5 minutes; if still `draft_ready` after that, ask the user whether they want to retry.

**Do NOT** stop polling to ask the user "just let me know when you've tapped your passkey." Poll continuously — the terminal must always show a status line so the user knows what's happening. The moment `kind: "complete"` is received, proceed to **Step 3** — hand the intent to `mcp__lane-mcp__start_session` to drive the checkout.

**Alternative:** calling `intent_submit` again with the same `session_id` also short-circuits to `complete` once the graph terminates — but `intent_get_status` is preferred because it's read-only and won't accidentally drive the graph if the state isn't what you expect.

#### If the approval stalls or the user clicks off

The browser tab is just a viewport — `intent_get_status` is the source of truth, so you can always tell whether approval actually landed. Never depend on the user keeping a tab open. Two cases:

- **Already `complete` (approval landed).** Approval is recorded server-side. If the user accidentally closes the tab, nothing is lost — you already captured `lane_intent_id`. Proceed to Step 3 (call `start_session` and drive the autonomous checkout); the tab is just a viewport. Do NOT tell the user to "keep the tab open," to fetch a card, or to re-run anything.
- **Still non-`complete` after ~30–45s of polling** (user clicked off, the passkey prompt didn't fire, or the tab closed). Stop silently waiting. Proactively tell the user it didn't go through and offer two choices:
  1. **Reopen** — re-run `open "<approval_url>"` (the SAME link). The approval session is re-initiable within its ~10-minute window, so reopening resumes the in-flight ceremony — the user just taps their passkey again. Keep polling after reopening.
  2. **Change something** — if the request itself was wrong, send the user's correction via `mcp__lane-mcp__intent_submit({ session_id, prompt: "<what to change>" })`. This re-drafts (the modify cycle) and returns a fresh `approval_url` to open.

  Only once the ~10-minute session TTL has elapsed (reopening shows an "approval link has expired" page) do you mint a brand-new `submit`.

#### Notes

- The MCP draft loop is conversational. Treat each `needs_info` round as a real clarification — don't synthesize answers the user hasn't given.
- The approval passkey tap happens **once**: in the browser via the `approval_url`. This single tap approves the intent AND creates the VGS agentic intent server-side. (A merchant sign-in or step-up during Step 3 may raise its own `needs_human` ask — that's separate from this approval tap and handled via the resume loop.)
- Each mandate carries an `items` array — one entry per product covered (e.g. a "s'mores supplies" mandate has `items: ["graham crackers", "marshmallows", "chocolate bars"]`). Conditions reference items by name (`{"item":"marshmallows","claim":"quantity","operation":"<=","value":4}`). When showing the draft, surface the items, not just the mandate amounts.
- Multi-merchant intents have **N mandates, one per merchant**. Example: a single intent for "buy camping gear under $100" can carry `mand_xyz_0` REI $60 (tent + backpack) and `mand_xyz_1` KIND $40 (bars).
- To inspect drafts the user has on file, run `lane-cli intents` (lists active purchase intents newest-first). To inspect mandates under a specific intent (e.g. after losing the mandate list to long conversation scroll), run `lane-cli intent status <lint_*>` — it lists every mandate with its current `status` (`active`, `used`) and a `_next:` hint pointing at the next active mandate.

### Step 3 — Drive the checkout autonomously

Once approval is confirmed (`kind: "complete"`), hand the intent to the checkout engine. The products were already found at draft time (their links are on the intent's mandates), so the engine goes straight to those product pages and drives the purchase in a real browser (login, add to cart, checkout, submit payment). This is a real transaction against the real merchant in EVERY environment, staging included. There is no mock or sandbox merchant and no test code (e.g. there is no "123456 works"). You do not navigate, add to cart, or fill forms yourself; you orchestrate via three tools and relay human-in-the-loop asks.

  **Narration:** describe this step as placing the order / checking out — NOT as "finding the product", "searching the store", or "resolving the merchant". That work is done. If you catch the run searching for the product mid-checkout, that's a fallback (the link didn't resolve at draft), not the normal path — don't present it to the user as the expected flow.

**1. Start.** Call `mcp__lane-mcp__start_session({ intent_id: "lint_..." })`. It returns immediately with `outcome: "running"` and boots a detached background run (go to the resolved product page, login, add to cart, checkout, submit payment, per mandate). No merchant URL is needed — the product links are already on the intent. (`mcp__lane-mcp__find_products({ mandate_id })` still exists as a manual re-resolve if you ever need to refresh a mandate's links, but you do NOT need to call it in the normal flow — discovery ran at draft.)

**2. Poll status cleanly (long-poll, no sleep).** Call `mcp__lane-mcp__get_session_status({ intent_id, wait_seconds: 20 })`. With `wait_seconds` the call HOLDS OPEN server-side until the outcome changes or ~20s elapse, so one spinner covers the wait. Keep calling it back-to-back until `outcome != "running"`.
  - Do NOT use `Bash(sleep ...)` to pace polling, and do NOT print a line on every call. Speak only when something CHANGES: a new phase, a `needs_human` ask, or a terminal outcome. Silence between transitions is correct; the spinner is the progress indicator.
  - The run is detached but its session lives in the MCP process; if the service restarts mid-run you may get `session_not_found` or `browser_reaped`. On `session_not_found` for an intent you know is approved, just call `start_session` again to boot a fresh run.
  - **Transient errors → auto-recover, never stall or hand it to the user.** The checkout run is detached and survives a blip, so a hiccup talking to the server is YOURS to retry, not the user's to fix. On a gateway/transport error (HTTP `502` / `503` / `504`, a timeout, a dropped connection, "Something went wrong") from `get_session_status` or `resume_session`: wait a few seconds and **call it again** — keep retrying the SAME call until it answers (the run kept going server-side). On `session_not_found` / `browser_reaped` for an approved intent: call `start_session` again (it re-attaches or boots fresh — discovery + links are already on the intent, so a restart is cheap). Do NOT stop, do NOT report failure, and do NOT ask the user to do anything for a transient — only surface a problem on a TERMINAL `failed`/`error` outcome the server actually returns. A few quiet retries beats a false "it failed."

**3. On `needs_human` (resume loop).** A suspend returns `outcome: "needs_human"` with a `suspend` payload (`prompt`, `ask_url`, `ask_id`, `kind`). These are REAL credentials/codes/answers for the real merchant: the user's own password, a one-time code the merchant actually sends to the user, a shipping address, a product clarification, or **any additional information the merchant demands mid-checkout** (a post-login security question like "full name on the account", a date of birth, a PIN — surfaced as `kind: "info_request"` with the merchant's exact question in `suspend.prompt`). The engine asks for whatever it hits that it can't supply itself, instead of giving up — your job is the same regardless of `kind`: relay the prompt, let the user answer in the wallet, keep polling.
  - **TELL THE USER, in the terminal, the moment a `needs_human` ask fires.** Post a clear, standalone message: WHAT you need (sign in to the merchant / a one-time code / a shipping address / clarify which item / **answer the merchant's security question shown in the prompt**) and WHERE to do it (their open Lane wallet — include the `ask_url`). Do NOT silently start polling, and do NOT bury the ask under a spinner or a "still working…" line. The user is often watching the terminal, not the wallet, and a dashboard popup alone will be missed — the run then looks "frozen" when it's actually waiting on them. Make the request impossible to miss BEFORE you poll.
  - **Let the open dashboard surface it — don't open a second tab.** The user's open Lane wallet auto-surfaces this step (the sign-in / OTP / shipping modal pops up there on its own). PREFER that: do NOT `open` the ask_url by default — a second tab produces a duplicate modal. Only `open "<suspend.ask_url>"` as a FALLBACK if the user says they don't have the wallet open (or asks for the link).
  - **Relay `suspend.prompt` VERBATIM.** Do not invent, guess, or supply a code. Never tell the user a code "works", never call it a mock or a staging stub, and never assume the delivery channel (it may be the merchant's app, email, SMS, or an on-screen prompt). Show the prompt and let the user enter their real answer in the open wallet. After they submit there they can return to the terminal; you keep polling.
  - **Long-poll the resume.** Call `mcp__lane-mcp__resume_session({ session_id, ask_id, intent_id, wait_seconds: 20 })`. It holds open until the user answers or ~20s elapse, then returns `needs_human` (still waiting) or `running` (answered). Keep calling it back-to-back; do not sleep, do not narrate each call.
  - Once it returns `running`, go back to step 2. If it suspends again (e.g. an OTP after a password), repeat with the NEW ask.
  - **`kind: "budget_increase"` is the one ask you ACT on, not just relay.** It fires when the real order total (with shipping + tax) comes in higher than the amount the user approved — checkout paused at payment and nothing was charged. Tell the user the real total vs their limit in plain language, then follow the prompt's steps: (1) call `mcp__lane-mcp__intent_amend({ intent_id, mandate_id, new_amount })` with the over-budget total from the prompt; (2) give the user the `approval_url` it returns so they approve the higher amount with their passkey in the wallet; (3) once they approve, call `mcp__lane-mcp__resume_session({ intent_id, ask_id, answer: "approved" })` — the `answer` flag is REQUIRED for this kind (they approved via the passkey, not by answering the ask). If the user declines the higher amount, `end_session` instead. Never raise the limit without the user's go-ahead.
  - **Preferred sign-in method (beyond username + password).** Some stores don't use a password at all — they sign you in with a **one-time code** or a **passkey** (Target is email → "Use a passkey" / "Get a code", no password). The engine handles this automatically: it picks the get-a-code path and suspends for the code. But if the **user states a preference** — e.g. "sign in with the code texted to my phone," "use my passkey," or "I'll sign in myself, just wait" — capture it and pass it through at draft time so the engine honors it: include the instruction verbatim in the `mcp__lane-mcp__intent_submit` prompt (e.g. `intent_submit({ prompt: "...; sign in to Target with the one-time phone code, not a password" })`). A phone/OTP sign-in instruction biases the engine to the code path; an "I'll sign in myself" preference means you relay the sign-in ask and let the user complete it in their wallet rather than the engine auto-driving it.

**4. Terminal outcome.**
  - `ok` -> the purchase completed. Tell the user what was bought and the total.
  - `failed` / `error` -> report the reason from the payload; do not silently retry. See Recovery Patterns.
    - **Merchant blocked the automated session (NOT the user's fault).** If the run fails at sign-in with a repeated `403`/`400`, a CAPTCHA / reCAPTCHA, or the merchant serves a dead-end page ("Something went wrong", "looking to shop?"), the merchant's bot-detection refused the automated session — it is NOT the user's password and NOT a Lane error. Do NOT tell the user to re-check their credentials, and do NOT re-run `start_session` against the same merchant (it will keep failing the same way). Say plainly that the store blocked automated checkout, and offer to try a different store. Some large retailers (e.g. TJ Maxx, Kohl's) bot-wall agent checkout aggressively; merchants with a normal online storefront complete reliably.

Report only the transitions (`running` -> `needs_human` -> `running` -> `ok`), not every poll. Dedup is automatic: a second `start_session` for an in-flight intent attaches to the existing run (`data.reused: true`) rather than racing a second browser.

---

## Recovery Patterns

When a step fails, follow this table. Do not improvise. Each `error_code` has a single correct action.

| `error_code`                  | What it means                                                                                                                                                          | Agent action                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `PREFLIGHT_TOKEN_REVOKED`     | VIC token is not ACTIVE (revoked, suspended, or deactivated).                                                                                                          | Run `lane-cli wallet enable-agentic <last4>` to re-enroll, then re-run the approval flow (Step 2) to get a fresh card for Step 3.         |
| `PREFLIGHT_DEVICE_NOT_BOUND`  | Passkey ceremony never completed for this card.                                                                                                                        | Run `lane-cli wallet enable-agentic <last4>`; wait for the passkey session to land in `complete` state, then re-run the approval flow.    |
| `PREFLIGHT_VELOCITY`          | Too many recent mint attempts on this token.                                                                                                                           | Wait the suggested cooldown (printed in the error), then retry. Do not loop.                                                              |
| `MERCHANT_DECLINE_ISSUER`     | Merchant relayed an issuer decline (insufficient funds, fraud hold, etc.) while the user was paying.                                                                   | Ask the user to try with a different card. Re-run the approval flow (Step 2) with the new card selected.                                  |
| `MERCHANT_DECLINE_FRAUD_HOLD` | Issuer fraud rule fired on the user's card.                                                                                                                            | Ask the user to contact their bank. Lane cannot fix this from the CLI.                                                                    |
| `CRYPTOGRAM_EXPIRED`          | Cryptogram older than its validity window.                                                                                                                             | The single-use card has expired. Re-run Step 2 to get a fresh approval and a new card for Step 3.                                         |
| `INTENT_EXPIRED`              | Intent past its `effective_until` timestamp.                                                                                                                           | Re-draft via `intent_submit` (Step 2). The old intent can't be revived; preflight will reject it.                                         |
| `CRYPTOGRAM_REPLAY`           | The cryptogram has already been spent.                                                                                                                                 | The single-use card was already used. Re-run Step 2 to get a new intent and a fresh card. Never reuse a cryptogram across two checkouts.  |
| `MANDATE_ALREADY_USED`        | Server-side guard fired: this mandate is already in `status: used`. The conditional update on `LaneMandates` blocks a second mint against the same mandate.            | Run `lane-cli intent status <intent_id>` to find the next active mandate. Do NOT retry the used mandate.                                  |
| `MCC_BLOCKED`                 | Cryptogram-mint refused because the merchant's resolved MCC is on the blocklist (see High-risk merchant categories above).                                              | Stop. Surface the block to the user; do not switch merchants to work around it.                                                           |

**Universal rule**: never retry the same cryptogram, never silently retry on decline, and always show the user which `error_code` fired plus the action you propose to take.

---

## Hard Rules

1. **No welcome menu, no demo prompt.** Purchase intent triggers the flow above.
2. **The whole flow runs through lane-mcp.** Step 2 drafts/approves via `intent_*` tools; Step 3 drives the purchase via the checkout tools (`start_session` / `get_session_status` / `resume_session`). `lane-cli pay`, `lane-cli confirm`, and `lane-cli request` are NOT part of the LLM-driven flow. **Lane checks out autonomously — never tell the user to fetch, reveal, or paste a card.** The wallet's "see card" button exists only as a manual fallback the user can reach on their own; it is never an instruction you give.
3. **The checkout engine drives the merchant browser — you do NOT.** Never call `mcp__plugin_playwright_playwright__*`, Bash page commands, or Python scripts to drive the merchant site. `start_session` runs the browser autonomously server-side; your job is to poll and relay its `needs_human` asks, not to navigate pages yourself.
4. **Poll cleanly with long-poll, never `sleep`.** After `start_session` you MUST keep checkout moving: call `get_session_status({ intent_id, wait_seconds: 20 })` back-to-back until terminal, and `resume_session({ ..., wait_seconds: 20 })` through every `needs_human` suspend. `wait_seconds` holds the call open server-side (the spinner IS the wait), so NEVER pace polling with `Bash(sleep ...)` and NEVER print a line on every poll. Speak only on a transition (new phase, new ask, terminal). Stop polling and the run is lost (the browser is reaped seconds after a suspend).
5. **Real transactions only; never fabricate a code or claim a mock.** The checkout engine drives the REAL merchant in every environment, staging included. There is no mock/sandbox merchant and no test code. On a `needs_human` ask, relay `suspend.prompt` VERBATIM and `open` the `ask_url`; never invent a code, never say a code "works", never tell the user it is a mock/stub, never guess the delivery channel. The user enters their real merchant credentials/OTP in the wallet.
6. **The user should never have to type a `lane-cli` command themselves.** The agent runs every command. When a command opens a browser, the agent runs it, then narrates exactly what the user needs to do in that browser, then verifies completion before continuing. `lane-cli wallet rm` is the only exception — confirm the user's intent verbally before running it.
7. **One run per intent — sequential mandates are internal.** Call `start_session` ONCE per intent; the engine walks every mandate itself. Never spawn a second `start_session` for the same intent (dedup attaches to the live run). Surface human asks one at a time as the engine raises them.
8. **Never run `lane-cli --help` or `lane-cli <cmd> --help`.** This skill contains the complete command reference. Running help adds unnecessary steps and should never be needed.
9. **Resuming interrupted sessions.** If the user says a previous purchase was interrupted, check for existing active intents before creating a new one:
   ```bash
   lane-cli intents
   ```
   If an active `lint_*` intent exists that matches what the user wants, resume checkout against it — call `mcp__lane-mcp__start_session({ intent_id })` (it attaches to any in-flight run rather than racing a second browser) without re-drafting. Only create a new intent if no suitable active one exists. Intents are stored for up to 3 hours by default.

---

## Safeguards

Before requesting credentials for any merchant the agent hasn't transacted with before:

- **Verify merchant legitimacy.** Probe `/agents.txt`, `/llms.txt`, `/.well-known/acp`, `/.well-known/ucp` for protocol manifests. If none exist, treat the merchant with extra scrutiny.
- **Respect `/agents.txt` and `/llms.txt` directives** if present. Bot-disallow rules apply to agents acting on behalf of users.
- **Confirm the user understands the merchant.** If the merchant is unusual for this user (geography, category, amount), state it clearly before kicking off the checkout.
- **Mask sensitive output by default.** DPANs, cryptograms, billing addresses are PII. Show only what the user needs to verify the action.
- **MCC blocklist is enforced at cryptogram-mint, not preflight.** The agent does not classify merchant categories at intent-creation time; Lane resolves the MCC after the user has authorized the intent. If a cryptogram-mint fails because the merchant's MCC is blocked, surface it to the user and stop. Do not work around it.

---

## Reference: Sub-Skill Routing

Use these only when the deterministic flow detects a missing prerequisite.

| Sub-skill                                            | Triggers when…                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`account-setup`](../account-setup/SKILL.md)         | `lane-cli wallet ls` reports `Lane isn't set up on this machine yet`.                                |
| [`wallet-setup`](../wallet-setup/SKILL.md)           | Logged in but no cards, or cards present but none agentic-enabled.                                   |

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
| `mcp__lane-mcp__intent_submit({prompt, session_id?})`                                                                                                 | Agent  | Step 2 — draft / clarify a purchase intent. Returns `draft_ready` with `approval_url`, `needs_info`, or `complete`. Re-pass `session_id` to advance. |
| `mcp__lane-mcp__intent_get_status({session_id})`                                                                                               | Agent  | Step 2 — poll after sharing the `approval_url`. Read-only; returns the same shape as `submit`. Transitions to `complete` when the user finishes the FIDO ceremony. |
| `mcp__lane-mcp__intent_list({status?, limit?})` | Agent | List the caller's intents/orders (drafts + active) with status, summary, amount, currency, merchant(s). Read-only; any surface. Use for "what have I ordered / what's pending". |
| `mcp__lane-mcp__intent_get_terms({session_id, draft_session_id, payment_method?})` | Agent (chat surfaces) | Step 2b - on a chat surface (iMessage/WhatsApp/SMS, declared via the `X-Lane-Surface` connection header): returns `inline_terms` to PASTE in-thread (full terms incl. "Spending limit: up to $X" + saved addresses + the payment-method options) instead of opening a browser. The user picks **card_on_file** (no passkey/browser, any wallet) or, when the wallet has a passkey card, **agentic** (Lane card via passkey). Returns `use_link` on rich surfaces or when `payment_method:'agentic'` is requested - then share `approval_url`. |
| `mcp__lane-mcp__intent_approve({session_id, draft_session_id, confirmation, payment_method?, shipping_address?})` | Agent (chat surfaces) | Step 2b - record the user's in-thread "yes" and approve. `payment_method:'card_on_file'` (default) completes in-thread with the merchant's saved card (no passkey/browser, any wallet); `payment_method:'agentic'` returns the browser `approval_url` for the passkey ceremony. Then go to Step 3. |
| `mcp__lane-mcp__start_session({intent_id})`                                                                                                      | Agent  | Step 3 — drive the autonomous checkout. Non-blocking; returns `outcome:"running"`. Poll `get_session_status`. |
| `mcp__lane-mcp__get_session_status({intent_id})`                                                                                                 | Agent  | Step 3 — poll (~3-5s) until `outcome != "running"`. Surfaces `needs_human` suspends + the terminal `ok`/`failed`. |
| `mcp__lane-mcp__resume_session({session_id, ask_id, intent_id})`                                                                                 | Agent  | Step 3 — on `needs_human`, show `suspend.ask_url` + poll (~5s) until it answers, then resume status polling. |
| `lane-cli logout`                                                                                                                                | Agent | Clear local credentials.                                                                                               |

---

## Self-test (verify this file is current)

If the agent is unsure whether it has the latest contract, run:

```bash
curl -fsSL https://www.getonlane.com/SKILL.md | head -10
```

The frontmatter `version:` field should read `7.9.2` or later. If older, refetch. v7.9.x enables **autonomous checkout**: the two MCPs are unified into one `lane-mcp` server (`${LANE_MCP_HOST:-https://mcp.getonlane.com}/mcp`); the moment approval returns `complete` the agent calls `mcp__lane-mcp__start_session({intent_id})` and drives the purchase via `get_session_status` / `resume_session` (Step 3). Poll cleanly with `wait_seconds` (long-poll), never `Bash(sleep)`, and speak only on transitions. Checkout is a REAL transaction in every environment (no mock/sandbox, no test code); relay `suspend.prompt` verbatim and `open` the ask_url. **Never tell the user to fetch or paste a card** (Lane checks out for them; "see card" is a manual fallback only). The intent tools are prefixed `intent_submit` / `intent_get_status` / `intent_list` / `intent_ask_human` / `intent_cancel_ask`.

```bash
lane-cli --version
```

Should report `1.3.0` or later. If it does not, the Pre-Flight Bootstrap upgrade bundle should have caught this already. Run the version check from the Pre-Flight section to upgrade.

### Upgrade bundle (all components at once)

If any component is stale, run this block as a single action — user approves once:

```bash
npm install -g @getonlane/lane-cli@latest

LANE_API_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.lane/config.json'))['apiKey'])" 2>/dev/null)
if [ -n "$LANE_API_KEY" ]; then
  claude mcp add --transport http lane-mcp \
    ${LANE_MCP_HOST:-https://mcp.getonlane.com}/mcp \
    -H "Authorization: Bearer $LANE_API_KEY"
fi
```
