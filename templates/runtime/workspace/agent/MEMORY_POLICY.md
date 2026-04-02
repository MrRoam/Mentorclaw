# MEMORY_POLICY

Educlaw uses three layers of memory.

## Layers

- `Learner`: stable facts that remain useful across plans
- `Plan`: stable facts that matter inside one learning objective
- `Thread`: short-lived local work state for one conversation window

## File Contracts

### Learner

- `PROFILE.md`: stable identity, background, constraints, long-term traits
- `PREFERENCES.md`: repeated and confirmed learning preferences
- `GLOBAL_GOALS.md`: cross-plan goals and tensions
- `GLOBAL_MISCONCEPTIONS.yaml`: recurring misconceptions that survive one plan
- `LEARNER_STATE.yaml`: machine-readable current learner-level state
- `EVENTS.jsonl`: learner-level promoted events

### Plan

- `PLAN.md`: why this plan exists and what counts as success
- `GOALS.md`: target structure
- `PROGRESS.yaml`: current phase and mastery snapshot
- `TASKS.yaml`: next executable queue
- `MILESTONES.yaml`: major checkpoints
- `MISCONCEPTIONS.yaml`: plan-level repeated mistakes
- `RESOURCES.md`: prioritized plan resources
- `SUMMARY.md`: compressed plan state
- `EVENTS.jsonl`: plan-level event stream

### Thread

- `summary.md`: compressed local thread state
- `working_memory.md`: temporary whiteboard
- `events.jsonl`: local event stream
- `meta.json`: identifiers and labels only

## Read Order

1. Learner
2. Active plan
3. Active thread
4. Curriculum slices only when needed

## Write Order

1. Thread event
2. Plan update if the fact affects this plan beyond one turn
3. Learner update only if the fact is stable across time or across plans

## Per-Turn Update Algorithm

1. Identify what actually happened in the turn.
2. Write the smallest event that records that fact.
3. Update `working_memory.md` only with information needed for the next few turns.
4. If the turn changed local understanding, task status, or blocker state, update thread `summary.md`.
5. If the turn changed plan execution or revealed a repeated pattern, update plan files.
6. If the turn adds only weak evidence for a long-term trait, leave it in events and wait.
7. Only rewrite learner-level files when evidence is repeated, stable, and decision-relevant.

## Promotion Rules

- Keep one-off confusion, derivation steps, and temporary blockers in `Thread`.
- Promote repeated errors, pacing shifts, task changes, and stage decisions to `Plan`.
- Promote long-term preference, persistent misconception, and stable capability patterns to `Learner`.

## Event Schema

Each JSONL event should be a small object with fields like:

- `ts`
- `level`
- `type`
- `plan_id` when relevant
- `thread_id` when relevant
- `topic`
- `evidence`
- `impact`
- `promotion`

Example intent:

- a thread event says what happened locally
- a plan event says what changed in the plan
- a learner event says what stable cross-plan fact was promoted

## Evidence Rules

- One correct answer is not mastery.
- One incorrect answer is not a long-term weakness.
- One stated preference is a signal, not a stable trait.
- Prefer repeated evidence over confident speculation.

## Conflict Rules

- New evidence does not automatically overwrite old stable memory.
- If evidence conflicts, mark uncertainty first and delay promotion.
- When in doubt, downgrade confidence instead of hard-rewriting the learner model.

## Compaction Rules

- Thread memory should be aggressively compacted.
- Plan summaries should be rewritten when phases change, not every turn.
- Learner files should change slowly.
- Raw event logs are the audit trail; summaries are the compressed operating surface.

## Operational Rule

Event first, state second. If the evidence is weak, update the event log and wait before rewriting long-term state.
