# mentorclaw Implementation Notes

This document explains what is implemented in the current mentorclaw source repo, how the OpenClaw adapter works, what has been verified, and how to test it safely.

## Current Status

mentorclaw now has two layers:

- `source repo`: `/home/jiaxu/mentorclaw-source`
- `runtime instance`: `/home/jiaxu/.mentorclaw`

The source repo contains the generic education kernel and the OpenClaw plugin package. The runtime instance contains live workspace state, logs, credentials, channel bindings, device pairings, and session data.

The OpenClaw integration is now live at the plugin level:

- plugin id: `mentorclaw-kernel`
- hook: `before_prompt_build`
- hook: `agent_end`

That means mentorclaw is no longer only a demo script. It is attached to OpenClaw's real turn pipeline.

## What Has Been Implemented

### 1. Generic Education Kernel

Core logic lives under `src/core/`.

- `orchestrator.ts`
  - central entrypoint for turn handling
  - loads learner/plan/thread state
  - routes workflow
  - creates plan/thread when needed
  - rebalances tasks
  - builds prompt context
  - writes events back to memory
- `workflow-router.ts`
  - classifies a turn into `planning`, `tutoring`, `evaluation`, `review`, or `replanning`
  - uses message intent, current plan state, and risk signals
- `task-engine.ts`
  - generates seed tasks
  - rebalances open tasks
  - computes proactive actions such as overdue reminders and replan suggestions
- `plan-manager.ts`
  - create / pause / complete / replan plan lifecycle actions
- `thread-manager.ts`
  - manage local work threads under a plan
- `context-builder.ts`
  - constructs the minimal learner/plan/thread/resource context that should be injected into the model
- `memory-updater.ts`
  - writes events first
  - then promotes stable information from thread to plan to learner

### 2. Formal State Contracts

Typed contracts live in `src/schemas/models.ts`.

These include:

- `LearnerState`
- `PlanState`
- `ThreadState`
- `LearningEvent`
- `AssessmentResult`
- `TaskItem`
- `ResourceRef`
- `WorkflowDecision`
- `TurnInput`
- `TurnOutcome`

This is the stable boundary between orchestration logic and runtime state.

### 3. Runtime Workspace Repository

`src/storage/workspace-repo.ts` is the filesystem adapter between the source repo and the runtime instance.

It is responsible for:

- reading bootstrap files from the runtime workspace
- reading learner state
- reading and writing plan state
- reading and writing thread state
- creating new plans and threads
- appending learner / plan / thread event logs
- validating the minimum runtime scaffold

### 4. Resource Pipeline Interfaces

`src/resources/pipeline.ts` defines the future-facing resource layer:

- `source_registry`
- `ingestion_provider`
- `resource_normalizer`
- `quality_scorer`
- `rights_policy`
- `resource_binder`

These are interface-level only right now. The full online ingestion pipeline is not implemented yet.

### 5. OpenClaw Adapter

The adapter layer lives in two places:

- plugin package: `plugin/mentorclaw-kernel/`
- adapter helpers: `src/integration/openclaw-adapter.ts`

What it does:

- `before_prompt_build`
  - resolves the mentorclaw runtime root
  - loads the last plan/thread bound to the current OpenClaw session
  - runs `mentorclawOrchestrator.handleTurn(...)`
  - injects the resulting learner/plan/thread context into system-prompt space
  - writes the session binding back to `workspace/.openclaw/mentorclaw-session-bindings.json`
- `agent_end`
  - reads the final assistant reply from the turn payload
  - appends an `assistant_reply_recorded` or `assistant_reply_failed` event to the thread
  - updates thread summary and working memory

This adapter is packaged as a real OpenClaw plugin bundle, not just a TypeScript source file.

### 6. Plugin Packaging

The plugin package is now shaped the way OpenClaw expects:

- `plugin/mentorclaw-kernel/openclaw.plugin.json`
- `plugin/mentorclaw-kernel/package.json`
- `plugin/mentorclaw-kernel/dist/index.js`

The JS bundle is built from `plugin/mentorclaw-kernel/index.ts` via:

- `scripts/build-plugin.mjs`
- `npm run build:plugin`

This packaging step was necessary because OpenClaw does not load raw TypeScript plugin entries directly in this setup.

### 7. Local Debug UI

The source repo now also includes a local browser-based debug UI:

- service layer: `src/debug-ui/service.ts`
- local server entry: `scripts/debug-ui.ts`
- static UI shell: `src/debug-ui/static/`

