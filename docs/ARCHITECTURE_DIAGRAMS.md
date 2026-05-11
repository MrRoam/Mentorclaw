# mentorclaw Architecture Diagrams

> Generated: 2026-04-14

## 1. System Architecture Overview

```mermaid
flowchart TB
    subgraph Runtime["OpenClaw Runtime Instance (~/.mentorclaw)"]
        subgraph Workspace["workspace/"]
            AG[("AGENTS.md")]
            SO[("SOUL.md")]
            TO[("TOOLS.md")]
            ME[("MEMORY.md")]
            PP["projects/{id}.yaml"]
            EV["*.events.jsonl"]
            SB[(".openclaw/mentorclaw-session-bindings.json")]
        end
        subgraph State["state/education/"]
            CO["courses.json"]
            CI["course-items.json"]
            CR["course-resources.json"]
            CN["connections.json"]
        end
    end

    subgraph Kernel["mentorclaw Kernel (src/)"]
        OR["Orchestrator\nhandleTurn()"]
        WR["WorkflowRouter\ndecide()"]
        PE["ProjectResourceService\nbuildContext()"]
        LO["ResourceLocatorService\nlocate()"]
    end

    subgraph Plugin["plugin/mentorclaw-kernel"]
        BH["before_prompt_build hook\npriority 25"]
        AE["agent_end hook\npriority 25"]
    end

    BH --> OR
    AE --> OR
    OR <--> WR
    OR <--> PE
    OR <--> LO

    WR -->|planning / tutoring / review| OR

    Runtime -->|read/write| Workspace
    Runtime -->|read| State

    style Kernel fill:#e6f3ff,stroke:#0066cc
    style Plugin fill:#fff2e6,stroke:#cc6600
    style Runtime fill:#f0f0f0,stroke:#666666
```

## 2. Turn Processing Flow

```mermaid
sequenceDiagram
    participant U as User Message
    participant OC as OpenClaw
    participant PL as Plugin Hooks
    participant OR as Orchestrator
    participant WR as WorkflowRouter
    participant WS as WorkspaceRepo
    participant ED as EducationRepo
    participant PR as ProjectResourceSvc
    participant RL as ResourceLocatorSvc

    U->>OC: Turn message
    OC->>PL: before_prompt_build(sessionKey, workspaceDir)
    PL->>OR: handleTurn(TurnInput)

    OR->>WS: readLearnerSummary()
    OR->>WR: decide(input, learner, plan)

    alt No project + planning signal
        OR->>WS: createProject() → project
        OR->>WS: writeLearnerState() → update active plans
    end

    OR->>PR: buildContext(project, message)
    OR->>RL: locate(project, message)

    OR->>WS: readBootstrap() → AGENTS/SOUL/TOOLS
    OR->>WS: appendProjectEvent() → EVENTS.jsonl

    OR-->>PL: TurnOutcome with ContextPacket

    PL-->>OC: Modified prompt context

    OC->>OC: Model generates response

    OC->>PL: agent_end(sessionKey, reply)
    PL->>WS: recordAgentEnd() → update bindings
```

## 3. Core Module Architecture

