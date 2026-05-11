# mentorclaw Architecture Diagrams (ASCII)

> Generated: 2026-04-14

## 1. System Architecture Overview

```
+------------------------------------------------------------------+
|                    OpenClaw Runtime Instance                     |
|                      (~/.mentorclaw / ~/.openclaw-*)             |
+------------------------------------------------------------------+
|                                                                  |
|  +----------------------------+   +-----------------------------+ |
|  |      workspace/            |   |      state/education/      | |
|  |                            |   |                             | |
|  |  AGENTS.md                 |   |  courses.json              | |
|  |  SOUL.md                   |   |  course-items.json         | |
|  |  TOOLS.md                  |   |  course-resources.json     | |
|  |  MEMORY.md                 |   |  connections.json          | |
|  |  projects/{id}.yaml        |   |  schedule-preferences.json| |
|  |  *.events.jsonl            |   +-----------------------------+ |
|  |  agent/plans/{id}/          |                                  |
|  |  agent/learner/            |                                  |
|  |  .openclaw/                 |                                  |
|  +----------------------------+                                   |
+------------------------------------------------------------------+
                              ^
            +-----------------+-----------------+
            |                                   |
            v                                   v
+---------------------------+       +---------------------------+
|     mentorclaw Kernel     |       |   plugin/mentorclaw-     |
|        (src/)             |       |        kernel             |
|                           |       |                           |
|  +--------------------+   |       |  +---------------------+  |
|  |   Orchestrator     |   |       |  | before_prompt_build |  |
|  |  handleTurn()      |<--|------>|  | (priority 25)       |  |
|  +--------------------+   |       |  +---------------------+  |
|  | WorkflowRouter     |   |       |  | agent_end           |  |
|  | decide()           |   |       |  | (priority 25)       |  |
|  +--------------------+   |       |  +---------------------+  |
|  | ProjectResourceSvc |   |       +---------------------------+
|  | buildContext()     |   |       |                           |
|  +--------------------+   |       |                           |
|  | ResourceLocatorSvc |   |       |                           |
|  | locate()           |   |       |                           |
|  +--------------------+   |       |                           |
+---------------------------+       |                           |
                                    |                           |
                                    +---------------------------+
```

## 2. Turn Processing Sequence

```
User Message
      |
      v
OpenClaw Runtime
      |
      v
Plugin Hook: before_prompt_build(sessionKey, workspaceDir)
      |
      v
mentorclawOrchestrator.handleTurn(TurnInput)
      |
      +---> WorkspaceRepo.readLearnerSummary()
      |
      +---> WorkflowRouter.decide(input, learner, plan)
      |           |
      |           +-- [planning] --> shouldCreateProject = true
      |           +-- [tutoring]  --> default routing
      |           +-- [review]    --> submittedWork signal
      |
      +--- (if shouldCreateProject)
      |     +---> WorkspaceRepo.createProject()
      |     +---> WorkspaceRepo.writeLearnerState()
      |
      +---> ProjectResourceService.buildContext(project, message)
      |           |
      |           +-- Tokenize message (English + Chinese n-grams)
      |           +-- Score courses, items, resources
      |           +-- Return relevant context
      |
      +---> ResourceLocatorService.locate(project, message)
      |           |
      |           +-- Locate by timestamp (video) or page (docs)
      |           +-- Return snippets with scores
      |
      +---> WorkspaceRepo.readBootstrap() --> AGENTS.md, SOUL.md, TOOLS.md
      |
      +---> WorkspaceRepo.appendProjectEvent() --> *.events.jsonl
      |
      v
TurnOutcome {
  decision: WorkflowDecision,
  context: ContextPacket {
    bootstrap: { agents, soul, tools },
    memorySummary: [...],
    projectSummary: [...],
    resourceSummary: [...],
    locatorSummary: [...],
    locators: [...],
    readSet: ["workspace/AGENTS.md", ...]
  },
  learner: LearnerSummary,
  project: ProjectState,
  events: [LearningEvent]
}
      |
      v
Plugin returns modified prompt context to OpenClaw
      |
      v
Model generates response
      |
      v
Plugin Hook: agent_end(sessionKey, reply)
      |
      v
recordAgentEnd() --> update session bindings
```

