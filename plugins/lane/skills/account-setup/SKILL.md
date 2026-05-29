---
name: account-setup
description: Agent-driven onboarding. The agent runs `lane-cli init`, then guides the user through the browser sign-up. The user never has to type a command themselves.
metadata:
  display_name: Lane — Account Setup
  version: 2.0.0
disable-model-invocation: true
---

# Lane Account Setup

`lane-cli init` is a browser-driven sign-up / log-in. The agent runs the command and guides the user through whatever the browser asks for. The user should never have to type anything.

## Prerequisites

- Node.js v18+ on the user's machine.
- `@getonlane/lane-cli` installed (`npm install -g @getonlane/lane-cli`) or available via `npx`.

## Step 1 — Run the command

The agent runs:

```bash
lane-cli init --intent login
```

Use `--intent signup` instead if the user needs to create a new account. The `--intent` flag skips the interactive terminal prompt so the agent can run this without a TTY. The CLI opens a browser automatically. Tell the user: _"A browser just opened — please sign in to your Lane account."_

## Step 2 — User completes the browser flow

The user signs up (or logs in) in the browser. The CLI shows a `Waiting for sign-up…` spinner until the browser flow finishes. The agent waits.

If the user closes the browser by accident, the CLI keeps spinning. The agent re-runs `lane-cli init`.

## Step 3 — Chain into wallet setup if needed

After successful sign-up, the CLI may prompt:

> Want to add a card now?

If it does and the user wants to add a card, the agent can continue directly into the [`wallet-setup`](../wallet-setup/SKILL.md) flow.

## Verifying

```bash
lane-cli wallet ls
```

- Empty wallet → user signed up but skipped the card step. Continue to [`wallet-setup`](../wallet-setup/SKILL.md).
- "Lane isn't set up on this machine yet" → `init` did not complete. Re-run it.

## Notes

- The agent cannot script the browser interaction itself — it can only run the CLI and narrate what the user needs to do in the browser.
- Always pass `--intent login` or `--intent signup` — this skips the Clack picker and lets the agent run without a TTY.
- If the browser doesn't open automatically, the CLI prints a URL — tell the user to copy and open it.

## Common Issues

| Symptom                 | Fix                                                              |
| ----------------------- | ---------------------------------------------------------------- |
| Browser doesn't open    | CLI prints the URL — tell the user to open it manually.          |
| Spinner hangs forever   | User closed the browser early. Agent re-runs `lane-cli init --intent login`. |
| "Already authenticated" | Account already exists locally. Skip to `wallet-setup`.          |
| Times out               | Agent re-runs `lane-cli init --intent login`.                    |

## Handoff

Once the user is signed in, continue to [`wallet-setup`](../wallet-setup/SKILL.md) to add a card and enable it for agentic payments.