```mermaid
flowchart LR
    subgraph Core["src/core/"]
        OR["orchestrator.ts\nCentral turn handler"]
        WR["workflow-router.ts\nRoutes to planning/tutoring/review"]
        TE["task-engine.ts\nTask generation & rebalancing"]
        PM["plan-manager.ts\nPlan lifecycle"]
        TM["thread-manager.ts\nThread management"]
        CB["context-builder.ts\nPrompt context packets"]
        MU["memory-updater.ts\nEvent-first memory promotion"]
    end

    subgraph Storage["src/storage/"]
        WS["workspace-repo.ts\nLearner/Plan/Thread/Project state"]
        ED["education-repo.ts\nCourse/Item/Resource data"]
    end

    subgraph Education["src/education/"]
        PR["project-resource-service.ts\nResource binding"]
        RL["resource-locator-service.ts\nTimestamp/page locator"]
        RI["resource-indexer.ts\nCourse resource index"]
        RK["replay-knowledge-service.ts\nVideo replay indexing"]
        IM["importer.ts\nEducation doc import"]
    end

    subgraph Integration["src/integration/"]
        OA["openclaw-adapter.ts\nSession binding store"]
        OB["openclaw-turn-bridge.ts\nCLI subprocess bridge"]
    end

    WR --> OR
    TE --> OR
    PM --> OR
    TM --> OR
    CB --> OR
    MU --> OR

    WS --> OR
    ED --> PR
    ED --> RL
    ED --> RI
    ED --> RK

    OR <--> OA
    OR <--> OB

    style Core fill:#e6f3ff,stroke:#0066cc
    style Storage fill:#f0fff0,stroke:#228b22
    style Education fill:#fff0f5,stroke:#9932cc
    style Integration fill:#fff8dc,stroke:#daa520
```

## 4. Storage Layer Architecture

```mermaid
flowchart TB
    subgraph WorkspaceRepo["WorkspaceRepo"]
        direction TB
        A1["readBootstrap()\nAGENTS.md, SOUL.md, TOOLS.md"]
        A2["readGlobalMemory() / writeGlobalMemory()\nMEMORY.md"]
        A3["readLearnerSummary() / writeLearnerState()\nLEARNER_STATE.yaml"]
        A4["createProject() / readProjectState() / writeProjectState()\nprojects/{id}.yaml"]
        A5["createPlan() / readPlanState() / writePlanState()\nagent/plans/{id}/"]
        A6["createThread() / readThreadState() / writeThreadState()\nagent/plans/{id}/threads/{id}/"]
        A7["appendProjectEvent()\n*.events.jsonl"]
        A8["appendLearnerEvent()\nagent/learner/EVENTS.jsonl"]
    end

    subgraph EducationRepo["EducationRepo"]
        direction TB
        B1["readConnections()\nconnections.json"]
        B2["readCourses() / writeCourses()\ncourses.json"]
        B3["readCourseItems() / writeCourseItems()\ncourse-items.json"]
        B4["readCourseResources() / writeCourseResources()\ncourse-resources.json"]
        B5["readSchedulePreferences()\nschedule-preferences.json"]
    end

    subgraph DataStore["Runtime Filesystem"]
        direction TB
        WS["workspace/\nAGENTS.md, SOUL.md, TOOLS.md\nMEMORY.md\nprojects/, agent/\n.openclaw/"]
        ED["state/education/\ncourses.json\ncourse-items.json\ncourse-resources.json\nconnections.json"]
    end

    WorkspaceRepo --> DataStore
    EducationRepo --> DataStore

    style WorkspaceRepo fill:#e6f3ff,stroke:#0066cc
    style EducationRepo fill:#fff0f5,stroke:#9932cc
    style DataStore fill:#f0f0f0,stroke:#666666
```

## 5. Workflow Routing Decision

```mermaid
flowchart TD
    START["TurnInput received"] --> READ{"Existing\nproject/plan?"}
    READ -->|Yes| EVAL{"Signals\npresent?"}
    READ -->|No| NEW{"Message contains\nplanning keywords?"}
    NEW -->|Yes| P["decision.primary = 'planning'\nshouldCreateProject = true"]
    NEW -->|No| T["decision.primary = 'tutoring'"]
    EVAL -->|submittedWork| R["decision.primary = 'review'"]
    EVAL -->|requestReview| R2["decision.primary = 'review'"]
    EVAL -->|forceWorkflow| FW["decision.primary = forceWorkflow"]
    EVAL -->|None| CK{"Content check\nresult?"}
    CK -->|Homework submit| R3["decision.primary = 'review'"]
    CK -->|Goal clarification| P2["decision.primary = 'planning'"]
    CK -->|Default| T2["decision.primary = 'tutoring'"]

    P --> OUT["TurnOutcome with\nContextPacket"]
    T --> OUT
    R --> OUT
    R2 --> OUT
    R3 --> OUT
    P2 --> OUT
    T2 --> OUT
    FW --> OUT

    style P fill:#90EE90
    style T fill:#ADD8E6
    style R fill:#FFB6C1
    style OUT fill:#FFE4B5
```

