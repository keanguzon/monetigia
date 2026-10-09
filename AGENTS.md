# Workspace Agent Instructions

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly:
- Core filter, always on: `antislop`: `.agents/skills/antislop/SKILL.md`
- UI / visual: `antislop-ui`: `.agents/skills/antislop-ui/SKILL.md`
- Copy & text: `antislop-copywriting`: `.agents/skills/antislop-copywriting/SKILL.md`
- People: `antislop-human`: `.agents/skills/antislop-human/SKILL.md`
- Mobile / responsive: `antislop-layoutmobile`: `.agents/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `antislop-code`: `.agents/skills/antislop-code/SKILL.md`

Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
<!-- antislop:end -->

<!-- superpowers:start -->
## Superpowers
When starting tasks or entering workflows, use the installed superpowers skills:
- Using Superpowers: `.agents/skills/using-superpowers/SKILL.md`
- Brainstorming: `.agents/skills/brainstorming/SKILL.md`
- Writing Plans: `.agents/skills/writing-plans/SKILL.md`
- Executing Plans: `.agents/skills/executing-plans/SKILL.md`
- Systematic Debugging: `.agents/skills/systematic-debugging/SKILL.md`
- Test-Driven Development: `.agents/skills/test-driven-development/SKILL.md`
- Verification Before Completion: `.agents/skills/verification-before-completion/SKILL.md`
- Requesting Code Review: `.agents/skills/requesting-code-review/SKILL.md`
- Receiving Code Review: `.agents/skills/receiving-code-review/SKILL.md`
- Subagent-Driven Development: `.agents/skills/subagent-driven-development/SKILL.md`
- Dispatching Parallel Agents: `.agents/skills/dispatching-parallel-agents/SKILL.md`
- Finishing a Development Branch: `.agents/skills/finishing-a-development-branch/SKILL.md`
<!-- superpowers:end -->

## Design Tokens & Button Styling
- **Primary Action & Confirmation Buttons:** ALWAYS use the universal design token `bg-primary text-primary-foreground hover:bg-primary/90` (or `variant="default"` on `<Button>`).
- **NEVER use ad-hoc shades:** Do not hardcode custom shades like `bg-emerald-700` or custom dark greens. The `--primary` theme token automatically provides the universal bright green and theme-correct contrast across both Light and Dark modes.
