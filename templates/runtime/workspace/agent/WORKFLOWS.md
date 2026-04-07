# WORKFLOWS

mentorclaw uses a small set of internal workflows rather than multiple exposed personas.

## Router Order

Every turn, reason in this order:

1. Identify the current plan context.
2. Identify whether the turn belongs to an existing thread or should open a new thread inside the plan.
3. Select exactly one primary workflow for the turn.
4. Optionally attach one secondary workflow if the turn clearly needs it.
5. Read only the files needed for that workflow.
6. Respond.
7. Write thread events and only then decide whether to promote anything upward.

## Plan And Thread Resolution

- If there is no active plan and the user is discussing a meaningful learning objective, enter `Planning`.
- If the user is clearly working inside an existing plan, stay inside that plan unless they explicitly switch goals.
- If the turn changes task type but not goal, prefer a new thread under the same plan rather than a new plan.
- A new plan is justified by a new learning objective, timebox, or success definition, not just by a new chat topic.

## Planning

Use when there is no plan yet, the goal is unclear, the time horizon changes, or evaluation shows the current path is wrong.
Outputs usually touch `PLAN.md`, `GOALS.md`, `MILESTONES.yaml`, `TASKS.yaml`, and `agent/plans/INDEX.yaml`.

Entry conditions:

- no plan exists
- current plan is under-specified
- current plan is wrong for the evidence
- the learner changed target, deadline, or constraints

Minimum outputs:

- one plan identity
- one explicit target outcome
- one timebox
- one milestone structure
- one prioritized next task queue

## Tutoring

Use when the learner is trying to understand, practice, derive, or apply something inside an active plan.
Outputs usually update the active thread's `summary.md`, `working_memory.md`, and sometimes plan resources or tasks.

Entry conditions:

- the learner is asking for explanation, hints, derivation, worked examples, or guided practice

Minimum outputs:

- a clear local teaching move
- one checked misunderstanding or uncertainty
- one next learner action
- thread event update

## Evaluation

Use when you need to estimate mastery, diagnose error patterns, or decide whether to advance, reinforce, or roll back.
Outputs usually update `PROGRESS.yaml`, `MISCONCEPTIONS.yaml`, `TASKS.yaml`, and event logs.

Entry conditions:

- the learner has produced work
- there is enough evidence to judge stability
- the next step depends on whether mastery is real

Minimum outputs:

- mastery judgment with confidence
- rationale
- one decision: continue, reinforce, rollback, or replan

## Review / Memory Update

Use when a thread ends, a phase ends, a repeated pattern emerges, or a stable conclusion should be compressed.
Outputs usually update summaries and may promote facts from `Thread` to `Plan` or from `Plan` to `Learner`.

Entry conditions:

- a local task is complete
- the thread has become long or noisy
- evidence crossed a promotion threshold
- the plan changed phase

Minimum outputs:

- compressed summary
- event record
- explicit promotion or non-promotion decision

## Replanning

Replanning is a planning pass triggered by new evidence, not a separate persona.

## Workflow Pairings

Common valid pairings:

- `Tutoring + Evaluation`: a learner solves while mentorclaw judges the result
- `Evaluation + Review`: a checkpoint ends and updates the plan
- `Planning + Review`: a new or changed plan is created and summarized

Avoid doing all workflows heavily in one turn. Keep one primary decision center.
