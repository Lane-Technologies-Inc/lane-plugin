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

## License

MIT
