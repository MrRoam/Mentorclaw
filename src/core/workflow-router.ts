import type { LearnerSummary, PlanState, TurnInput, WorkflowDecision } from "../schemas/models.ts";

const hasProjectSetupSignal = (message: string): boolean =>
  /(计划|project|课程项目|复习项目|帮我建|创建项目|自学项目|prepare|goal|目标|deadline|ddl)/i.test(message);

const hasReviewSignal = (message: string, submittedWork: boolean, requestReview: boolean): boolean =>
  submittedWork || requestReview || /(检查|批改|评估|review|总结|回顾|我做完了|作业给你看)/i.test(message);

export class WorkflowRouter {
  decide(input: TurnInput, learner: LearnerSummary, plan?: PlanState): WorkflowDecision {
    if (input.signals?.forceWorkflow) {
      return {
        primary: input.signals.forceWorkflow,
        reasons: ["Workflow forced by caller signal."],
        shouldCreateProject: input.signals.forceWorkflow === "planning" && !plan,
        shouldCreatePlan: input.signals.forceWorkflow === "planning" && !plan,
        shouldCreateThread: false,
      };
    }

    if (!plan && hasProjectSetupSignal(input.message)) {
      return {
        primary: "planning",
        reasons: ["The learner described a new course-related goal and no active project is bound yet."],
        shouldCreateProject: true,
        shouldCreatePlan: true,
        shouldCreateThread: false,
      };
    }

    if (hasReviewSignal(input.message, Boolean(input.signals?.submittedWork), Boolean(input.signals?.requestReview))) {
      return {
        primary: "review",
        reasons: ["The learner submitted work or explicitly asked for review, recap, or evaluation."],
        shouldCreateProject: false,
        shouldCreatePlan: false,
        shouldCreateThread: false,
      };
    }

    if (learner.state.current_focus && !plan && hasProjectSetupSignal(learner.state.current_focus)) {
      return {
        primary: "planning",
        reasons: ["The learner has a stored focus but no currently bound project."],
        shouldCreateProject: true,
        shouldCreatePlan: true,
        shouldCreateThread: false,
      };
    }

    return {
      primary: "tutoring",
      reasons: ["Default to tutoring inside the current project or course context."],
      shouldCreateProject: false,
      shouldCreatePlan: false,
      shouldCreateThread: false,
    };
  }
}
