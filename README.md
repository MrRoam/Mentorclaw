# mentorclaw Source

This repository contains the mentorclaw education kernel. It is intentionally separated from the runtime instance at `/home/jiaxu/.mentorclaw`.

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
- Runtime instance: `/home/jiaxu/.mentorclaw`

The kernel reads and writes the runtime workspace but does not store runtime secrets inside the source repo.

## Useful commands

- `npm test`
- `npm run build:plugin`
- `npm run debug-ui`
- `node --experimental-strip-types scripts/validate-runtime.ts`

Implementation details and test steps live in `docs/IMPLEMENTATION.md`.