## 6. Education Services Architecture

```mermaid
flowchart TB
    subgraph BUAA["BUAA Providers (src/education/providers/buaa/)"]
        BY["byxt.ts\nTimetable sync"]
        MS["msa.ts\nMSA replay & asset sync"]
        SH["shared.ts\nShared utilities"]
    end

    subgraph Services["Education Services"]
        IM["importer.ts\nImport JSON/Docx"]
        PR["project-resource-service.ts\nTokenize & score resources"]
        RL["resource-locator-service.ts\nLocate by timestamp/page"]
        RI["resource-indexer.ts\nIndex local resources"]
        RK["replay-knowledge-service.ts\nVideo knowledge extraction"]
        SY["sync.ts\nSync orchestration"]
        Q["query.ts\nQuery interface"]
    end

    subgraph Repo["EducationRepo"]
        CR["courses.json"]
        CI["course-items.json"]
        CS["course-resources.json"]
        CN["connections.json"]
    end

    BY --> SY
    MS --> SY
    IM --> Repo
    PR --> Repo
    RL --> Repo
    RI --> Repo
    RK --> Repo
    SY --> Repo

    style BUAA fill:#fff0f5,stroke:#cc0066
    style Services fill:#fff8dc,stroke:#cc6600
    style Repo fill:#f0fff0,stroke:#228b22
```

## 7. OpenClaw Plugin Integration

```mermaid
flowchart LR
    subgraph OpenClaw["OpenClaw Runtime"]
        BP["before_prompt_build\nlifecycle hook"]
        AE["agent_end\nlifecycle hook"]
    end

    subgraph Plugin["plugin/mentorclaw-kernel"]
        P25["Priority 25"]
        P25 -->|"Inject mentorclaw context"| INJ["renderPromptContext()"]
        P25 -->|"Record agent reply"| REC["recordAgentEnd()"]
    end

    subgraph Bindings["SessionBindingStore"]
        SB["mentorclaw-session-bindings.json"]
        SessionKey["sessionKey"]
        ProjectId["projectId"]
        PlanId["planId"]
        ThreadId["threadId"]
    end

    INJ -->|read| SB
    REC -->|update| SB

    BP --> P25
    AE --> P25

    style OpenClaw fill:#f0f0f0,stroke:#666666
    style Plugin fill:#fff2e6,stroke:#cc6600
    style Bindings fill:#e6f3ff,stroke:#0066cc
```

## 8. Data Flow Summary

```mermaid
flowchart LR
    subgraph Input
        MSG["User Message"]
        ATT["Attachments"]
        CID["Course IDs"]
        SIG["Signals"]
    end

    subgraph Processing
        OR["Orchestrator\nhandleTurn()"]
        WR["WorkflowRouter\ndecide()"]
        PE["ProjectResourceSvc\nbuildContext()"]
        LO["ResourceLocatorSvc\nlocate()"]
    end

    subgraph Output
        CTX["ContextPacket\nbootstrap + summaries + readSet"]
        DEC["WorkflowDecision"]
        LRN["LearnerSummary"]
        PRJ["ProjectState"]
        EVT["LearningEvent[]"]
    end

    subgraph Persistence
        WS["WorkspaceRepo"]
        ER["EducationRepo"]
    end

    Input --> OR
    OR --> WR
    OR --> PE
    OR --> LO

    PE --> CTX
    LO --> CTX

    OR --> WS
    OR --> ER

    CTX --> Output
    DEC --> Output
    LRN --> Output
    PRJ --> Output
    EVT --> WS

    style Input fill:#FFE4B5
    style Processing fill:#ADD8E6
    style Output fill:#90EE90
    style Persistence fill:#D3D3D3
```

---

*Generated with Mermaid. Compatible with GitHub, Obsidian, and most markdown renderers.*