## 3. Core Module Architecture

```
src/
|
+-- core/
|   +-- orchestrator.ts        [Central turn handler]
|   |       |                  handleTurn(TurnInput) -> TurnOutcome
|   |       |
|   |       +-- workflow-router.ts  [Routes to planning/tutoring/review]
|   |       +-- task-engine.ts      [Task generation & rebalancing]
|   |       +-- plan-manager.ts     [Plan lifecycle management]
|   |       +-- thread-manager.ts   [Thread management]
|   |       +-- context-builder.ts  [Prompt context packets]
|   |       +-- memory-updater.ts    [Event-first memory promotion]
|   |
+-- storage/
|   +-- workspace-repo.ts      [Learner/Plan/Thread/Project state]
|   |       |
|   |       +-- readBootstrap()           -> { agents, soul, tools }
|   |       +-- readGlobalMemory()         -> GlobalMemory
|   |       +-- readLearnerSummary()       -> LearnerSummary
|   |       +-- createProject()            -> ProjectState
|   |       +-- readProjectState()         -> ProjectState
|   |       +-- createPlan()               -> PlanState
|   |       +-- createThread()            -> ThreadState
|   |       +-- appendProjectEvent()      -> *.events.jsonl
|   |
|   +-- education-repo.ts      [Course/Item/Resource data]
|           |
|           +-- readConnections()     -> connections.json
|           +-- readCourses()         -> courses.json
|           +-- readCourseItems()     -> course-items.json
|           +-- readCourseResources()  -> course-resources.json
|
+-- education/
|   +-- project-resource-service.ts  [Tokenize & bind resources]
|   +-- resource-locator-service.ts   [Locate by timestamp/page]
|   +-- resource-indexer.ts           [Index local resources]
|   +-- replay-knowledge-service.ts   [Video knowledge extraction]
|   +-- importer.ts                   [Education doc import]
|   +-- sync.ts                       [Sync orchestration]
|   +-- query.ts                      [Query interface]
|   +-- providers/buaa/
|       +-- byxt.ts          [Timetable sync]
|       +-- msa.ts          [MSA replay & asset]
|       +-- shared.ts       [Shared utilities]
|
+-- integration/
|   +-- openclaw-adapter.ts    [Session binding store]
|   +-- openclaw-turn-bridge.ts [CLI subprocess bridge]
|
+-- schemas/
|   +-- models.ts        [Core types: TurnInput, TurnOutcome, ProjectState...]
|   +-- education.ts     [Education types: CourseRecord, CourseItemRecord...]
|
+-- resources/
|   +-- pipeline.ts     [Resource ingestion interfaces]
|
+-- debug-ui/
|   +-- service.ts       [Local browser-based debug UI]
|
+-- utils/
    +-- id.ts            [ID generation]
    +-- time.ts          [Time formatting]
    +-- simple-yaml.ts   [YAML parsing/stringifying]
    +-- runtime-root.ts  [Runtime root resolution]
```

## 4. Storage Layer Architecture

