# Lane — Agentic Commerce plugin

Lets your Claude Code agent authorize and execute real payments on your card,
through [Lane](https://getonlane.com).

## What's inside

- **Skills** — the deterministic Lane purchase flow and its setup sub-skills
  (`lane` router, `account-setup`, `wallet-setup`). The agent runs everything;
  you only tap a passkey in the browser when asked.
- **MCP server** (hosted) — `lane-mcp`, the single server that drafts + approves
  a purchase intent and then drives the autonomous checkout (cart + credential
  mint + payment + confirm). Wired in automatically; no `claude mcp add` needed.
- **Auto-install hook** — installs the `@getonlane/lane-cli` binary via npm on
  first session if it isn't already on your PATH. Cross-platform: a Node
  dispatcher (`install-check.mjs`) runs `install-check.sh` on macOS/Linux and
  `install-check.ps1` on Windows.

## Setup

1. Enable the plugin. When prompted, paste your **Lane API key** (or leave it
   blank and set it later — see below).
2. The Lane CLI installs automatically on the first session (requires Node/npm).
3. Tell Claude what you want to buy: *"buy a 6-person tent from REI under $250"*.
   If you're not logged in yet, the agent walks you through `lane-cli init`,
   adding a card, and enabling it for agent use — all via the browser.

### Getting / setting your Lane API key

The MCP server authenticates with your Lane API key. After `lane-cli init`
logs you in, the key is written to `~/.lane/config.json` under `"apiKey"`.
Copy it into the plugin's **Lane API key** setting via `/plugin` →
configure → `lane`. (Stored in your OS keychain, never in plain settings.)

## Endpoints

Defaults point at Lane **production**:

| Server   | Default URL                      |
| -------- | -------------------------------- |
| lane-mcp | `https://mcp.getonlane.com/mcp`  |

Override them in the plugin config to point at production
(`https://mcp.getonlane.com/{intent,checkout}/mcp`) once it's live.

## Surfaces (iMessage, WhatsApp, mobile app, or your own client)

Lane adapts the purchase-approval UX to wherever your agent runs. Tell Lane the
"surface" by sending one extra HTTP header on the MCP connection:

```
X-Lane-Surface: <surface>
```

Recognized values and what they do:

| `X-Lane-Surface`                                            | Family | Approval UX |
| ----------------------------------------------------------- | ------ | ----------- |
| `imessage`, `whatsapp`, `sms`                               | chat   | Terms render in the chat thread; the user approves by replying. No browser, no passkey (card-on-file purchases). |
| `claudecode`, `codex`, `chatgpt`, `claude`, `browser`, `mobileapp` | rich   | The user approves in the browser wallet (passkey, or no-passkey card-on-file). |
| missing / anything else                                     | rich   | Safe default. Behaves exactly as before this header existed. |

The header is a rendering hint only. It never changes which payment methods are
allowed or who may approve: approval is always bound to your Lane API key's
wallet identity, and the card-on-file-only rule for in-thread approval is
enforced on the server. Setting a different surface cannot unlock a weaker
approval.

### How to set it

**Claude Code** (or any HTTP MCP client that supports headers):

```bash
claude mcp add --transport http lane-mcp \
  https://mcp.getonlane.com/mcp \
  -H "Authorization: Bearer $LANE_API_KEY" \
  -H "X-Lane-Surface: claudecode"
```

**Your own client / bridge** (e.g. an iMessage or WhatsApp bot that speaks MCP):
add both headers to every request on the streamable-HTTP MCP connection:

```
Authorization: Bearer <your lane_ api key>
X-Lane-Surface: imessage
```

**Plugin config**: the `mcpServers.lane-mcp.headers` block in
`.claude-plugin/plugin.json` can carry a fixed `X-Lane-Surface` if your
deployment always runs on one surface.

### What the agent does on a chat surface

On a chat surface with a card-on-file wallet (no passkey-enrolled card), instead
of opening a browser the agent:

1. drafts the purchase with `intent_submit` (returns `draft_session_id`);
2. calls `intent_get_terms(session_id, draft_session_id)` and pastes the returned
   terms into the thread (merchant, items, "Spending limit: up to $X", "paid with
   the card on file");
3. on the user's "yes", calls `intent_approve(session_id, draft_session_id,
   confirmation, shipping_address?)` to approve in-thread.

If the wallet has a passkey card, or the surface is rich, `intent_get_terms`
returns `use_link` and the agent shares the browser `approval_url` instead.

## License

MIT
