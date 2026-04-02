import type { LearnerSummary, PlanState, ThreadState, TurnInput, WorkflowDecision } from "../schemas/models.ts";

const hasGoalSignal = (message: string): boolean =>
  /(计划|plan|学习|prepare|learn|考试|goal|目标|两周|一个月|三个月|deadline)/i.test(message);

const hasEvaluationSignal = (message: string, submittedWork: boolean): boolean =>
  submittedWork || /(检查|批改|evaluate|评估|test me|测验|我做完了|review my answer)/i.test(message);

const hasReviewSignal = (message: string, requestReview: boolean): boolean =>
  requestReview || /(复盘|总结|review|回顾|总结一下)/i.test(message);

export class WorkflowRouter {
  decide(input: TurnInput, learner: LearnerSummary, plan?: PlanState, thread?: ThreadState): WorkflowDecision {
    if (input.signals?.forceWorkflow) {
      return {
        primary: input.signals.forceWorkflow,
        reasons: ["Workflow forced by caller signal."],
        shouldCreatePlan: input.signals.forceWorkflow === "planning" && !plan,
        shouldCreateThread: !thread,
      };
    }

    if (!plan && hasGoalSignal(input.message)) {
      return {
        primary: "planning",
        reasons: ["No active plan matched while the learner expressed a goal or timeboxed objective."],
        shouldCreatePlan: true,
        shouldCreateThread: true,
      };
    }

    if (hasEvaluationSignal(input.message, Boolean(input.signals?.submittedWork))) {
      return {
        primary: "evaluation",
        secondary: "review",
        reasons: ["The learner provided work or asked for evaluation."],
        shouldCreatePlan: false,
        shouldCreateThread: !thread,
      };
    }

    if (hasReviewSignal(input.message, Boolean(input.signals?.requestReview))) {
      return {
        primary: "review",
        reasons: ["The learner explicitly requested a review or recap."],
        shouldCreatePlan: false,
        shouldCreateThread: !thread,
      };
    }

    const blockedTasks = plan?.tasks.filter((task) => task.status === "blocked").length ?? 0;
    if (/(重排|replan|调整计划|改计划|来不及|delay|拖延)/i.test(input.message) || blockedTasks >= 2 || learner.state.risk_flags.includes("stalled")) {
      return {
        primary: "replanning",
        secondary: "review",
        reasons: ["Plan risk or explicit replanning intent was detected."],
        shouldCreatePlan: false,
        shouldCreateThread: !thread,
      };
    }

    return {
      primary: "tutoring",
      reasons: ["Default to tutoring inside the current plan context."],
      shouldCreatePlan: false,
      shouldCreateThread: !thread,
    };
  }
}
