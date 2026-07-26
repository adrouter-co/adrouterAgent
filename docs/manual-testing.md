# Manual acceptance test

This checklist validates AdRouter Agent against a live local router. It is
designed to confirm the same user-visible behavior as the packaged functional
test while also exercising real provider streaming, sponsored routing, and
settlement.

## Preconditions

- macOS 12 or newer and Node.js 25.9.0.
- The sibling `router/backend` dependencies and this repository's dependencies
  are installed.
- `router/backend/.env.local` contains distinct `ADROUTER_API_KEY` and
  `DEEPSEEK_API_KEY` values.
- No unrelated process is using router port 8787; the local backend should own
  that port during the test.
- The test project contains no secrets and can safely receive a small edit.

Never paste either credential into terminal output, screenshots, chat prompts,
or issue reports.

## 1. Verify the router

From `router/backend`, install dependencies if needed and start the service:

```bash
npm install
npm run dev
```

In another terminal, verify health and authenticated CLI diagnostics:

```bash
curl -fsS http://localhost:8787/health
../../adrouterCLI/run-adrouter-live.sh --json doctor
```

Confirm that health reports `status: "ok"`, `mode: "live"`,
`llm.configured: true`, and `profile.configured: true`. Confirm that doctor
reports a reachable live router and available authentication. Health alone
does not validate the bearer token.

Optionally validate the exact agent-turn stream used by the desktop from the
`adrouterAgent` directory:

```bash
cd ../../adrouterAgent
ADROUTER_API_URL=http://localhost:8787 \
ADROUTER_API_KEY='your local bearer token' \
npm run smoke:live
```

The command must finish with `Live router smoke passed`. Avoid placing the
token in shell history on shared machines; exporting it from a protected local
environment is preferable.

## 2. Launch and onboard

From `adrouterAgent`:

```bash
nvm install 25.9.0
nvm use 25.9.0
npm ci
npm run dev
```

Confirm Node reports `v25.9.0`. This is the Electron desktop app; it does not
start the `adrouter` CLI executable or the backend automatically. On first
launch:

1. Enter `http://localhost:8787` as the server URL.
2. Enter the router's `ADROUTER_API_KEY` as the access token.
3. Choose whether sponsored compute is enabled.
4. Select **Test connection** and confirm health, authentication, and model
   discovery succeed.
5. Select **Save securely**.

Restart the app once and confirm onboarding remains complete. The token should
never be visible again in the renderer or written to application events.
If the app is pointed at a remote router, verify the URL uses HTTPS. HTTP is
accepted only for loopback development URLs.

## 3. Open a project

Select **Choose folder** and open a disposable project. Confirm the header
shows the correct folder. Test both kinds of workspace when practical:

- A Git worktree: branch and dirty-state metadata are available.
- A normal non-Git folder: chat and file tools remain usable without Git data.

If the project has `AGENTS.md` or `.agent/instructions.md`, confirm its
instructions affect agent behavior. In **Settings**, save a short project
instruction, reopen the project, and confirm it persists separately from the
repository-owned instructions. Confirm **Settings** reports which repository
instruction files were loaded and that project instructions are not written to
the repository automatically.

## 4. Validate read-only work

Before sending, switch models and thinking levels in the composer. Confirm only
levels supported by the selected model are offered. Verify **Enter** sends and
**Shift+Enter** inserts a newline. Open **Settings** and confirm router
connection, live/mock mode, last check time, and current models are displayed.

Ask the agent to summarize a harmless text file without changing anything.
Confirm:

- Thinking and coding activity streams into the chat.
- File listing, reading, literal search, Git status, and Git diff do not create
  approval cards.
- Protected files such as `.env`, `.npmrc`, SSH keys, AWS credentials, and
  files reached through an escaping symlink cannot be read.
- No change appears in the **Changes** drawer.
- In **Settings**, refresh Agent status and confirm the router mode, server URL,
  last check time, and model catalog are shown. Temporarily make the router
  unavailable and confirm the last known catalog is marked stale rather than
  treated as a fresh authentication result.

## 5. Validate mutation approval

Ask for a small, unambiguous text edit. When the approval card appears:

1. Verify it names the exact relative path and shows a bounded mutation
   preview.
2. Select **Deny** and confirm the file is byte-for-byte unchanged.
3. Ask for the edit again, select **Allow once**, and confirm only the requested
   file changes.
