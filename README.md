# Lane plugin for Claude Code

A downloadable [Claude Code](https://code.claude.com) plugin that turns your
agent into an agentic-commerce buyer: it drafts a purchase intent, you approve
it with a passkey, and Lane's `checkout-mcp` autonomously completes the
purchase. Bundles the Lane skills, the `intent-mcp` + `checkout-mcp` servers,
and an auto-installer for the `@getonlane/lane-cli` binary.

This repository is also a **plugin marketplace** named `lane-cli` containing one
plugin, `lane`.

## Install

### Option A — from this repo (recommended)

```text
/plugin marketplace add Lane-Technologies-Inc/lane-plugin
/plugin install lane@lane-cli
```

(Use the repo URL or a local clone path instead of the `owner/repo` shorthand
if you're hosting it elsewhere: `/plugin marketplace add /path/to/lane-plugin`.)

### Option B — from a downloaded copy

Unzip `lane-plugin.zip`, then either:

```text
/plugin marketplace add /absolute/path/to/lane-plugin
/plugin install lane@lane-cli
```

or load the plugin directly without a marketplace:

```bash
claude --plugin-dir /absolute/path/to/lane-plugin/plugins/lane
```

## After install

1. Set your **Lane API key** in the plugin config (`/plugin` → configure →
   `lane`). It authenticates the MCP servers. Get it from `lane-cli init`
   (written to `~/.lane/config.json`) or the Lane dashboard.
2. The `@getonlane/lane-cli` binary installs automatically on the first session
   (needs Node/npm on PATH). Works on macOS, Linux, and Windows — a Node
   dispatcher runs the matching install script (`.sh` / `.ps1`).
3. Say what you want to buy. The agent handles login, wallet setup, intent
   approval (one passkey tap), and checkout.

## Endpoints

The intent-mcp and checkout-mcp URLs are baked into the plugin manifest and
point at Lane **staging** (the only environment deployed today):
`https://mcp-staging.aws.getonlane.com/intent/mcp` and `/checkout/mcp`. There is
nothing to configure — only the API key is prompted. When production launches,
swap the `mcpServers` URLs in `plugins/lane/.claude-plugin/plugin.json` to
`https://mcp.getonlane.com/{intent,checkout}/mcp`.

## What's bundled

```
plugins/lane/
├── .claude-plugin/plugin.json   # manifest: userConfig + inline MCP servers
├── skills/                      # lane router + setup/payment sub-skills
├── hooks/                       # SessionStart: auto-install lane-cli
└── README.md
```

## License

MIT
