# Lane for Codex

Connects Lane to the [Codex](https://developers.openai.com/codex) CLI, so your
agent can draft a purchase intent, have you approve it, and then let Lane drive
the merchant checkout autonomously.

This is the Codex counterpart to the Claude Code plugin in
[`../plugins/lane`](../plugins/lane). Both talk to the **same** hosted
`lane-mcp` server with the **same** Lane API key, so a card you added from
Claude Code works here with no extra setup. The difference is only in how each
host is configured and where the credential lives:

|                | Claude Code                       | Codex                              |
| -------------- | --------------------------------- | ---------------------------------- |
| Wiring         | `/plugin install lane@lane-cli`   | a block in `~/.codex/config.toml`  |
| Credential     | plugin `userConfig` (OS keychain) | an environment variable            |
| Surface        | `claudecode`                      | `codex`                            |
| Approval       | browser wallet (passkey)          | browser wallet (passkey)           |

There is no Codex-specific server and no separate account. An OAuth install is
also available if you would rather not keep a long-lived key in your shell
profile — see "API key or OAuth" at the bottom.

## Setup

### 1. Get a Lane API key

```bash
npm i -g @getonlane/lane-cli
lane-cli init
```

`init` walks you through sign-in in the browser and writes the key to
`~/.lane/config.json` under `"apiKey"`.

### 2. Export it

Codex reads the bearer from an environment variable at launch, so put this in
your shell profile (`~/.zshrc`, `~/.bashrc`) rather than passing it inline:

```bash
export LANE_API_KEY="$(python3 -c 'import json,pathlib;print(json.load(open(pathlib.Path.home()/".lane/config.json"))["apiKey"])')"
```

Or just paste the key literally:

```bash
export LANE_API_KEY="lane_..."
```

The key is a **spending credential**. Treat it like a card: never commit it, and
never put it in `config.toml` directly — `bearer_token_env_var` below exists so
it stays out of that file.

### 3. Add the server to `~/.codex/config.toml`

```toml
[mcp_servers.lane]
url = "https://mcp.getonlane.com/mcp"
bearer_token_env_var = "LANE_API_KEY"
http_headers = { "X-Lane-Surface" = "codex" }
# Defaults are 10s / 60s. Both are raised on purpose -- see "Timeouts" below.
startup_timeout_sec = 30
tool_timeout_sec = 120
```

That is the whole integration. Restart Codex and the Lane tools appear.

### 4. Verify

```bash
codex mcp list
```

`lane` should be listed and healthy. Then ask for something read-only first, so
you confirm the connection without moving money:

> "list my Lane orders"

That calls `intent_list`. If it answers, auth and transport are both working.

## Timeouts

Two non-default values above, both deliberate:

- **`tool_timeout_sec = 120`** (default 60). `get_session_status` long-polls,
  but the server clamps a poll to 25s, so a poll alone fits inside the default.
  The calls that do not are `find_products` (a merchant-search scrape, possibly
  falling back to a SERP) and `start_session` on a cold browser. 120s is cheap
  insurance against a tool erroring out mid-checkout.
- **`startup_timeout_sec = 30`** (default 10). The server is remote; a cold
  instance has to answer the MCP `initialize` handshake before Codex gives up.

## Trimming the tool list

`lane-mcp` exposes 22 tools. If that is more context than you want in every
session, Codex can filter them:

```toml
[mcp_servers.lane]
# ...as above...
enabled_tools = [
  "intent_submit", "intent_get_terms", "intent_approve", "intent_get_status",
  "intent_list", "edit_lane_intent", "intent_cancel_mandate",
  "find_products", "start_session", "get_session_status", "resume_session",
  "intent_ask_human", "end_session",
]
```

Those 13 cover the whole purchase path: find, draft, approve, run, poll, answer
a question mid-run, close out. They leave out the org-card, credits, travel and
reservation tools, plus `intent_test_approve` (a dry run that does not
authorize a real purchase).

## The purchase flow

Lane is a 5-step pipeline and **no step happens on its own** — the agent makes
each call:

1. `intent_submit` — draft the purchase (merchant, item, cap)
2. `intent_get_terms` → you approve
3. `start_session` — Lane begins the real checkout
4. `get_session_status` with `wait_seconds` — long-poll until `outcome` is
   terminal, relaying progress
5. `end_session`

On `codex`, approval resolves to Lane's **`rich`** surface: terms open in the
browser wallet and you approve there, with a passkey for cards on the agentic
(Visa) rail, or a plain confirmation for a card-on-file. That is the same as
Claude Code. Inline in-thread approval is only for the chat and app families
(iMessage/WhatsApp, and the ChatGPT/Claude MCP Apps), because those render terms
themselves.

You can override the surface if you want different behavior, but note it is a
**rendering hint only** — it never changes which cards are allowed or who may
approve. Approval is bound to the API key's wallet identity and enforced
server-side. Setting a different surface cannot unlock a weaker approval.

| `X-Lane-Surface`                                  | Family | Approval |
| ------------------------------------------------- | ------ | -------- |
| `imessage`, `whatsapp`, `sms`, `headless`          | chat   | reply in-thread; no browser, card-on-file only |
| `chatgpt`, `claude`                                | app    | inline in the app's widget; browser still available for the passkey rail |
| `codex`, `claudecode`, `browser`, `mobileapp`      | rich   | browser wallet (passkey, or card-on-file) |
| missing / anything else                            | rich   | safe default |

## Non-production stages

Staging and personal stages sit behind Cloudflare Access, so they need service
token headers on top of the Lane bearer. `env_http_headers` reads them from the
environment, same as the bearer:

```toml
[mcp_servers.lane-staging]
url = "https://mcp-staging.aws.getonlane.com/mcp"
bearer_token_env_var = "LANE_API_KEY_STAGING"
http_headers = { "X-Lane-Surface" = "codex" }
env_http_headers = { "CF-Access-Client-Id" = "CF_ACCESS_CLIENT_ID", "CF-Access-Client-Secret" = "CF_ACCESS_CLIENT_SECRET" }
startup_timeout_sec = 30
tool_timeout_sec = 120
```

Two warnings about staging specifically:

- **Staging runs a live VGS tenant with real cards.** It is not a sandbox. For
  safe testing use `test=true` at mint, which caps a card at $1.
- **Staging runs more than one task and MCP sessions are task-pinned.** A client
  that drops the `AWSALB` cookie between requests can land on the wrong task and
  get a 404 that looks like a broken URL but is not. Prefer production, or a
  single-task personal stage, for a client you are still debugging.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401` on every tool | `LANE_API_KEY` unset or not exported in the shell that launched Codex. Codex reads it at launch, so re-export and restart. |
| `403` before any tool runs | A Cloudflare Access gate: you are pointed at a non-prod host without the service token headers. |
| Server never starts | Raise `startup_timeout_sec`; a cold start can exceed the 10s default. |
| A tool errors mid-checkout | Raise `tool_timeout_sec`; discovery and session start can exceed the 60s default. |
| Approval never appears | Expected on `codex` — it opens in the **browser wallet**, not in the terminal. |
| `404` on a staging URL | Probably the task-pinning issue above, not a wrong path. |

## API key or OAuth

Both work. The API key above is the shortest path and needs no browser.

OAuth is now also supported for CLIs. `/register` used to refuse a loopback
redirect outright, because it is indistinguishable between local programs — any
process on your machine can claim to be Codex. That is still true, so the flow
does not pretend otherwise: a client registering a loopback callback is
classified as host `cli`, never as `codex` or `claudecode`, and the consent
screen says plainly that Lane cannot verify which program is asking. Approval
is still your explicit, signed-in decision, and PKCE S256 binds the code to the
client that started the flow.

What you get for the extra browser round-trip is a scoped, revocable
per-install credential instead of a long-lived key sitting in your shell
profile. To use it, drop `bearer_token_env_var` and let Codex authorize:

```toml
[mcp_servers.lane]
url = "<the CLI deployment's /mcp URL>"
http_headers = { "X-Lane-Surface" = "codex" }
startup_timeout_sec = 30
tool_timeout_sec = 120
```

Then `codex mcp login lane`. Tokens are bound per host, so a `cli` token is not
usable against the ChatGPT or Claude deployments, and revoking one install does
not touch the others.

The CLI deployment is not stood up yet, which is why there is no URL above —
the server-side flow is in place and the API key remains the supported path
until it is.

## Skills

The Claude Code plugin also ships skills that encode the flow above so the agent
does not have to be told the sequence. Codex reads skills from `.agents/skills`
(per repo) and `$HOME/.agents/skills` (per user), using the same `SKILL.md` +
`name`/`description` frontmatter shape, so
[`../plugins/lane/skills`](../plugins/lane/skills) is largely portable.

Not yet done, and not a copy-paste job: `account-setup` syncs the key into the
Claude Code plugin's keychain-backed `userConfig`, which has no Codex
equivalent — there it is the environment variable in step 2. Port the `lane`
router skill first; it is the one that carries the purchase sequence.
