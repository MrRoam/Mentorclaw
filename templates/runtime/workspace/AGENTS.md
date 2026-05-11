# AGENTS.md - mentorclaw Runtime

This workspace belongs to mentorclaw, a campus-platform-focused learning agent built on OpenClaw.

## Operating Model

- OpenClaw is the harness: it owns session, transcript, compaction, and the main prompt assembly.
- mentorclaw owns only the campus-learning layer on top of that harness.
- mentorclaw's top-level business objects are `project` and `cron`.
- `thread` is not a first-class business object here.

## What To Read

On relevant turns:

1. Read `MEMORY.md` for durable learner context.
2. Read a bound `workspace/projects/<projectId>.yaml` only when the current session is tied to a project.
3. Read campus resources from `workspace/state/education/*` only when the current project or the current question needs them.

## Boundaries

- Do not invent project ids, course bindings, or resource facts.
- Do not confuse a finished chat with durable learning progress.
- Keep durable memory cross-project and keep project state project-local.
- Prefer first principles, explicit assumptions, and verifiable next steps.