What it does:

- reads learner / plan / thread state directly from the runtime workspace
- reads and writes `workspace/.openclaw/mentorclaw-session-bindings.json`
- shows the hierarchy as `plan -> thread`, with bound `sessionKey` values visible on each thread
- can create plans and threads without inventing a second state store
- can run a local user turn through `mentorclawOrchestrator.handleTurn(...)`
- can record an assistant reply through the same `recordAgentEnd(...)` write-back path used by the plugin

This is intentionally a local debugging workstation, not a second product runtime.

## How the Logic Works

For each user turn:

1. OpenClaw receives the message.
2. `before_prompt_build` runs inside the `mentorclaw-kernel` plugin.
3. mentorclaw loads learner state and tries to recover the active plan/thread for the current session.
4. mentorclaw routes the turn into a workflow:
   - `planning`
   - `tutoring`
   - `evaluation`
   - `review`
   - `replanning`
5. If needed, it creates a new plan and thread.
6. It rebalances tasks and computes proactive actions.
7. It injects the kernel context into system-prompt space, not the visible user message body.
8. The model answers.
9. `agent_end` runs and records the final assistant reply back into thread memory.

The current write-back path is intentionally conservative:

- create / update learner state
- create / update plan state
- create / update thread state
- append event logs

It does not yet do advanced evidence extraction from attachments, tools, or external resources.

## What Has Been Verified

### Static verification

- `node --experimental-strip-types --test`
- `node --experimental-strip-types scripts/validate-runtime.ts`
- `npm run build:plugin`

### OpenClaw plugin verification

Using the current runtime config, OpenClaw reports:

- plugin id `mentorclaw-kernel` is `loaded`
- typed hooks `before_prompt_build` and `agent_end` are registered
- prompt injection policy is enabled

### Turn-path verification

A real smoke turn was executed against OpenClaw and confirmed the following path:

- mentorclaw created a plan
- mentorclaw created a thread
- mentorclaw wrote a session binding
- mentorclaw recorded a `turn_processed` event
- mentorclaw recorded an `assistant_reply_recorded` event

The temporary plan generated during that smoke test was removed afterward so the runtime stays clean.

## What Is Still Not Implemented

These are the main gaps:

- no per-user tenant isolation
- no resource-to-plan grounding layer yet
- no structured syllabus / chapter / page / exercise / lesson graph yet
- no connector isolation per tester
- no dedicated review UI or progress UI
- no automatic external reminders over Slack / Feishu / Calendar yet
- no robust evidence parser for uploaded files and tool outputs

So the kernel and adapter are real, but the product is not yet multi-user safe.

## Can mentorclaw Be Tested Now

Yes, but there are two different meanings of "test".

### 1. Kernel and adapter testing

This is ready now.

Use:

```bash
cd /home/jiaxu/mentorclaw-source
npm test
node --experimental-strip-types scripts/validate-runtime.ts
npm run build:plugin
```

You can also verify plugin load state:

```bash
export OPENCLAW_STATE_DIR=/home/jiaxu/.mentorclaw
export OPENCLAW_CONFIG_PATH=/home/jiaxu/.mentorclaw/openclaw.json
/home/jiaxu/.nvm/versions/node/v24.14.0/bin/node \
  /home/jiaxu/.nvm/versions/node/v24.14.0/lib/node_modules/openclaw/dist/index.js \
  plugins inspect mentorclaw-kernel
```

Expected result:

- plugin status is `loaded`
- hooks `before_prompt_build` and `agent_end` are present

### 2. Product testing through real channels

This is partially ready.

You can already send a real DM through Slack or Feishu and exercise the integrated turn path.

What you should verify during a manual test:

- a new learner goal triggers `planning`
- a plan directory is created under `workspace/agent/plans/`
- a thread directory is created under that plan
- `workspace/.openclaw/mentorclaw-session-bindings.json` is updated
- thread `events.jsonl` records both the turn and the assistant reply

However, this is still single-tenant. Multiple external testers on the same runtime will contaminate each other's memory and connectors.

## Recommended Safe Testing Order

1. Run repo-level tests.
2. Run runtime validation.
3. Verify plugin load status.
4. Test with your own Slack or Feishu DM.
5. Only after tenant isolation exists, invite external testers.

## Important Current Limitation

The current runtime is still logically one learner environment:

- one workspace memory space
- one active learner state
- one plan store
- one connector configuration set
- one Google Calendar identity

That means it is fine for internal testing, but not yet good for multi-person pilot testing.