```
WorkspaceRepo (workspace-repo.ts)
|
+-- paths.runtimeRoot
|       |
|       +-- workspace/              [WorkspaceRepo.paths.workspaceRoot]
|       |       |
|       |       +-- AGENTS.md, SOUL.md, TOOLS.md    [Bootstrap files]
|       |       +-- MEMORY.md                        [Global memory]
|       |       +-- projects/                        [Project states]
|       |       |       +-- {projectId}.yaml
|       |       |       +-- {projectId}.events.jsonl
|       |       +-- agent/
|       |       |       +-- plans/                  [Plan states]
|       |       |       |       +-- {planId}/
|       |       |       |       |   +-- PLAN.md, GOALS.md, TASKS.yaml
|       |       |       |       |   +-- MILESTONES.yaml, PROGRESS.yaml
|       |       |       |       |   +-- SUMMARY.md, RESOURCES.md
|       |       |       |       |   +-- threads/
|       |       |       |       |       +-- {threadId}/
|       |       |       |       |           +-- meta.json
|       |       |       |       |           +-- summary.md
|       |       |       |       |           +-- working_memory.md
|       |       |       |       |           +-- events.jsonl
|       |       |       +-- learner/
|       |       |               +-- LEARNER_STATE.yaml
|       |       |               +-- PROFILE.md, PREFERENCES.md
|       |       |               +-- GLOBAL_GOALS.md, GLOBAL_MISCONCEPTIONS.yaml
|       |       |               +-- EVENTS.jsonl
|       |       +-- crons/                       [Scheduled tasks]
|       |       +-- .openclaw/                   [OpenClaw bindings]
|       |               +-- mentorclaw-session-bindings.json
|
EducationRepo (education-repo.ts)
|
+-- state/education/                 [Relative to runtimeRoot]
        |
        +-- connections.json          [External service connections]
        +-- courses.json              [Course metadata]
        +-- course-items.json         [Class sessions, exams, assignments]
        +-- course-resources.json      [PPTs, PDFs, subtitles, videos]
        +-- schedule-preferences.json  [UI preferences]
```

## 5. Workflow Routing Decision Tree

```
TurnInput received
        |
        v
+------------------+
| Existing project |----------------------------+
| or plan?         |                            |
+------------------+                            |
        |                                      |
   [YES]                                   [NO]
        |                                      |
        v                                      v
+------------------+                  +------------------------+
| Signals present? |                  | Message has planning   |
| (submittedWork,   |                  | keywords? (我要学,     |
|  requestReview,   |                  |  想了解, 开始...)      |
|  forceWorkflow)   |                  +------------------------+
+------------------+                  [YES]           [NO]
        |                                      |        |
   [YES]                                   [YES]     [NO]
        |                                      |        |
        v                                      v        v
+------------------+                 +-------+    +--------+
| Which signal?   |                 |PLANNING     |TUTORING|
+------------------+                 |shouldCreate |default |
        |                           |Project=true |        |
   +----+----+                      +-------+      +--------+
   |         |
submittedWork/requestReview
   |         |
   v         v
+--------+  +--------+
| REVIEW |  |FORCEWF  |
+--------+  +--------+
```

## 6. Education Services Architecture

```
EducationRepo
      |
      +-- connections.json   [BUAA credentials, tokens]
      +-- courses.json       [Course metadata: id, title, semester...]
      +-- course-items.json  [Class sessions, exams, assignments, replays]
      +-- course-resources.json [PPTs, PDFs, subtitles, videos, timestamps]
      +-- schedule-preferences.json

Education Services
      |
      +-- ProjectResourceService
      |       +-- tokenizeMessage(message) -> tokens[]
      |       +-- detectQueryIntent(message) -> ProjectQueryNeed
      |       +-- buildContext(project, message) -> ProjectCourseContext
      |           |
      |           +-- Score courses by token overlap
      |           +-- Score course-items by type match (homework/lecture/exam)
      |           +-- Score resources by relevance
      |           +-- Return: courses, relevantItems, relevantResources
      |
      +-- ResourceLocatorService
      |       +-- locate(project, message) -> ResourceLocatorMatch[]
      |           |
      |           +-- For video: extract timestamp patterns
      |           +-- For documents: extract page numbers
      |           +-- Return: matches with snippets and scores
      |
      +-- ResourceIndexer
      |       +-- indexResources(resources) -> index
      |       +-- search(query) -> ResourceRef[]
      |
      +-- ReplayKnowledgeService
              +-- extractKnowledge(replayId) -> knowledgeItems
              +-- search(query) -> knowledgeItems

BUAA Providers (providers/buaa/)
      |
      +-- byxt.ts [BYXT Timetable Sync]
      |       +-- fetchTimetable(token, account) -> CourseItemRecord[]
      |       +-- syncToEducationRepo(items) -> void
      |
      +-- msa.ts [MSA Replay & Asset Sync]
      |       +-- fetchAssetList(token, account, courseId) -> ResourceRecord[]
      |       +-- downloadAsset(resourceId) -> localPath
      |       +-- syncSubtitles(replayId) -> CourseResourceRecord
      |
      +-- shared.ts [Shared utilities]
              +-- parseTimeString(str) -> Date
              +-- normalizeCourseName(name) -> string
```

