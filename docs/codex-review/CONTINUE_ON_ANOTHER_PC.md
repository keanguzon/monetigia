# Continue on another Windows PC

The private transfer ZIP contains `monetigia.bundle` and the existing local environment file. Keep the ZIP private: environment values are not committed to Git, but are included in this private transfer package. The bundle includes the locally committed code, workspace skills, instructions, plan, spec, checkpoint, and task reports. It does not require a remote push.

## Transfer and open

1. Copy the ZIP to the new PC and extract it to `C:\MonetigiaTransfer`. Save the conversation separately if desired; the execution state is also recorded in the repository.
2. Install Git, a supported Node.js LTS release, and Codex. Sign in to Codex. These tools and account credentials are not part of the package.
3. Open PowerShell and run:

```powershell
git clone -b codex/goal-reservations C:\MonetigiaTransfer\monetigia.bundle C:\Projects\monetigia
Set-Location C:\Projects\monetigia
Get-ChildItem C:\MonetigiaTransfer -File -Force -Filter '.env*' | Copy-Item -Destination C:\Projects\monetigia
npm ci
```

Stop and resolve any installation error before proceeding. `npm ci` installs the versions in the lockfile; do not copy the old `node_modules` junction or build output.

4. Check the restored checkout:

```powershell
git branch --show-current
git status --short
npx tsc --noEmit
npm test
npm run lint
npm run build
```

Expected branch: `codex/goal-reservations`. Git status should be clean. At the checkpoint, the test suite has 47 Vitest tests and two Node tests. Lint has six existing hook dependency warnings. A new PC must run its own checks rather than rely on the old results.

5. Open `C:\Projects\monetigia` as a project in Codex. Paste the resume prompt below, optionally followed by the saved conversation. The restored repository is a normal checkout, not the old PC's worktree; old absolute paths in reports identify historical evidence only.

## Resume prompt

```text
antislop active: during (session override).

Continue the Monetigia goal reservations plan with Subagent-Driven Development and independent review per task. Read AGENTS.md and the installed workspace skills first.

Read these files before changing code:
- docs/codex-review/TASK_1_2_CHECKPOINT.md
- docs/superpowers/specs/2026-10-06-goal-reservations-design.md
- docs/superpowers/plans/2026-10-06-goal-reservations.md
- .superpowers/sdd/2026-10-06-goal-reservations/progress.md
- docs/codex-review/GOALS_ARCHITECTURE_PAIN_POINTS.md

Tasks 1 and 2 are complete and independently reviewed. Do not implement them again. Verify this checkout and continue from Task 3 when I authorize resuming implementation; merely reading this prompt is not authorization to start Task 3. The prior session stopped after Task 2 at my request.

Keep progress = reserved + spent toward the goal, shown separately. Ordinary overspending uses a soft warning with explicitly confirmed automatic release, committed atomically with the expense. Preserve existing history. Do not deploy migrations against the live database.

Subagents: no Astra. GPT-6-luna medium/high/xhigh as needed, never below medium. GPT-6.1-sol low/medium, with medium the maximum. Choose by complexity and value rather than using one model for everything. Preserve required tests and review quality.

No push, merge, or deployment until my final check. Keep work on codex/goal-reservations. Provision a disposable local database before database work; never run test fixtures against the live .env project. Portable database executables and credentials from the previous PC are intentionally excluded. Historical absolute paths must be adapted to this checkout.
```

## Database and remote setup

The local PostgreSQL/PostgREST installation was specific to the old PC and is excluded. The next agent must recreate disposable database infrastructure before Task 3's integration tests. `.superpowers/sdd/2026-10-06-goal-reservations/local-db-report.md` records the earlier approach; it is evidence, not a ready-to-run installation on the new PC. Do not skip database tests because the tools need provisioning.

Cloning from a bundle makes `origin` point to the bundle file. This is suitable for local continuation. When remote operations are later authorized, configure the original repository URL and authenticate on the new PC. Do not assume the bundle path is a GitHub remote.

The private ZIP does not include Codex login state, global settings, the full conversation, or browser sessions. Repository skills, the checkpoint, and the ledger supply the project handoff.
