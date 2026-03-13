# AGENTS.md

## Skills
A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.

### Available skills
- `find-skills`: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill. File: `C:/Users/USER/.agents/skills/find-skills/SKILL.md`
- `openai-docs`: Use when the user asks how to build with OpenAI products or APIs and needs up-to-date official documentation with citations, help choosing the latest model for a use case, or explicit GPT-5.4 upgrade and prompt-upgrade guidance; prioritize OpenAI docs MCP tools, use bundled references only as helper context, and restrict any fallback browsing to official OpenAI domains. File: `C:/Users/USER/.codex/skills/.system/openai-docs/SKILL.md`
- `skill-creator`: Guide for creating effective skills. This skill should be used when users want to create a new skill or update an existing skill that extends Codex capabilities with specialized knowledge, workflows, or tool integrations. File: `C:/Users/USER/.codex/skills/.system/skill-creator/SKILL.md`
- `skill-installer`: Install Codex skills into `$CODEX_HOME/skills` from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo, including private repos. File: `C:/Users/USER/.codex/skills/.system/skill-installer/SKILL.md`

### How to use skills
- Discovery: The list above is the skills available in this session. Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill with `$SkillName` or plain text, or the task clearly matches a skill description shown above, use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing or blocked: If a named skill is not in the list or the path cannot be read, say so briefly and continue with the best fallback.
- How to use a skill:
  1. After deciding to use a skill, open its `SKILL.md`. Read only enough to follow the workflow.
  2. When `SKILL.md` references relative paths such as `scripts/foo.py`, resolve them relative to the skill directory first, and only consider other paths if needed.
  3. If `SKILL.md` points to extra folders such as `references/`, load only the specific files needed for the request; do not bulk-load everything.
  4. If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.
  5. If `assets/` or templates exist, reuse them instead of recreating from scratch.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order used.
  - Announce which skill is being used and why in one short line. If an obvious skill is skipped, say why.
- Context hygiene:
  - Keep context small. Summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deep reference chasing. Prefer opening only files directly linked from `SKILL.md` unless blocked.
  - When variants exist, pick only the relevant reference files and note that choice.
- Safety and fallback: If a skill cannot be applied cleanly because files are missing or instructions are unclear, state the issue, pick the next best approach, and continue.

## Project Workflow
- Before planning or executing any prompt, read `docs/process/prompt-delivery-workflow.md`.
- Use `docs/prd/mvp-ms-control-center.md` as the canonical product scope document.
- Use `docs/product/mvp-epics-stories.md` as the source of truth for epic and story intent, acceptance criteria, and story completion status.
- Use `docs/product/mvp-roadmap.md` as the source of truth for implementation tasks, dependencies, and scope changes.
- Use the relevant `docs/areas/*/README.md` file as the source of truth for the current state of each product area.
- When a task is completed, update its checkbox to `[x]` in the roadmap, then sync the affected story status and the checklist in the area README.
- Mark a story as `[x]` only when all linked tasks are complete and its acceptance criteria are satisfied.
- If work appears that was not planned, add it to `docs/product/mvp-roadmap.md` first, then reflect it in the affected area README before closing the prompt.
- Keep shared IDs stable across documents using the format `E1`, `US1.1`, and `T1.1.1`.
