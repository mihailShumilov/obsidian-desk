---
description: Paranoid security audit of pending changes (or a supplied scope)
argument-hint: [path | "since <ref>" | leave empty for diff vs origin/main]
---

Delegate this audit to the `paranoid-security-review` subagent via the Agent tool. The agent is project-scoped and lives at `.claude/agents/paranoid-security-review.md`; do not duplicate its work inline.

**Scope to pass to the agent:**

- If `$ARGUMENTS` is non-empty, audit exactly that scope. Examples:
  - `programs/obsidian-core` → full Anchor program pass
  - `app/app/deposit` → just the deposit Server Actions and wizard
  - `since origin/main` → diff between working tree and `origin/main`
  - `since HEAD~5` → last five commits
- If `$ARGUMENTS` is empty, audit the diff between the working tree and `origin/main`. Run `git fetch origin main` first so the diff is current, then `git diff --stat origin/main...HEAD` and `git status --short` to enumerate the changed surface — pass that file list to the agent.

**Briefing the agent:**

Hand it the scope plus this context (already in its system prompt, but reinforce):
- ObsidianDesk threat model (10 attacker goals) is canonical — every finding must map to one.
- Re-read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/INSTRUCTIONS.md`, `docs/vendor/*` before starting so it knows which week's deliverables are intentionally plaintext and which are not.
- Read-only — no edits, no commits, no live RPC calls, no project-code execution.
- Output must follow the structured Markdown report format (Critical / High / Medium / Watchlist / Cleared, with severity rubric, threat-goal citation, and confidence calibration).

**After the agent returns:**

1. Print its full report verbatim — do not summarize or rewrite findings.
2. Append a one-line headline suitable for pasting into a PR comment, in this format:
   `secaudit · <N> critical · <N> high · <N> medium · <N> watchlist · scope: <one-phrase scope>`
3. If the agent reports zero findings across all severities, say so explicitly — do not pad with "looks good" or fabricate concerns.
