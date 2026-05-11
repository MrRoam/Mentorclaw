# mentorclaw Source

This repository contains the mentorclaw education kernel. It is intentionally separated from the runtime instance.

## Why this repo exists

The runtime instance already contains:

- workspace state
- logs
- credentials
- device pairings
- OpenClaw channel bindings
- session data

Those are deployment- and user-specific artifacts, not source code. This repo contains the code that operates on that runtime state without bundling local secrets into cloud deploys.

## Project layout

- `src/core/`: orchestration, routing, tasking, memory promotion
- `src/storage/`: runtime workspace read/write adapters
- `src/schemas/`: typed contracts for learner, plan, thread, events, resources
- `src/resources/`: future-ready resource ingestion pipeline interfaces
- `plugin/`: OpenClaw plugin package that injects mentorclaw context into live turns
- `scripts/`: bootstrap and validation scripts for a runtime instance
- `docs/`: implementation notes and testing guides
- `tests/`: kernel-level tests
- `deploy/`: deployment-safe examples that exclude local state

## Runtime boundary

- Source repo: this directory
- Runtime instance: resolved from the local mentorclaw runtime root

By default the resolver checks these locations in order:

- `~/.mentorclaw`
- `~/.openclaw-mentorclaw`
- `~/.openclaw-educlaw`

The kernel reads and writes the runtime workspace but does not store runtime secrets inside the source repo.

## Useful commands

- `npm test`
- `npm run build:plugin`
- `npm run debug-ui`
- `npm run sync:buaa:byxt -- --username 24182104 --password YOUR_PASSWORD`
- `npm run sync:buaa:msa -- --token YOUR_TOKEN --account 24182104 --course-id 12345`
- `node --experimental-strip-types scripts/validate-runtime.ts`

Implementation details and test steps live in `docs/IMPLEMENTATION.md`.
BUAA sync details live in `docs/BUAA_SYNC.md`.