4. Request another edit and confirm a new approval is required; the earlier
   choice must not be remembered.

Open **Changes** and confirm the approved agent edit appears in a read-only
unified diff. Pre-existing user changes should not be attributed to the agent.
The drawer must not stage, revert, accept, or commit files.

## 6. Validate command approval and sandboxing

Ask the agent to run a harmless project check such as `npm run typecheck` or
`pwd`. Confirm the card displays the exact argv and working directory. Select
**Allow once** and verify live output, exit status, and duration are recorded.
Request the identical command again and confirm a new approval is required.

Then verify hard policy boundaries with disposable requests:

- A network command such as `curl https://example.com` is denied.
- Dependency installation such as `npm install` is denied.
- A privileged command such as `sudo ...` is denied.
- An absolute or parent-relative path outside the workspace is denied.
- A destructive or remote Git operation is denied.
- Shell operators, command interpolation, and in-place `sed -i` edits are
  denied; commands must use a plain argv and file changes must use
  `apply_patch`.

These operations must remain blocked without presenting approval as a policy
bypass. If the OS sandbox cannot initialize, all commands must fail closed.

Verify that a read-only project can still be inspected but cannot accept file
mutations. If the project is in `workspace-write` mode, confirm the exact same
mutation requires a new approval each time; there is no persistent allowlist.

## 7. Validate stop and recovery

Start a task that produces a longer stream or command, then select **Stop**.
Confirm the UI returns to an idle state, the command process group ends, queued
messages are cleared, pending approvals are denied, and the turn is recorded as
cancelled.

For crash recovery, start a disposable task and force-quit the app. Relaunch it
and confirm the active turn is marked interrupted rather than resumed or left
running.

## 8. Validate sponsor isolation and settlement

With sponsored compute enabled, complete a task and confirm the appropriate
tier presentation:

- A sponsor similarity score greater than `0.85` produces Tier A; greater than
  `0.60` produces Tier B; lower scores produce Tier C.
- Tier B and Tier C appear immediately in both the active thinking/coding
  stream and above the composer when their ad payload arrives.
- Confirm the top Tier B/C banner disappears when generation ends while the
  bottom banner remains attached above the composer until it is closed or the
  next prompt is submitted. Confirm its expand/retract animation and close
  button.
- Trigger a command approval and confirm its approval card shares the composer
  dock, expands into view, and retracts after Allow once or Deny.
- Tier A appears as a hideable inline sponsor surface inside the completed
  answer and records a 100% subsidy.
- Tier B appears as a hideable sponsor panel below the completed answer and
  records a 40% subsidy.
- Tier `NONE` appears as the privacy/guardrail notice and records no subsidy.
  Exercise a sensitive prompt, disable sponsored compute, and use a prompt
  with no available inventory when validating this path.

In **Settings**, confirm cost, subsidy, paid amount, token/cache usage, daily
totals, and sponsor tier are displayed after settlement. Inspect router logs or
deterministic test captures when needed and confirm sponsor copy never appears
inside model messages, tool arguments, command argv, patches, project
instructions, or final evidence.

If the turn performs multiple agent/router rounds, confirm the completed answer
shows a collapsible sponsorship summary with the number of rounds and the
aggregated cost, subsidy, and paid amount.

## 9. Completion criteria

Open **History**, delete a terminal disposable chat, cancel the first
confirmation, then confirm deletion. The chat and its stored events must be
removed while every project file remains unchanged. Running and
approval-waiting chats must not be deletable.

The build passes manual acceptance when all of the following hold:

- Onboarding authenticates and persists securely.
- Git and non-Git projects open successfully.
- A live model streams thinking, tool activity, and a final response.
- Reads are silent; every mutation and general command asks exactly once.
- Denial leaves the workspace unchanged; approval performs only the displayed
  action.
- The sandbox blocks network, credentials, privilege escalation, and
  out-of-workspace access.
- Changes and completion evidence accurately reflect journaled execution.
- Stop and restart produce deterministic cancelled/interrupted states.
- Sponsor display and economics work without entering agent context.

Record the app version, commit, macOS version, Node version, router mode, model,
thinking level, sponsored-compute setting, and any failed checklist item.
Redact all tokens and provider credentials. Do not attach the application's
SQLite database or configuration file without reviewing it for sensitive local
metadata first.
