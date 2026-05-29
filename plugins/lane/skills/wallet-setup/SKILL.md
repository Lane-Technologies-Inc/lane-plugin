---
name: wallet-setup
description: Agent-driven card management. The agent runs `lane-cli wallet add` and `lane-cli wallet enable-agentic`, then guides the user through the browser flows. The user never has to type a command themselves.
metadata:
  display_name: Lane — Wallet Setup
  version: 2.0.0
disable-model-invocation: true
---

# Lane Wallet Setup

Two commands take a user from "no card" to "ready to make payments". The agent runs both — the user only interacts with the browser windows that open.

1. `lane-cli wallet add` — collect card details in the browser (Lane never sees the raw card number).
2. `lane-cli wallet enable-agentic` — complete the FIDO passkey ceremony so the card can be used for agent-initiated payments.

## Prerequisite

The user has a Lane account. If `lane-cli wallet ls` reports "Lane isn't set up on this machine yet", run [`account-setup`](../account-setup/SKILL.md) first.

## Step 1 — Add a card

The agent runs:

```bash
lane-cli wallet add
```

A browser opens with a secure card-entry form. Tell the user: _"A browser just opened — please enter your card details there (card number, expiry, CVC, billing address)."_

The agent waits. When the user finishes, the CLI confirms the card is saved.

If the card-entry flow auto-chained into the passkey ceremony in the same browser session, **Step 2 may already be done** — verify with `lane-cli wallet ls` before running it again.

## Step 2 — Enable agentic (passkey ceremony)

The agent runs:

```bash
lane-cli wallet enable-agentic <last4>
```

`<last4>` is optional. With it, the CLI targets that specific card. Without it, the CLI uses the default card.

A browser opens for Touch ID / passkey / OTP step-up. Tell the user: _"A browser just opened — please tap your passkey (or Touch ID) to enable this card for agent payments."_

The agent waits. **This step must complete before any agent-initiated payment will work.**

## Verifying

```bash
lane-cli wallet ls
```

Cards appear with a default flag. To confirm a card is fully enabled, re-run:

```bash
lane-cli wallet enable-agentic <last4>
```

It prints "Already enabled for AI-agent payments" if the ceremony has already landed.

## Other Wallet Commands

| Command                            | Purpose                                               | Driver                       |
| ---------------------------------- | ----------------------------------------------------- | ---------------------------- |
| `lane-cli wallet ls`               | List cards with default flag.                         | Agent                        |
| `lane-cli wallet default <last4>`  | Set the default card.                                 | Agent                        |
| `lane-cli wallet rm <last4> --yes` | Remove a card.                                        | Agent (confirm intent first) |

`add` and `enable-agentic` are run by the agent; the user only interacts with the browser. `rm` is destructive — the agent confirms the user's intent verbally before running it.

## Notes

- The agent cannot script the browser interactions — it runs the CLI command and narrates what the user needs to do in the browser that opens.
- Do not run `lane-cli wallet rm` without explicit user confirmation.
- The passkey ceremony cannot be bypassed; agentic payments require it.

## Common Issues

| Symptom                                              | Fix                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Browser closes mid-flow                              | Agent re-runs the command.                                                     |
| `enable-agentic` says "Already enabled"              | Card is already passkey-enabled. Move to the purchase flow.                    |
| `lane-cli pay` fails with "card not found"           | Passkey ceremony was skipped. Agent runs `lane-cli wallet enable-agentic`.     |
| Multiple cards, no default                           | Agent runs `lane-cli wallet default <last4>`.                                  |

## Handoff

When the user has at least one card and `lane-cli wallet enable-agentic` reports "Already enabled", the wallet is ready. Move to the purchase flow (intent-mcp → `lane-cli pay`).