## 7. OpenClaw Plugin Integration

```
plugin/mentorclaw-kernel/
|
+-- index.ts (Plugin entry)
|       |
|       +-- registerBeforePromptBuild(priority=25)
|       |       |
|       |       +-- resolveRuntimeRoot(workspaceDir)
|       |       +-- orchestrator.handleTurn(TurnInput)
|       |       +-- renderPromptContext(TurnOutcome)
|       |       +-- return ModifiedPromptContext
|       |
|       +-- registerAgentEnd(priority=25)
|               |
|               +-- parseAgentReply(reply)
|               +-- sessionBindingStore.get(sessionKey)
|               +-- sessionBindingStore.set(binding)
|
+-- openclaw.plugin.json
        |
        +-- name: "mentorclaw-kernel"
        +-- hooks:
        |       +-- before_prompt_build: { src: "index.ts", priority: 25 }
        |       +-- agent_end: { src: "index.ts", priority: 25 }
        +-- fileDependencies: [...]

SessionBindingStore
|
+-- File: workspace/.openclaw/mentorclaw-session-bindings.json
|
+-- Structure:
|   {
|     "version": 2,
|     "bindings": {
|       "session-key-123": {
|         "sessionKey": "session-key-123",
|         "projectId": "project-abc",
|         "planId": "plan-abc",
|         "threadId": "thread-123",
|         "updatedAt": "2026-04-14T...",
|         "lastWorkflow": "tutoring",
|         "pendingSignals": {...}
|       }
|     }
|   }
```

## 8. ContextPacket Structure

```
TurnOutcome.context: ContextPacket
|
+-- bootstrap: { agents, soul, tools }
|       |       Read from workspace/AGENTS.md, SOUL.md, TOOLS.md
|       |
|       +-- agents: string    [Agent definitions]
|       +-- soul: string      [Core principles]
|       +-- tools: string    [Available tools]
|
+-- memorySummary: string[]  [Top 5 lines from MEMORY.md]
|
+-- projectSummary: string[] [Current project context]
|       |       - "Current project: {title}"
|       |       - "Project scope: course-bound ({courseIds})"
|       |       - "Current goal: {goal.summary}"
|       |       - "Next action: {nextAction}"
|
+-- resourceSummary: string[] [Relevant resources summary]
|       |       Generated by ProjectResourceService
|       |
|       +-- Lines like: "Relevant course: 计算机网络 (4 items, 2 resources)"
|
+-- locatorSummary: string[] [Resource locator summary]
|       |       Generated by ResourceLocatorService
|       |
|       +-- Lines like: "Video at 00:15:30 - '网络协议分层'"
|
+-- locators: ResourceLocatorMatch[]
|       |       Timestamp/page based matches
|       |
|       +-- [{
|       |     resourceId: "...",
|       |     timestamp: "00:15:30" | null,
|       |     page: number | null,
|       |     snippet: "...",
|       |     relevanceScore: 0.85
|       |   }]
|
+-- readSet: string[]
        |       Files the model should read
        |
        +-- [
        |     "workspace/AGENTS.md",
        |     "workspace/SOUL.md",
        |     "workspace/TOOLS.md",
        |     "workspace/MEMORY.md",
        |     "workspace/projects/{projectId}.yaml",
        |     "...education resources..."
        |   ]
```

---

*Generated: 2026-04-14*
*Use Mermaid Preview in VSCode / Obsidian, or paste to any Mermaid-compatible renderer*