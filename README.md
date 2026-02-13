# gh-feed (`gh feed`)

Terminal UI for reading and replying to GitHub pull request discussions from the CLI.

`gh-feed` uses your existing `gh` auth/session and runs as a GitHub CLI extension.

## Install

```bash
gh extension install jo-es/gh-feed
```

If already installed:

```bash
gh extension upgrade feed
```

## Run

```bash
gh feed
```

Options:

- `--pr <number>`: preselect a PR in the picker.
- `--repo <owner/repo>`: target a specific repository.

## What You Get

- Open-PR picker.
- Unified top timeline with:
  - PR description + discussion comments
  - inline review threads + review summaries
  - commit entries
  - review-requested system events
- Status indicators in header:
  - CI (`pass`/`fail`/`pending`)
  - merge conflicts (`conflicts`/`no conflicts`)
- Bottom detail pane for full content with markdown-style rendering and clickable links.
- Compose/reply from the detail pane.
- Copilot review request action (`[Copilot Review]` in comments header).
- Auto-refresh every 30 seconds (keeps last good snapshot on refresh failure).

## Keys

PR picker:

- `j`/`k` or up/down: move selection
- `Enter`: open selected PR
- `r`: refresh PR list
- `q`: quit

Comments view:

- `j`/`k` or up/down: move selected row
- `Tab`: switch focus between top list and bottom detail panel
- `Enter` on `Press Enter to add a new comment...`: compose top-level comment
- `r`: reply to selected comment
- `c`: request Copilot review
- `b`: back to PR picker
- `m`: toggle mouse capture
- `q`: quit

Compose:

- Type to edit
- `Enter`: newline
- `Ctrl+S`: send
- `Esc`: cancel
- `[Send]` / `[Cancel]` are clickable when mouse capture is on

## Contributing

Small, focused PRs are welcome.
