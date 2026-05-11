import { ProjectResourceService } from "../education/project-resource-service.ts";
import { ResourceLocatorService } from "../education/resource-locator-service.ts";
import { EducationRepo } from "../storage/education-repo.ts";
import type {
  LearningEvent,
  PlanCreationInput,
  ProjectCreationInput,
  ProjectState,
  ResourceRef,
  TurnInput,
  TurnOutcome,
} from "../schemas/models.ts";
import { WorkspaceRepo } from "../storage/workspace-repo.ts";
import { nowIso } from "../utils/time.ts";
import { WorkflowRouter } from "./workflow-router.ts";

const deriveProjectInput = (message: string, courseIds: string[] = []): ProjectCreationInput => {
  const summary = message.trim() || "新的课程项目";
  const title = summary.slice(0, 48) || "new-project";
  const goals = [
    "Clarify the concrete learning target",
    "Pin down the next actionable step",
    "Stay grounded in course materials and current coursework",
  ];

  return {
    title,
    summary,
    targetOutcome: [summary],
    constraints: ["Need learner confirmation for exact scope, deadline, and expected outcome."],
    successDefinition: ["The learner can explain the target and carry out the next concrete action."],
    goals,
    courseIds,
  };
};

const toLegacyPlanInput = (input: ProjectCreationInput): PlanCreationInput => ({
  title: input.title,
  targetOutcome: input.targetOutcome,
  constraints: input.constraints,
  successDefinition: input.successDefinition,
  timebox: "to-be-confirmed",
  goals: input.goals,
  focusTopics: [],
});

const buildProjectContext = (
  project: ProjectState | undefined,
  attachments: ResourceRef[],
): string[] => {
  if (!project) {
    return attachments.length
      ? [`This turn includes ${attachments.length} explicit attachment(s) from the caller.`]
      : [];
  }

  const facts = [
    `Current project: ${project.title}.`,
    `Project scope: ${project.scope.type === "course" ? `course-bound (${project.scope.courseIds.join(", ") || "course id pending"})` : "general course support"}.`,
    project.goal.summary ? `Current goal: ${project.goal.summary}.` : "",
    project.execution.nextAction ? `Next action: ${project.execution.nextAction}.` : "",
  ].filter(Boolean);

  if (attachments.length) {
    facts.push(`This turn also includes ${attachments.length} attachment(s) provided by the caller.`);
  }
  return facts;
};

export class mentorclawOrchestrator {
  private readonly repo: WorkspaceRepo;
  private readonly workflowRouter: WorkflowRouter;
  private readonly projectResourceService: ProjectResourceService;
  private readonly resourceLocatorService: ResourceLocatorService;

  constructor(repo: WorkspaceRepo) {
    this.repo = repo;
    this.workflowRouter = new WorkflowRouter();
    const educationRepo = new EducationRepo(repo.paths.runtimeRoot);
    this.projectResourceService = new ProjectResourceService(educationRepo);
    this.resourceLocatorService = new ResourceLocatorService(educationRepo);
  }

  async handleTurn(input: TurnInput): Promise<TurnOutcome> {
    const now = input.now ?? nowIso();
    const learner = await this.repo.readLearnerSummary();
    const projectId = input.projectId ?? input.planId ?? null;
    let project = projectId ? await this.repo.readProjectState(projectId) : undefined;
    const legacyPlan = project ? await this.repo.readPlanState(project.projectId) : undefined;

    const decision = this.workflowRouter.decide(input, learner, legacyPlan);

    if (!project && decision.shouldCreateProject) {
      const creationInput = deriveProjectInput(input.message, input.courseIds ?? []);
      project = await this.repo.createProject(creationInput, now);
      learner.state.active_plan_ids = Array.from(new Set([...learner.state.active_plan_ids, project.projectId]));
      learner.state.active_plan_count = learner.state.active_plan_ids.length;
      learner.state.current_focus = project.title;
      learner.state.updated_at = now;
      await this.repo.writeLearnerState(learner.state);
    }

    if (project) {
      project.updatedAt = now;
      project.execution.mode = decision.primary;

      if (!project.execution.nextAction) {
        project.execution.nextAction = project.execution.tasks.find((task) => task.status !== "done")?.title ?? null;
      }

      if (decision.primary === "review") {
        project.summary = `${project.summary}\nReview requested on ${now.slice(0, 10)}.`.trim();
      } else if (decision.primary === "planning") {
        project.summary = `${project.summary}\nProject clarified through a planning turn.`.trim();
      }

      await this.repo.writeProjectState(project);
    }

    const projectCourseContext = project
      ? await this.projectResourceService.buildContext(project, input.message)
      : {
          summaryLines: [],
          readSet: [],
        };
    const locatorContext = project
      ? await this.resourceLocatorService.locate(project, input.message)
      : {
          matches: [],
          summaryLines: [],
          readSet: [],
        };

    const events: LearningEvent[] = [
      {
        ts: now,
        level: project ? "project" : "learner",
        type: "turn_processed",
        projectId: project?.projectId,
        planId: project?.projectId,
        evidence: [input.message],
        impact: `Workflow ${decision.primary} selected.`,
        promotion: project ? "project" : "memory",
        metadata: { reasons: decision.reasons },
      },
    ];

    if (project) {
      await this.repo.appendProjectEvent(project.projectId, events[0]);
      if (input.threadId) {
        await this.repo.appendThreadEvent(project.projectId, input.threadId, {
          ...events[0],
          level: "thread",
          threadId: input.threadId,
          promotion: "thread",
        });
      }
    } else {
      await this.repo.appendLearnerEvent({ ...events[0], level: "learner", promotion: "learner" });
    }

    return {
      decision,
      context: {
        bootstrap: await this.repo.readBootstrap(),
        memorySummary: learner.memory
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 5),
        projectSummary: buildProjectContext(project, input.attachments ?? []),
        resourceSummary: projectCourseContext.summaryLines,
        locatorSummary: locatorContext.summaryLines,
        locators: locatorContext.matches,
        readSet: [
          "workspace/AGENTS.md",
          "workspace/SOUL.md",
          "workspace/TOOLS.md",
          "workspace/MEMORY.md",
          ...(project ? [`workspace/projects/${project.projectId}.yaml`] : []),
          ...projectCourseContext.readSet,
          ...locatorContext.readSet,
        ],
      },
      learner,
      project,
      plan: project ? await this.repo.readPlanState(project.projectId) : undefined,
      proactiveActions: [],
      events,
    };
  }
}

export const deriveLegacyPlanInput = (message: string): PlanCreationInput => toLegacyPlanInput(deriveProjectInput(message));
