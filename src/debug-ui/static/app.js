const app = document.getElementById("app");
const STORAGE_PREFIX = "mentorclaw.stitch";
const DEFAULT_VISIBLE_PROJECT_SESSIONS = 5;

const state = {
  snapshot: null,
  loading: false,
  loadingFilePath: "",
  activeView: readStored("activeView") || "dashboard",
  selectedPlanId: readStored("selectedPlanId"),
  selectedThreadId: readStored("selectedThreadId"),
  selectedCronId: readStored("selectedCronId"),
  sessionKey: readStored("sessionKey"),
  activeFilePath: readStored("activeFilePath"),
  objectSearch: readStored("objectSearch"),
  selectedConfigId: readStored("selectedConfigId") || "soul",
  scheduleViewMode: readStored("scheduleViewMode") || "",
  scheduleCursorDate: readStored("scheduleCursorDate") || "",
  language: readStored("language") || "zh",
  forceWorkflow: readStored("forceWorkflow") || "auto",
  flash: null,
  fileCache: {},
  showCreateThread: false,
  showResourceComposer: false,
  showCronComposer: false,
  showDashboardSummary: false,
  showDashboardCron: false,
  editingDashboardCronId: "",
  showScheduleComposer: false,
  selectedScheduleItemId: "",
  scheduleActionMenuLeft: 16,
  scheduleActionMenuTop: 16,
  editingScheduleItemId: "",
  showBuaaLogin: false,
  buaaLoginDismissed: false,
  buaaLoginIntent: "account",
  submittingBuaaLogin: false,
  pendingBuaaCourseId: "",
  resourceSyncingCourseId: "",
  uploadingResource: false,
  leftSidebarCollapsed: readFlag("leftSidebarCollapsed"),
  collapsedPanels: readCollapsedPanels(),
  submittingTurn: false,
  submittingCronForm: false,
  runningCronId: "",
  sendingCronMessage: false,
  savingConfig: false,
  pendingTurnMessage: "",
  cronPreview: null,
  drafts: {
    planTitle: "",
    planCourseId: "",
    threadTitle: "",
    threadQuestion: "",
    userMessage: "",
    assistantMessage: "",
    resourceSourceMode: "platform",
    resourceTitle: "",
    resourcePath: "",
    resourceUrl: "",
    resourceCourseId: "",
    resourceItemId: "",
    resourceType: "",
    cronTitle: "",
    cronSchedule: "",
    cronPrompt: "",
    quickCourseId: "",
    quickItemId: "",
    quickCronTitle: "",
    quickCronSchedule: "",
    quickCronPrompt: "",
    cronMessage: "",
    scheduleTitle: "",
    scheduleDate: "",
    scheduleStartTime: "19:00",
    scheduleEndTime: "20:00",
    scheduleLocation: "",
    scheduleNote: "",
    buaaUsername: "",
    buaaPassword: "",
    buaaMsaCourseIds: "",
  },
};

function readCollapsedPanels() {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}.collapsedPanels`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCollapsedPanels() {
  localStorage.setItem(`${STORAGE_PREFIX}.collapsedPanels`, JSON.stringify(state.collapsedPanels));
}

function projectSessionsCollapsed(planId) {
  return Boolean(state.collapsedPanels[`project-sessions:${planId}`]);
}

function setProjectSessionsCollapsed(planId, collapsed) {
  if (!planId) return;
  state.collapsedPanels[`project-sessions:${planId}`] = collapsed;
  writeCollapsedPanels();
}

function projectExtraSessionsExpanded(planId) {
  return Boolean(state.collapsedPanels[`project-extra-sessions:${planId}`]);
}

function setProjectExtraSessionsExpanded(planId, expanded) {
  if (!planId) return;
  state.collapsedPanels[`project-extra-sessions:${planId}`] = expanded;
  writeCollapsedPanels();
}

function readFlag(key) {
  return readStored(key) === "true";
}

function readStored(key) {
  return localStorage.getItem(`${STORAGE_PREFIX}.${key}`) || "";
}

function writeStored(key, value) {
  localStorage.setItem(`${STORAGE_PREFIX}.${key}`, String(value ?? ""));
}

function resetCronDraft() {
  state.drafts.cronTitle = "";
  state.drafts.cronSchedule = "";
  state.drafts.cronPrompt = "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function compactText(value, max = 96) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
}

function icon(name, extra = "") {
  return `<span class="material-symbols-outlined ${extra}">${escapeHtml(name)}</span>`;
}

const UI_TEXT = {
  zh: {
    aiLearningOs: "AI 学习系统",
    openSidebar: "展开侧边栏",
    collapseSidebar: "收起侧边栏",
    dashboard: "总览",
    crons: "自动任务",
    schedule: "日程",
    resources: "资源",
    projects: "项目",
    newProject: "新建项目",
    newCron: "新建自动任务",
    language: "语言",
    chinese: "中文",
    english: "英文",
    course: "课程",
    noFixedCourse: "不绑定固定课程",
    platform: "平台",
    local: "本地",
    sync: "同步",
    syncing: "同步中",
    chooseCourse: "选择课程",
    syncedFromPlatform: "平台同步",
    latest: "最新",
    resource: "资源",
    resourcesCount: "个资源",
    noPlatformResources: "这门课还没有同步到平台资源",
    syncCourseResources: "同步课程资源",
    noResourcesInCourse: "这门课还没有资源",
    uploadLocalFile: "上传本地文件",
    chooseFile: "选择文件",
    uploading: "上传中",
    addResource: "添加资源",
    courseResourceLibrary: "课程资源库",
    refresh: "刷新",
    coursesWithResources: "已有资源的课程",
    totalResources: "资源总数",
    sourceModel: "来源",
    platformAndLocal: "平台 + 本地",
    noResourcesYet: "还没有同步或导入资源",
    noCoursesAvailable: "还没有可用课程",
    logInSyncFirst: "请先登录并同步北航课表。资源页按“课程 -> 课堂/回放 -> PPT/视频”组织。",
    localFileHelp: "会用文件名作为标题，并根据扩展名识别类型。文件会作为本地资源保存到所选课程下。",
    clickSyncHelp: "点击同步后，只拉取 BUAA MSA 实际返回的 PPT、视频和字幕；不会把未来课表伪装成资源。",
    platformResourceHelp: "这里只显示 BUAA 实际返回的资源。未来课表中尚未产生 PPT/视频的课堂不会出现在这里。",
    noSyncedClassOrReplay: "还没有已同步的课堂或回放",
    unlinkedResources: "未关联课堂的资源",
    untitledSession: "未命名课堂",
    noDate: "无日期",
    open: "打开",
    unavailable: "不可用",
    localSource: "本地",
    cachedSource: "已缓存",
    platformSource: "平台",
    location: "位置",
    noLocation: "未记录位置",
    video: "视频",
    slides: "课件",
    subtitle: "字幕",
    notes: "笔记",
    link: "链接",
    folder: "文件夹",
    pdf: "PDF",
    resourceGeneric: "资源",
    courseResourcesSynced: "课程资源已从 BUAA 同步。",
    localFileUploaded: "本地文件已上传。",
    chooseCourseBeforeResource: "请先选择课程再添加资源。",
    localResourceImported: "本地资源已导入所选课程。",
    openableMissing: "这个资源没有可打开的位置。",
    loadingRuntime: "正在连接运行环境",
    preparingAtelier: "正在准备工作区",
  },
  en: {
    aiLearningOs: "AI Learning OS",
    openSidebar: "Open sidebar",
    collapseSidebar: "Collapse sidebar",
    dashboard: "Dashboard",
    crons: "Crons",
    schedule: "Schedule",
    resources: "Resources",
    projects: "Projects",
    newProject: "New Project",
    newCron: "New Cron",
    language: "Language",
    chinese: "Chinese",
    english: "English",
    course: "Course",
    noFixedCourse: "No fixed course",
    platform: "Platform",
    local: "Local",
    sync: "Sync",
    syncing: "Syncing",
    chooseCourse: "Choose a course",
    syncedFromPlatform: "Synced from platform",
    latest: "Latest",
    resource: "resource",
    resourcesCount: "resources",
    noPlatformResources: "No platform resources are synced for this course yet.",
    syncCourseResources: "Sync course resources",
    noResourcesInCourse: "No resources in this course yet.",
    uploadLocalFile: "Upload a local file directly.",
    chooseFile: "Choose File",
    uploading: "Uploading",
    addResource: "Add Resource",
    courseResourceLibrary: "Course Resource Library",
    refresh: "Refresh",
    coursesWithResources: "Courses with resources",
    totalResources: "Total resources",
    sourceModel: "Source model",
    platformAndLocal: "Platform + Local",
    noResourcesYet: "No synced or imported resources yet.",
    noCoursesAvailable: "No courses are available yet.",
    logInSyncFirst: "Log in and sync BUAA course data first. The Resource page is designed around course -> class/replay -> PPT/video.",
    localFileHelp: "MentorClaw will use the file name as the title and infer the type from the extension. It is stored under the selected course as a standalone local resource.",
    clickSyncHelp: "Click Sync to fetch only PPT, video, and subtitle resources that BUAA MSA actually returns. Future timetable classes are not shown as resources.",
    platformResourceHelp: "Only resources that BUAA actually returns are shown here. Future timetable classes without PPT/video stay out of this list.",
    noSyncedClassOrReplay: "No synced class or replay yet",
    unlinkedResources: "Unlinked resources",
    untitledSession: "Untitled session",
    noDate: "No date",
    open: "Open",
    unavailable: "Unavailable",
    localSource: "Local",
    cachedSource: "Cached",
    platformSource: "Platform",
    location: "Location",
    noLocation: "No location recorded",
    video: "Video",
    slides: "Slides",
    subtitle: "Subtitle",
    notes: "Notes",
    link: "Link",
    folder: "Folder",
    pdf: "PDF",
    resourceGeneric: "Resource",
    courseResourcesSynced: "Course resources synced from BUAA.",
    localFileUploaded: "Local file uploaded.",
    chooseCourseBeforeResource: "Choose a course before adding a resource.",
    localResourceImported: "Local resource imported into the selected course.",
    openableMissing: "This resource does not have an openable location.",
    loadingRuntime: "Connecting runtime",
    preparingAtelier: "Preparing atelier",
  },
};

function isZh() {
  return state.language !== "en";
}

function t(key) {
  return UI_TEXT[isZh() ? "zh" : "en"][key] || UI_TEXT.en[key] || key;
}

function uiLocale() {
  return isZh() ? "zh-CN" : "en-US";
}

function request(path, options = {}) {
  return fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  }).then(async (response) => {
    if (!response.ok) {
      let message = response.statusText;
      try {
        const payload = await response.json();
        message = payload.error || payload.message || message;
      } catch {}
      throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
  });
}

function formatDateTime(value) {
  if (!value) return "Unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDateShort(value, locale = uiLocale(), options = { month: "short", day: "numeric" }) {
  if (!value) return isZh() ? "未安排" : "Unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, options);
}

function formatClock(value) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function isoDateKey(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getSelectedPlan() {
  return state.snapshot?.plans.find((plan) => plan.planId === state.selectedPlanId) || null;
}

function getSelectedThread() {
  const plan = getSelectedPlan();
  return plan?.threads.find((thread) => thread.threadId === state.selectedThreadId) || null;
}

function getSelectedProjectCourseIds() {
  return getSelectedPlan()?.courseIds || [];
}

function getSelectedBinding() {
  return state.snapshot?.sessionBindings.find((binding) => binding.sessionKey === state.sessionKey) || null;
}

function hasReadableCourseLabel(course) {
  const label = `${course?.title || ""}${course?.teacher || ""}`.trim();
  return Boolean(label) && !/^[\s?[\]()（）|:：-]+$/.test(label);
}

function mostCommonText(values) {
  const counts = new Map();
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))[0]?.[0] || "";
}

function courseClassItems(courseId) {
  return (state.snapshot?.education?.courseItems || []).filter((item) => item.courseId === courseId && item.type === "class" && !item.isHidden);
}

function courseDisplayTitle(course) {
  if (!course) return "";
  if (course.sourceType === "buaa-byxt") {
    return mostCommonText(courseClassItems(course.id).map((item) => item.title)) || course.title || "";
  }
  return course.title || "";
}

function cleanCourseTeacherDisplay(value) {
  return String(value || "")
    .replace(/第?\s*\d+(?:-\d+)?\s*周/g, " ")
    .replace(/[单双全]\s*周/g, " ")
    .replace(/(^|[\s,，、;；])周[单双全]?(?=$|[\s,，、;；\[])/g, " ")
    .replace(/(^|[\s,，、;；])[单双全](?=$|[\s,，、;；\[])/g, " ")
    .replace(/\[\s*(主讲|理论|实践|实验)\s*\]/g, " ")
    .replace(/\b主讲\b/g, " ")
    .replace(/[;|/\\]+/g, " ")
    .replace(/^[\s,，、;；]+|[\s,，、;；]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function courseDisplayTeacher(course) {
  if (!course) return "";
  if (course.sourceType === "buaa-byxt") {
    return cleanCourseTeacherDisplay(mostCommonText(courseClassItems(course.id).map((item) => item.teacher)) || course.teacher || "");
  }
  return cleanCourseTeacherDisplay(course.teacher || "");
}

function shouldShowCourseOption(course, allCourses) {
  const linkedByxtId = typeof course.metadata?.byxtCourseId === "string" ? course.metadata.byxtCourseId.trim() : "";
  return !(course.sourceType !== "buaa-byxt" && linkedByxtId && allCourses.some((candidate) => candidate.id === linkedByxtId));
}

function getAvailableCourses() {
  const courses = state.snapshot?.education?.courses || [];
  return courses
    .filter((course) => course.status !== "hidden")
    .filter((course) => shouldShowCourseOption(course, courses))
    .filter(hasReadableCourseLabel)
    .slice()
    .sort((left, right) => courseDisplayTitle(left).localeCompare(courseDisplayTitle(right), "zh-CN"));
}

function courseSourceAliases(course) {
  const raw = course?.metadata?.sourceAliases;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

function courseSourceId(course, sourceType) {
  if (course?.sourceType === sourceType && course.sourceCourseId) return String(course.sourceCourseId).trim();
  const alias = courseSourceAliases(course)[sourceType];
  return typeof alias === "string" ? alias.trim() : "";
}

function normalizeCourseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "");
}

function coursesAreLinked(left, right) {
  if (!left || !right) return false;
  if (left.id === right.id) return true;
  const leftMsa = courseSourceId(left, "buaa-msa") || (typeof left.metadata?.msaCourseId === "string" ? left.metadata.msaCourseId.trim() : "");
  const rightMsa = courseSourceId(right, "buaa-msa") || (typeof right.metadata?.msaCourseId === "string" ? right.metadata.msaCourseId.trim() : "");
  if (leftMsa && rightMsa && leftMsa === rightMsa) return true;
  const leftByxt = courseSourceId(left, "buaa-byxt");
  const rightByxt = courseSourceId(right, "buaa-byxt");
  if (leftByxt && rightByxt && leftByxt === rightByxt) return true;
  if (left.metadata?.byxtCourseId === right.id || right.metadata?.byxtCourseId === left.id) return true;
  return left.term === right.term && normalizeCourseText(left.title) === normalizeCourseText(right.title) && normalizeCourseText(left.teacher) === normalizeCourseText(right.teacher);
}

function expandRelatedCourseIds(courseIds) {
  const courses = state.snapshot?.education?.courses || [];
  const expanded = new Set((courseIds || []).filter(Boolean));
  let changed = true;
  while (changed) {
    changed = false;
    for (const course of courses) {
      if (expanded.has(course.id)) continue;
      if (courses.some((candidate) => expanded.has(candidate.id) && coursesAreLinked(candidate, course))) {
        expanded.add(course.id);
        changed = true;
      }
    }
  }
  return expanded;
}

function getPlanCrons(plan = getSelectedPlan()) {
  if (!plan) return [];
  return (state.snapshot?.crons || [])
    .filter((cron) => cron.enabled !== false)
    .filter((cron) => {
      if (cron.projectId && cron.projectId === plan.planId) return true;
      const courseIds = cron.courseIds || [];
      return Boolean(courseIds.length && plan.courseIds?.some((courseId) => courseIds.includes(courseId)));
    })
    .sort((left, right) => {
      const leftScore = left.projectId === plan.planId ? 1 : 0;
      const rightScore = right.projectId === plan.planId ? 1 : 0;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    });
}

function syncResourceCourseDraft() {
  const plan = getSelectedPlan();
  const courses = getAvailableCourses();
  const preferred = plan?.courseIds?.find((courseId) => courses.some((course) => course.id === courseId)) || courses[0]?.id || "";
  if (!state.drafts.resourceCourseId && preferred) {
    state.drafts.resourceCourseId = preferred;
  }
  if (state.drafts.resourceCourseId && !courses.some((course) => course.id === state.drafts.resourceCourseId)) {
    state.drafts.resourceCourseId = preferred;
    state.drafts.resourceItemId = "";
  }
}

function currentFileSections(plan, thread) {
  return [
    { title: "Runtime Files", items: state.snapshot?.localFiles || [] },
    { title: "Plan Files", items: plan?.localFiles || [] },
    { title: "Conversation Files", items: thread?.localFiles || [] },
  ].filter((section) => section.items.length);
}

function defaultFilePath(plan, thread) {
  const memory = thread?.localFiles?.find((file) => file.label === "Working Memory");
  if (memory) return memory.absolutePath;
  if (thread?.localFiles?.[0]) return thread.localFiles[0].absolutePath;
  if (plan?.localFiles?.[0]) return plan.localFiles[0].absolutePath;
  return state.snapshot?.localFiles?.[0]?.absolutePath || "";
}

function syncSelection() {
  const plans = state.snapshot?.plans || [];
  if (!plans.length) {
    state.selectedPlanId = "";
    state.selectedThreadId = "";
    state.sessionKey = "";
    if (state.activeView === "project") state.activeView = "new-project";
  } else {
    if (!plans.some((plan) => plan.planId === state.selectedPlanId)) {
      state.selectedPlanId = state.snapshot.activePlanId || plans[0].planId;
    }
    const plan = getSelectedPlan();
    if (plan && state.selectedThreadId && !plan.threads.some((thread) => thread.threadId === state.selectedThreadId)) {
      state.selectedThreadId = "";
    }
    const thread = getSelectedThread();
    if (thread?.boundSessions?.length) {
      const hasCurrent = thread.boundSessions.some((binding) => binding.sessionKey === state.sessionKey);
      if (!hasCurrent) state.sessionKey = thread.boundSessions[0].sessionKey;
    }
  }

  const plan = getSelectedPlan();
  const thread = getSelectedThread();
  const visible = currentFileSections(plan, thread).flatMap((section) => section.items).map((file) => file.absolutePath);
  if (!visible.includes(state.activeFilePath)) state.activeFilePath = defaultFilePath(plan, thread);

  if (state.scheduleViewMode !== "month" && state.scheduleViewMode !== "week") {
    state.scheduleViewMode = state.snapshot?.education?.schedulePreferences?.scheduleDefaultView === "month" ? "month" : "week";
  }
  if (!state.scheduleCursorDate || Number.isNaN(new Date(state.scheduleCursorDate).getTime())) {
    state.scheduleCursorDate = new Date().toISOString();
  }
  if (!state.drafts.quickCourseId && getAvailableCourses().length) {
    state.drafts.quickCourseId = state.drafts.planCourseId || getAvailableCourses()[0].id;
  }
  syncResourceCourseDraft();
  const crons = state.snapshot?.crons || [];
  if (crons.length && !crons.some((cron) => cron.cronId === state.selectedCronId)) {
    state.selectedCronId = crons[0].cronId;
  }
  if (!crons.length) state.selectedCronId = "";

  writeStored("activeView", state.activeView);
  writeStored("selectedPlanId", state.selectedPlanId);
  writeStored("selectedThreadId", state.selectedThreadId);
  writeStored("selectedCronId", state.selectedCronId);
  writeStored("objectSearch", state.objectSearch);
  writeStored("selectedConfigId", state.selectedConfigId);
  writeStored("sessionKey", state.sessionKey);
  writeStored("activeFilePath", state.activeFilePath);
  writeStored("scheduleViewMode", state.scheduleViewMode);
  writeStored("scheduleCursorDate", state.scheduleCursorDate);
  writeStored("forceWorkflow", state.forceWorkflow);
  writeStored("leftSidebarCollapsed", state.leftSidebarCollapsed);
}

function invalidateFileCache() {
  state.fileCache = {};
}

async function ensureFileLoaded(filePath) {
  if (!filePath || state.fileCache[filePath] || state.loadingFilePath === filePath) return;
  state.loadingFilePath = filePath;
  render();
  try {
    state.fileCache[filePath] = await request(`/api/file?path=${encodeURIComponent(filePath)}`);
  } catch (error) {
    setFlash("error", error.message);
  } finally {
    state.loadingFilePath = "";
    render();
  }
}

function setActiveFile(filePath) {
  if (!filePath) return;
  state.activeFilePath = filePath;
  writeStored("activeFilePath", state.activeFilePath);
  ensureFileLoaded(filePath);
  render();
}

function setFlash(kind, message) {
  state.flash = { kind, message };
  render();
  window.clearTimeout(setFlash.timer);
  setFlash.timer = window.setTimeout(() => {
    state.flash = null;
    render();
  }, 3200);
}

async function refresh() {
  state.loading = true;
  render();
  try {
    state.snapshot = await request("/api/state");
    syncSelection();
    state.flash = null;
  } catch (error) {
    state.flash = { kind: "error", message: error.message };
  } finally {
    state.loading = false;
    render();
  }
}

async function submitJson(path, payload, onSuccess) {
  try {
    const result = await request(path, { method: "POST", body: JSON.stringify(payload) });
    invalidateFileCache();
    await onSuccess(result);
  } catch (error) {
    setFlash("error", error.message);
  }
}

function updateSchedulePreferences(patch, successMessage = "") {
  submitJson("/api/education/schedule-preferences", patch, async (snapshot) => {
    state.snapshot = snapshot;
    if (patch.scheduleDefaultView) state.scheduleViewMode = patch.scheduleDefaultView;
    syncSelection();
    render();
    if (successMessage) setFlash("info", successMessage);
  });
}

function learnerName() {
  for (const event of state.snapshot?.learnerEvents || []) {
    for (const evidence of event.evidence || []) {
      const match = evidence.match(/"sender":\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    }
  }
  return "there";
}

function brandMark() {
  return `
    <div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-on-primary">
      ${icon("school", "text-lg")}
    </div>
  `;
}

function renderFlash() {
  if (!state.flash) return "";
  const tone =
    state.flash.kind === "error"
      ? "bg-error text-on-error shadow-[0_24px_48px_-20px_rgba(158,66,44,0.7)]"
      : "bg-primary text-on-primary shadow-[0_24px_48px_-20px_rgba(85,99,67,0.45)]";
  return `
    <div class="flash-toast">
      <div class="rounded-2xl px-4 py-3 text-sm font-medium ${tone}">
        ${escapeHtml(state.flash.message)}
      </div>
    </div>
  `;
}

function sidebarProjectButtons(activePlanId, collapsed = false) {
  const plans = (state.snapshot?.plans || [])
    .filter((plan) => plan.projectStatus !== "archived" || plan.planId === activePlanId)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  if (!plans.length) {
    return collapsed
      ? `<div class="flex justify-center px-2 py-2 text-on-surface-variant">${icon("folder_off", "text-xl")}</div>`
      : `<div class="px-4 py-3 rounded-lg bg-white/40 text-sm text-on-surface-variant">No projects yet</div>`;
  }
  return plans
    .map((plan) => {
      const active = plan.planId === activePlanId;
      const sessionsCollapsed = projectSessionsCollapsed(plan.planId);
      const canShowSessions = active && !collapsed && !sessionsCollapsed;
      const threads = plan.threads || [];
      const extraSessionsExpanded = projectExtraSessionsExpanded(plan.planId);
      const visibleThreads = extraSessionsExpanded ? threads : threads.slice(0, DEFAULT_VISIBLE_PROJECT_SESSIONS);
      const hiddenSessionCount = Math.max(threads.length - DEFAULT_VISIBLE_PROJECT_SESSIONS, 0);
      const sessions = canShowSessions
        ? `
          <div class="ml-7 mt-2 space-y-1.5 border-l border-outline-variant/20 pl-3">
            ${threads.length
              ? visibleThreads.map((thread) => `
                <button class="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-all ${
                  thread.threadId === state.selectedThreadId ? "bg-primary-container text-primary font-bold" : "text-on-surface-variant hover:bg-white/45"
                }" data-action="select-thread" data-plan-id="${escapeHtml(plan.planId)}" data-thread-id="${escapeHtml(thread.threadId)}" title="${escapeHtml(thread.title)}">
                  ${icon("chat_bubble", "text-[14px]")}
                  <span class="truncate">${escapeHtml(thread.title)}</span>
                </button>
              `).join("")
              : `<div class="px-3 py-2 text-xs text-on-surface-variant/70">No saved sessions yet</div>`}
            ${hiddenSessionCount
              ? `<button class="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-primary hover:bg-white/45" data-action="toggle-project-session-overflow" data-plan-id="${escapeHtml(plan.planId)}">
                  ${icon(extraSessionsExpanded ? "expand_less" : "expand_more", "text-[16px]")}
                  <span>${extraSessionsExpanded ? "Show fewer sessions" : `Show ${hiddenSessionCount} more sessions`}</span>
                </button>`
              : ""}
          </div>
        `
        : "";
      return `
        <div>
          <div class="group flex items-center gap-1 rounded-lg transition-all ${
            active ? "bg-primary-container text-[#4F5D3D]" : "text-on-surface-variant hover:bg-white/30"
          }">
            <button class="min-w-0 flex-1 flex items-center gap-3 px-4 py-3 text-sm rounded-lg transition-all ${
              active ? "font-bold" : "font-medium"
            } ${collapsed ? "justify-center px-3" : ""}" data-action="select-plan" data-plan-id="${escapeHtml(plan.planId)}" title="${escapeHtml(plan.title)}">
              ${icon(plan.courseIds?.length ? "school" : "folder", "text-xl")}
              ${collapsed ? "" : `<span class="truncate">${escapeHtml(plan.title)}</span>`}
            </button>
            ${collapsed ? "" : `
              <div class="flex shrink-0 items-center gap-0.5 pr-1">
                <button class="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/55 hover:text-primary" data-action="new-chat" data-plan-id="${escapeHtml(plan.planId)}" title="New Session">
                  ${icon("add_comment", "text-[17px]")}
                </button>
                <button class="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/55 hover:text-primary" data-action="toggle-project-sessions" data-plan-id="${escapeHtml(plan.planId)}" title="${active && !sessionsCollapsed ? "Collapse sessions" : "Show sessions"}">
                  ${icon(active && !sessionsCollapsed ? "keyboard_arrow_down" : "keyboard_arrow_right", "text-[20px]")}
                </button>
              </div>
            `}
          </div>
          ${sessions}
        </div>
      `;
    })
    .join("");
}

function sidebarCronButtons(activeCronId, collapsed = false) {
  const crons = (state.snapshot?.crons || [])
    .slice()
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  if (!crons.length) {
    return collapsed
      ? `<div class="flex justify-center px-2 py-2 text-on-surface-variant">${icon("alarm_off", "text-xl")}</div>`
      : `<div class="px-4 py-3 rounded-lg bg-white/40 text-sm text-on-surface-variant">No crons yet</div>`;
  }
  return crons
    .map((cron) => {
      const active = cron.cronId === activeCronId;
      return `
        <button
          class="w-full text-left rounded-lg transition-all ${active ? "bg-primary-container text-[#4F5D3D]" : "text-on-surface-variant hover:bg-white/30"} ${collapsed ? "px-2 py-3" : "px-4 py-3"}"
          data-action="select-cron"
          data-cron-id="${escapeHtml(cron.cronId)}"
          title="${escapeHtml(cron.title)}"
        >
          <div class="flex items-start ${collapsed ? "justify-center" : "gap-3"}">
            <div class="shrink-0 pt-0.5">${icon("alarm", "text-xl")}</div>
            ${collapsed
              ? ""
              : `<div class="min-w-0 flex-1">
                  <div class="truncate text-sm ${active ? "font-bold" : "font-medium"}">${escapeHtml(cron.title)}</div>
                  <div class="mt-1 truncate text-xs text-on-surface-variant/80">${escapeHtml(cron.schedule)}</div>
                </div>
                ${cron.enabled === false ? `<span class="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant">Off</span>` : ""}`}
          </div>
        </button>
      `;
    })
    .join("");
}

function sidebarChatButtons(plan, collapsed = false) {
  if (!plan) {
    return collapsed
      ? `<div class="flex justify-center px-2 py-2 text-on-surface-variant">${icon("chat_error", "text-xl")}</div>`
      : `<div class="px-4 py-3 rounded-lg bg-white/40 text-sm text-on-surface-variant">Select a project first</div>`;
  }
  const threads = plan.threads || [];
  const extraSessionsExpanded = projectExtraSessionsExpanded(plan.planId);
  const visibleThreads = extraSessionsExpanded ? threads : threads.slice(0, DEFAULT_VISIBLE_PROJECT_SESSIONS);
  const hiddenSessionCount = Math.max(threads.length - DEFAULT_VISIBLE_PROJECT_SESSIONS, 0);
  const rows = threads.length
    ? visibleThreads.map((thread) => `
      <button class="w-full flex items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-all ${
        thread.threadId === state.selectedThreadId ? "bg-primary-container text-primary font-bold" : "text-on-surface-variant hover:bg-white/45"
      } ${collapsed ? "justify-center px-2" : ""}" data-action="select-thread" data-plan-id="${escapeHtml(plan.planId)}" data-thread-id="${escapeHtml(thread.threadId)}" title="${escapeHtml(thread.title)}">
        ${icon("chat_bubble", "text-[18px]")}
        ${collapsed ? "" : `<span class="truncate">${escapeHtml(thread.title)}</span>`}
      </button>
    `).join("")
    : collapsed
      ? `<div class="flex justify-center px-2 py-2 text-on-surface-variant">${icon("forum", "text-xl")}</div>`
      : `<div class="px-4 py-3 rounded-lg bg-white/40 text-sm text-on-surface-variant">No chats yet</div>`;
  return `
    ${rows}
    ${hiddenSessionCount && !collapsed
      ? `<button class="w-full flex items-center gap-2 rounded-lg px-4 py-3 text-left text-xs font-semibold text-primary hover:bg-white/45" data-action="toggle-project-session-overflow" data-plan-id="${escapeHtml(plan.planId)}">
          ${icon(extraSessionsExpanded ? "expand_less" : "expand_more", "text-[16px]")}
          <span>${extraSessionsExpanded ? "Show fewer chats" : `Show ${hiddenSessionCount} more chats`}</span>
        </button>`
      : ""}
  `;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function connectionDisplayName(connection) {
  const auth = connection?.auth || {};
  const metadata = connection?.metadata || {};
  return firstText(
    metadata.studentName,
    metadata.displayName,
    auth.studentName,
    auth.displayName,
    auth.realname,
    auth.realName,
    auth.name,
  );
}

function connectionAccount(connection) {
  const auth = connection?.auth || {};
  return firstText(auth.account, auth.username, connection?.accountLabel);
}

function currentStudentLogin() {
  const connections = (state.snapshot?.education?.connections || [])
    .filter((connection) => ["buaa-byxt", "buaa-msa"].includes(connection.sourceType))
    .sort((left, right) => {
      if (left.status === "connected" && right.status !== "connected") return -1;
      if (right.status === "connected" && left.status !== "connected") return 1;
      return String(right.lastSyncedAt || "").localeCompare(String(left.lastSyncedAt || ""));
    });
  const msaConnections = connections.filter((item) => item.sourceType === "buaa-msa");
  const connectedMsa = msaConnections.find((item) => item.status === "connected");
  const invalidMsa = msaConnections.find((item) => item.status === "invalid" || item.status === "error");
  const connection = connections[0];
  if (!connection) {
    return {
      connected: false,
      name: "未登录",
      detail: "连接学生账号后显示姓名",
      title: "当前未登录",
    };
  }
  if (!connectedMsa && invalidMsa) {
    const account = connectionAccount(invalidMsa);
    return {
      connected: false,
      name: account || invalidMsa.accountLabel || "MSA expired",
      detail: "BUAA MSA login expired",
      title: invalidMsa.lastError || "BUAA MSA login expired. Please log in again.",
    };
  }
  const account = connectionAccount(connection);
  const displayName =
    connectionDisplayName(connection) ||
    connectionDisplayName(connections.find((item) => connectionAccount(item) === account)) ||
    connectionDisplayName(connections.find((item) => connectionDisplayName(item)));
  const name = displayName || account || connection.accountLabel || "已登录";
  const detail = account && account !== name ? `账号 ${account}` : connection.sourceType.replace("buaa-", "BUAA ");
  return {
    connected: connection.status === "connected",
    name,
    detail,
    title: `${connection.status === "connected" ? "当前登录学生" : "登录状态"}：${name}${detail ? `，${detail}` : ""}`,
  };
}

function renderStudentLoginStatus(collapsed) {
  const login = currentStudentLogin();
  if (collapsed) {
    return `
      <div class="flex justify-center">
        <button
          class="flex h-11 w-11 items-center justify-center rounded-xl transition-all hover:-translate-y-0.5 hover:shadow-sm ${login.connected ? "bg-primary-container text-primary" : "bg-white/55 text-on-surface-variant hover:bg-white/75"}"
          data-action="open-buaa-login"
          title="${escapeHtml(login.title)}"
          type="button"
        >
          ${icon(login.connected ? "account_circle" : "person_off", "text-[22px]")}
        </button>
      </div>
    `;
  }
  return `
    <button
      class="flex w-full items-center gap-3 rounded-xl bg-white/45 px-3 py-3 text-left transition-all hover:-translate-y-0.5 hover:bg-white/70 hover:shadow-sm"
      data-action="open-buaa-login"
      title="${escapeHtml(login.title)}"
      type="button"
    >
      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${login.connected ? "bg-primary-container text-primary" : "bg-surface-container text-on-surface-variant"}">
        ${icon(login.connected ? "account_circle" : "person_off", "text-[22px]")}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant/55">当前登录学生</p>
        <p class="mt-0.5 truncate text-sm font-bold text-on-background">${escapeHtml(login.name)}</p>
        <p class="truncate text-xs text-on-surface-variant">${escapeHtml(login.detail)}</p>
      </div>
      <div class="shrink-0 text-on-surface-variant/55">
        ${icon("chevron_right", "text-[18px]")}
      </div>
    </button>
  `;
}

function renderSidebar(mode) {
  const activePlan = getSelectedPlan();
  const collapsed = state.leftSidebarCollapsed;
  const activeSidebarPlanId = mode === "project" ? activePlan?.planId || "" : "";
  const activeSidebarCronId = mode === "crons" ? selectedCron()?.cronId || "" : "";
  const collectionSection = mode === "project"
    ? {
        label: "Chats",
        actionView: "",
        action: "new-chat",
        actionTitle: "New Chat",
        buttons: sidebarChatButtons(activePlan, collapsed),
        iconName: "add_comment",
        isActive: !state.selectedThreadId,
      }
    : mode === "crons"
      ? {
          label: t("crons"),
          actionView: "",
          action: "new-global-cron",
          actionTitle: t("newCron"),
          buttons: "",
          iconName: "alarm_add",
          isActive: state.showDashboardCron,
        }
      : {
          label: t("projects"),
          actionView: "new-project",
          action: "set-view",
          actionTitle: t("newProject"),
          buttons: "",
          iconName: "note_stack_add",
          isActive: mode === "new-project",
        };
  const navButton = (view, label, iconName, active = false) => `
    <button
      class="w-full flex items-center ${collapsed ? "justify-center" : "gap-3"} px-3 py-3 rounded-xl text-sm transition-all ${
        active ? "bg-primary text-on-primary shadow-sm" : "text-on-surface-variant hover:bg-white/50"
      }"
      data-action="set-view"
      data-view="${escapeHtml(view)}"
      title="${escapeHtml(label)}"
    >
      ${icon(iconName, "text-xl")}
      ${collapsed ? "" : `<span class="truncate">${escapeHtml(label)}</span>`}
    </button>
  `;
  const demo = "";
  return `
    <aside class="sticky top-0 left-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-outline-variant/10 bg-surface-container-low p-4 transition-all duration-200 ${collapsed ? "w-[88px]" : "w-72"}">
      <div class="flex items-center ${collapsed ? "justify-center" : "gap-3"} px-2 py-2">
        ${brandMark()}
        ${collapsed ? "" : `<div>
          <h1 class="font-headline font-bold text-xl text-primary leading-tight">MentorClaw</h1>
          <p class="font-body font-medium text-xs text-on-surface-variant">${escapeHtml(t("aiLearningOs"))}</p>
        </div>`}
        <button class="ml-auto flex h-10 w-10 items-center justify-center rounded-xl text-on-surface-variant hover:bg-white/60" data-action="toggle-left-sidebar" title="${collapsed ? escapeHtml(t("openSidebar")) : escapeHtml(t("collapseSidebar"))}">
          ${icon(collapsed ? "right_panel_open" : "left_panel_close", "text-[20px]")}
        </button>
      </div>
      <div class="mt-2 space-y-2">
        ${navButton("dashboard", t("dashboard"), "space_dashboard", mode === "dashboard")}
        ${navButton("projects", t("projects"), "view_list", mode === "projects" || mode === "new-project")}
        ${navButton("crons", t("crons"), "alarm", mode === "crons")}
        ${navButton("schedule", t("schedule"), "calendar_month", mode === "schedule")}
        ${navButton("resources", t("resources"), "folder_open", mode === "resources")}
        ${navButton("config", "Config", "tune", mode === "config")}
      </div>
      <nav class="mt-3 min-h-0 flex-1 overflow-y-auto space-y-2 pb-2 custom-scrollbar">
        ${collapsed
          ? `
            <button
              class="mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-on-surface-variant transition-all ${collectionSection.isActive ? "bg-primary text-on-primary shadow-sm" : "hover:bg-white/50"}"
              data-action="${escapeHtml(collectionSection.action)}"
              ${collectionSection.actionView ? `data-view="${escapeHtml(collectionSection.actionView)}"` : ""}
              title="${escapeHtml(collectionSection.actionTitle)}"
            >
              ${icon(collectionSection.iconName, "text-[20px]")}
            </button>
          `
          : `
            <div class="flex items-center justify-between px-3">
              <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-on-surface-variant/55">${escapeHtml(collectionSection.label)}</p>
              <button
                class="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-all ${collectionSection.isActive ? "bg-primary text-on-primary shadow-sm" : "hover:bg-white/50"}"
                data-action="${escapeHtml(collectionSection.action)}"
                ${collectionSection.actionView ? `data-view="${escapeHtml(collectionSection.actionView)}"` : ""}
                title="${escapeHtml(collectionSection.actionTitle)}"
              >
                ${icon(collectionSection.iconName, "text-[18px]")}
              </button>
            </div>
          `}
        ${collectionSection.buttons}
      </nav>
      <div class="shrink-0 border-t border-outline-variant/10 pt-3">
        ${collapsed ? "" : `
          <label class="mb-3 grid gap-1 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant/55">
            ${escapeHtml(t("language"))}
            <select class="rounded-xl border border-outline-variant/18 bg-white px-3 py-2 text-xs font-semibold normal-case tracking-normal text-on-background shadow-sm" name="language">
              <option value="zh" ${state.language !== "en" ? "selected" : ""}>${escapeHtml(t("chinese"))}</option>
              <option value="en" ${state.language === "en" ? "selected" : ""}>${escapeHtml(t("english"))}</option>
            </select>
          </label>
        `}
        ${renderStudentLoginStatus(collapsed)}
      </div>
    </aside>
  `;
}

function focusItems() {
  const education = state.snapshot?.education;
  if (!education) return [];
  const courseMap = new Map((education.courses || []).map((course) => [course.id, course]));
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const toFocusRecord = (item) => {
    const start = scheduleParseDate(scheduleResolvedItemStart(item) || item.dueAt);
    if (!start) return null;
    const end = scheduleParseDate(scheduleResolvedItemEnd(item));
    const course = courseMap.get(item.courseId);
    const courseTitle = course?.title || (item.courseId === "manual" ? "自定义日程" : item.courseId);
    const title = scheduleResolvedItemTitle(item);
    const timeRange = end && end.getTime() !== start.getTime()
      ? `${formatClock(start)}-${formatClock(end)}`
      : formatClock(start);
    return {
      startsAt: start,
      title: `${weekdayLabelZh(start)} ${timeRange} ${title || courseTitle}`,
      subtitle: [courseTitle !== title ? courseTitle : "", scheduleResolvedItemLocation(item), item.teacher || course?.teacher || ""]
        .filter(Boolean)
        .join(" · "),
      tag: item.type === "assignment" || item.type === "exam" ? "Due" : item.type,
      tone: item.type === "manual" ? "bg-primary-container text-primary" : "bg-secondary-container text-on-secondary-container",
    };
  };
  const records = (education.courseItems || [])
    .filter((item) => !item.isHidden)
    .filter((item) => item.type === "class" || item.type === "manual" || item.type === "assignment" || item.type === "exam")
    .map(toFocusRecord)
    .filter(Boolean)
    .sort((left, right) => left.startsAt - right.startsAt);
  const today = records.filter((item) => item.startsAt >= dayStart && item.startsAt < dayEnd);
  if (today.length) return today.slice(0, 5);
  const upcoming = records.filter((item) => item.startsAt >= now).slice(0, 5);
  if (upcoming.length) {
    return upcoming.map((item) => ({ ...item, tag: formatDateShort(item.startsAt.toISOString(), "zh-CN", { month: "short", day: "numeric" }) }));
  }
  return [
    {
      title: "今天还没有日程",
      subtitle: "可以在 Schedule 里添加复习、总结或作业检查；这里会直接显示那些日程。",
      tag: "Empty",
      tone: "bg-secondary-container text-on-secondary-container",
    },
  ];
}

function mentorNote() {
  const plan = getSelectedPlan() || state.snapshot?.plans?.[0] || null;
  if (!plan) {
    return {
      body: "Your local runtime is empty right now. Start a project and this space will begin surfacing patterns, notes, and learning rhythm automatically.",
      action: "set-view",
      value: "new-project",
      primary: "Initialize Project",
    };
  }
  return {
    body: `${plan.title} is the current focus. It has ${plan.threads.length} conversations and ${plan.boundSessions.length} bound sessions anchored to real runtime files.`,
    action: "select-plan",
    value: plan.planId,
    primary: "Open Project",
  };
}

function weekdayLabelZh(date) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()] || "";
}

function dashboardCourseId() {
  return state.drafts.quickCourseId || getSelectedPlan()?.courseIds?.[0] || getAvailableCourses()[0]?.id || "";
}

function hasConnectedBuaaAccount() {
  return (state.snapshot?.education?.connections || []).some(
    (connection) => connection.sourceType === "buaa-byxt" && connection.status === "connected",
  );
}

function shouldShowBuaaLogin() {
  if (!state.snapshot) return false;
  return state.showBuaaLogin;
}

function buaaLoginNeedsMsaCourseIds() {
  return false;
}

function resetBuaaLoginContext() {
  state.pendingBuaaCourseId = "";
  state.buaaLoginIntent = "account";
  state.drafts.buaaMsaCourseIds = "";
}

function pendingBuaaCourse() {
  const courseId = state.pendingBuaaCourseId;
  return (state.snapshot?.education?.courses || []).find((course) => course.id === courseId) || null;
}

function renderBuaaLoginModal() {
  if (!shouldShowBuaaLogin()) return "";
  const pendingCourse = pendingBuaaCourse();
  const showMsaCourseIds = buaaLoginNeedsMsaCourseIds();
  const pendingLabel = pendingCourse
    ? `${pendingCourse.title}${pendingCourse.teacher ? ` / ${pendingCourse.teacher}` : ""}`
    : "";
  const modalHint = state.buaaLoginIntent === "retry-sync" && pendingLabel
    ? `\u004d\u0053\u0041 \u767b\u5f55\u5df2\u8fc7\u671f\u3002\u91cd\u65b0\u767b\u5f55\u540e\uff0c\u004d\u0065\u006e\u0074\u006f\u0072\u0043\u006c\u0061\u0077 \u4f1a\u7ee7\u7eed\u540c\u6b65\u8fd9\u95e8\u8bfe\u7684\u8d44\u6e90\uff1a${pendingLabel}\u3002`
    : state.buaaLoginIntent === "map-and-sync" && pendingLabel
      ? `\u5f53\u524d\u5361\u4f4f\u7684\u4e0d\u662f\u201c\u767b\u5f55\u201d\u672c\u8eab\uff0c\u800c\u662f\u8fd9\u95e8\u8bfe\u8fd8\u7f3a\u5c11 \u004d\u0053\u0041 \u8bfe\u7a0b\u6620\u5c04\uff1a${pendingLabel}\u3002\u53ea\u6709\u8981\u540c\u6b65\u8fd9\u95e8\u8bfe\u7684 \u0050\u0050\u0054\u002f\u89c6\u9891\u8d44\u6e90\u65f6\uff0c\u624d\u9700\u8981\u586b\u5199\u4e0b\u9762\u7684 \u004d\u0053\u0041 \u8bfe\u7a0b \u0049\u0044\u3002`
      : `\u8fd9\u91cc\u53ea\u662f\u91cd\u65b0\u767b\u5f55\u5317\u822a\u8d26\u53f7\u3001\u5237\u65b0\u4f1a\u8bdd\uff0c\u4e0d\u9700\u8981\u586b\u5199\u8bfe\u7a0b\u4fe1\u606f\u3002`;
  const submitLabel = state.buaaLoginIntent === "retry-sync"
    ? `\u91cd\u65b0\u767b\u5f55\u5e76\u7ee7\u7eed\u540c\u6b65`
    : state.buaaLoginIntent === "map-and-sync"
      ? `\u767b\u5f55\u5e76\u7ee7\u7eed\u8bfe\u7a0b\u540c\u6b65`
      : `\u767b\u5f55\u5e76\u540c\u6b65\u8bfe\u8868`;
  return `
    <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-sm">
      <form id="buaa-login-form" class="w-full max-w-[520px] rounded-2xl border border-outline-variant/20 bg-background px-6 py-6 shadow-[0_28px_80px_-36px_rgba(0,0,0,0.55)]">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-on-surface-variant/60">BUAA Account</p>
            <p class="mt-2 text-sm leading-6 text-on-surface-variant">${escapeHtml(modalHint)}</p>
            <h2 class="mt-2 font-headline text-3xl font-bold">\u767b\u5f55\u5317\u822a\u5e73\u53f0</h2>
          </div>
          <button class="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container text-on-surface-variant hover:text-primary" type="button" data-action="dismiss-buaa-login" title="Close">
            ${icon("close", "text-[20px]")}
          </button>
        </div>
        <div class="mt-5 grid gap-3">
          <label class="grid gap-2">
            <span class="text-xs font-semibold text-on-surface-variant">\u5b66\u53f7</span>
            <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="buaaUsername" autocomplete="username" value="${escapeHtml(state.drafts.buaaUsername)}" />
          </label>
          <label class="grid gap-2">
            <span class="text-xs font-semibold text-on-surface-variant">\u5bc6\u7801</span>
            <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="buaaPassword" type="password" autocomplete="current-password" value="${escapeHtml(state.drafts.buaaPassword)}" />
          </label>
          <div class="${showMsaCourseIds ? "" : "hidden"}">
            <label class="grid gap-2">
              <span class="text-xs font-semibold text-on-surface-variant">\u004d\u0053\u0041 \u8bfe\u7a0b \u0049\u0044\uff08\u53ef\u9009\uff0c\u591a\u4e2a\u7528\u9017\u53f7\u5206\u9694\uff09</span>
              <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="buaaMsaCourseIds" placeholder="\u4f8b\u5982 138894,106798" value="${escapeHtml(state.drafts.buaaMsaCourseIds)}" />
              <p class="text-xs leading-5 text-on-surface-variant/80">\u53ea\u6709\u8fd9\u95e8\u8bfe\u8fd8\u6ca1\u7ed1\u5b9a \u004d\u0053\u0041 \u5e73\u53f0\u8bfe\u7a0b \u0049\u0044 \u65f6\uff0c\u624d\u9700\u8981\u8865\u4e0a\u3002</p>
            </label>
          </div>
        </div>
        <div class="mt-5 flex flex-wrap items-center justify-end gap-3">
          <button class="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-on-background shadow-sm hover:bg-surface-container" type="button" data-action="dismiss-buaa-login">\u7a0d\u540e</button>
          <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm disabled:opacity-50" type="submit" ${state.submittingBuaaLogin ? "disabled" : ""}>
            ${icon(state.submittingBuaaLogin ? "sync" : "login", "text-[18px]")}
            ${state.submittingBuaaLogin ? "\u6b63\u5728\u767b\u5f55" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  `;
}

function dashboardCourseItems(courseId = dashboardCourseId()) {
  return (state.snapshot?.education?.courseItems || [])
    .filter((item) => !item.isHidden)
    .filter((item) => !courseId || item.courseId === courseId || item.courseId === "manual")
    .filter((item) => item.type === "class" || item.type === "replay" || item.type === "manual")
    .slice()
    .sort((left, right) => String(scheduleResolvedItemStart(right) || right.lastSyncedAt || "").localeCompare(String(scheduleResolvedItemStart(left) || left.lastSyncedAt || "")));
}

function renderCourseItemSelect(name, value, courseId = dashboardCourseId()) {
  const items = dashboardCourseItems(courseId);
  const selectedValue = value && items.some((item) => item.id === value) ? value : items[0]?.id || "";
  state.drafts.quickItemId = selectedValue;
  return `
    <select class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm text-on-background shadow-sm focus:border-primary focus:ring-primary/20" name="${escapeHtml(name)}">
      ${items.length
        ? items.map((item) => {
            const start = scheduleParseDate(scheduleResolvedItemStart(item));
            const label = [start ? `${formatDateShort(start.toISOString(), "zh-CN", { month: "short", day: "numeric" })} ${formatClock(start)}` : "", scheduleResolvedItemTitle(item)]
              .filter(Boolean)
              .join(" · ");
            return `<option value="${escapeHtml(item.id)}" ${item.id === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
          }).join("")
        : `<option value="">No class or replay item yet</option>`}
    </select>
  `;
}

function findPlanForCourse(courseId) {
  return (state.snapshot?.plans || []).find((plan) => plan.courseIds?.includes(courseId)) || getSelectedPlan() || state.snapshot?.plans?.[0] || null;
}

function dashboardCrons() {
  return (state.snapshot?.crons || [])
    .slice()
    .sort((left, right) => {
      const leftEnabled = left.enabled === false ? 0 : 1;
      const rightEnabled = right.enabled === false ? 0 : 1;
      if (leftEnabled !== rightEnabled) return rightEnabled - leftEnabled;
      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    });
}

function resetDashboardCronDraft() {
  state.editingDashboardCronId = "";
  state.drafts.quickCronTitle = "";
  state.drafts.quickCronSchedule = "";
  state.drafts.quickCronPrompt = "";
}

function setDashboardCronDraft(cron) {
  state.editingDashboardCronId = cron.cronId;
  state.drafts.quickCronTitle = cron.title || "";
  state.drafts.quickCronSchedule = cron.schedule || "";
  state.drafts.quickCronPrompt = cron.prompt || "";
  if (cron.courseIds?.[0]) state.drafts.quickCourseId = cron.courseIds[0];
}

function resourceOpenHref(resource) {
  if (resource.localPath) return `/api/resource?resourceId=${encodeURIComponent(resource.id)}`;
  if (/^https?:\/\//i.test(resource.url || "")) return resource.url;
  return "";
}

function isPrimaryCourseResource(resource) {
  return resource?.resourceType === "ppt" || resource?.resourceType === "pptx" || resource?.resourceType === "video";
}

function dashboardResources() {
  const selectedCourseIds = expandRelatedCourseIds([...(getSelectedPlan()?.courseIds || []), dashboardCourseId()].filter(Boolean));
  const scoped = (state.snapshot?.education?.courseResources || [])
    .filter((resource) => selectedCourseIds.has(resource.courseId))
    .filter(isPrimaryCourseResource)
    .slice()
    .sort((left, right) => {
      return String(right.metaJson?.addedAt || right.id || "").localeCompare(String(left.metaJson?.addedAt || left.id || ""));
    });
  const priority = ["pdf", "pptx", "ppt", "video", "notes", "link", "folder"];
  const byType = new Map();
  for (const resource of scoped) {
    const bucket = byType.get(resource.resourceType) || [];
    bucket.push(resource);
    byType.set(resource.resourceType, bucket);
  }
  const selected = [];
  for (const type of priority) {
    const first = byType.get(type)?.[0];
    if (first) selected.push(first);
  }
  for (const resource of scoped) {
    if (selected.length >= 6) break;
    if (!selected.some((item) => item.id === resource.id)) selected.push(resource);
  }
  return selected;
}

function dashboardResourceGroups(resources = dashboardResources()) {
  const labels = {
    pdf: "Documents",
    ppt: "Slides",
    pptx: "Slides",
    video: "Videos",
    notes: "Notes",
    link: "Links",
    folder: "Folders",
  };
  const groups = new Map();
  for (const resource of resources) {
    const key = labels[resource.resourceType] || "Other";
    const items = groups.get(key) || [];
    items.push(resource);
    groups.set(key, items);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function renderDashboardSummaryComposer(courseId = dashboardCourseId()) {
  if (!state.showDashboardSummary) return "";
  return `
    <form id="dashboard-summary-form" class="space-y-3 rounded-2xl bg-surface-container-low px-4 py-4">
      ${renderCourseSelect("quickCourseId", courseId, { includeEmpty: false })}
      ${renderCourseItemSelect("quickItemId", state.drafts.quickItemId, courseId)}
      <button class="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-on-background shadow-sm hover:bg-surface-container" type="submit">
        ${icon("play_arrow", "text-[18px]")}
        <span>Run summary</span>
      </button>
    </form>
  `;
}

function renderDashboardCronComposer(courseId = dashboardCourseId()) {
  if (!state.showDashboardCron) return "";
  const editingCron = state.editingDashboardCronId
    ? (state.snapshot?.crons || []).find((cron) => cron.cronId === state.editingDashboardCronId)
    : null;
  return `
    <form id="dashboard-cron-form" class="space-y-3 rounded-2xl bg-surface-container-low px-4 py-4">
      ${renderCourseSelect("quickCourseId", courseId, { includeEmpty: false })}
      <input type="hidden" name="editingDashboardCronId" value="${escapeHtml(editingCron?.cronId || "")}" />
      <label class="grid gap-2">
        <span class="text-xs font-semibold text-on-surface-variant">Cron name</span>
        <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="quickCronTitle" value="${escapeHtml(state.drafts.quickCronTitle)}" />
      </label>
      <label class="grid gap-2">
        <span class="text-xs font-semibold text-on-surface-variant">Schedule rule</span>
        <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="quickCronSchedule" value="${escapeHtml(state.drafts.quickCronSchedule)}" />
      </label>
      <label class="grid gap-2">
        <span class="text-xs font-semibold text-on-surface-variant">Action to run</span>
        <textarea class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm leading-7 shadow-sm focus:border-primary focus:ring-primary/20 resize-none" name="quickCronPrompt" rows="4">${escapeHtml(state.drafts.quickCronPrompt)}</textarea>
      </label>
      <div class="flex flex-wrap items-center gap-3">
        <button class="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-on-background shadow-sm hover:bg-surface-container" type="submit">
          ${icon("save", "text-[18px]")}
          <span>${editingCron ? "Save Cron" : "Create Cron"}</span>
        </button>
        ${editingCron ? `<button class="rounded-xl px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-white" type="button" data-action="cancel-dashboard-cron-edit">Cancel</button>` : ""}
      </div>
    </form>
  `;
}

function renderDashboardPage() {
  const courseId = dashboardCourseId();
  const course = getAvailableCourses().find((item) => item.id === courseId);
  const courseMap = new Map((state.snapshot?.education?.courses || []).map((item) => [item.id, item]));
  const crons = dashboardCrons();
  const resources = dashboardResources();
  return `
    <div class="flex min-h-screen overflow-hidden bg-background text-on-background">
      ${renderSidebar("dashboard")}
      <main class="flex-1 overflow-y-auto custom-scrollbar">
        <section class="mx-auto max-w-[1120px] px-6 py-8 lg:px-10">
          ${renderCronSummaryCard()}
          <div class="grid gap-6 lg:grid-cols-2">
            <section class="rounded-[28px] border border-outline-variant/15 bg-surface-container-lowest px-6 py-6 shadow-[0_26px_70px_-48px_rgba(49,51,46,0.3)]">
              <div class="flex items-center justify-between gap-4 border-b border-outline-variant/10 pb-4">
                <h3 class="font-headline text-3xl font-bold">Today&apos;s focus</h3>
                <span class="text-sm text-on-surface-variant">${escapeHtml(formatDateShort(new Date().toISOString(), "en-US", { month: "long", day: "numeric", year: "numeric" }))}</span>
              </div>
              <div class="mt-5 space-y-3">
                ${focusItems().map((item) => `
                  <button class="w-full rounded-2xl bg-surface-container-low px-4 py-4 text-left transition-all hover:bg-surface-container" data-action="set-view" data-view="schedule">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <h4 class="font-semibold text-on-background">${escapeHtml(item.title)}</h4>
                        <p class="mt-1 text-sm leading-7 text-on-surface-variant">${escapeHtml(item.subtitle)}</p>
                      </div>
                      <span class="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${item.tone}">${escapeHtml(item.tag)}</span>
                    </div>
                  </button>
                `).join("")}
              </div>
            </section>
            <section class="rounded-[28px] border border-outline-variant/15 bg-surface-container-lowest px-6 py-6 shadow-[0_26px_70px_-48px_rgba(49,51,46,0.3)]">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h3 class="font-headline text-3xl font-bold">Cron lists</h3>
                </div>
                <button class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-container text-on-surface-variant hover:text-primary" data-action="toggle-dashboard-cron" title="New Cron">${icon(state.showDashboardCron ? "remove" : "add")}</button>
              </div>
              <div class="mt-5 grid gap-3">
                ${false ? `<button class="hidden items-center justify-between gap-3 rounded-2xl bg-primary px-4 py-4 text-left text-on-primary shadow-sm" data-action="toggle-dashboard-summary">
                  <span class="inline-flex items-center gap-3 text-sm font-semibold">${icon("summarize", "text-[18px]")}总结课程内容</span>
                  ${icon(state.showDashboardSummary ? "expand_less" : "expand_more", "text-[20px]")}
                </button>` : ""}
                ${renderDashboardCronComposer(courseId)}
                ${crons.length
                  ? crons.map((cron) => `
                    <div class="rounded-2xl bg-surface-container-low px-4 py-4">
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div class="flex flex-wrap items-center gap-2">
                            <h4 class="font-semibold text-on-background">${escapeHtml(cron.title)}</h4>
                            ${cron.enabled === false ? `<span class="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant">Disabled</span>` : ""}
                          </div>
                          <p class="mt-1 text-sm text-on-surface-variant">${escapeHtml(cron.schedule)}</p>
                        </div>
                        <div class="flex flex-wrap items-center justify-end gap-2">
                          <button class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-on-surface-variant shadow-sm hover:bg-surface-container hover:text-primary" data-action="edit-dashboard-cron" data-cron-id="${escapeHtml(cron.cronId)}" title="Edit Cron">${icon("edit", "text-[18px]")}</button>
                          <button class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-on-surface-variant shadow-sm hover:bg-surface-container hover:text-primary" data-action="toggle-dashboard-cron-enabled" data-cron-id="${escapeHtml(cron.cronId)}" title="${cron.enabled === false ? "Enable Cron" : "Disable Cron"}">${icon(cron.enabled === false ? "toggle_off" : "toggle_on", "text-[20px]")}</button>
                          <button class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#8A4B3A] shadow-sm hover:bg-surface-container" data-action="delete-dashboard-cron" data-cron-id="${escapeHtml(cron.cronId)}" title="Delete Cron">${icon("delete", "text-[18px]")}</button>
                          <button class="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-on-background shadow-sm hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50" data-action="run-cron" data-cron-id="${escapeHtml(cron.cronId)}" ${cron.enabled === false ? "disabled" : ""}>${icon("play_arrow", "text-[18px]")}Run</button>
                        </div>
                      </div>
                    </div>
                  `).join("")
                  : ""}
              </div>
            </section>
          </div>
          <section class="mt-6 rounded-[28px] border border-outline-variant/15 bg-surface-container-lowest px-6 py-6 shadow-[0_26px_70px_-48px_rgba(49,51,46,0.3)]">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 class="font-headline text-3xl font-bold">Resource quick index</h3>
                <p class="mt-2 text-sm leading-7 text-on-surface-variant">Showing resources bound to the selected project or course, grouped by type.</p>
              </div>
              <button class="inline-flex items-center gap-2 rounded-xl bg-surface-container px-4 py-2 text-sm font-semibold text-on-background hover:bg-surface-container-high" data-action="set-view" data-view="resources">${icon("folder_open", "text-[18px]")}Library</button>
            </div>
            <div class="mt-5 space-y-5">
              ${resources.length
                ? dashboardResourceGroups(resources).map((group) => `
                    <div>
                      <div class="mb-2 flex items-center gap-2">
                        <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/60">${escapeHtml(group.label)}</p>
                        <span class="rounded-full bg-surface-container px-2 py-0.5 text-[10px] font-bold text-primary">${group.items.length}</span>
                      </div>
                      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        ${group.items.map((resource) => {
                          const href = resourceOpenHref(resource);
                          const courseTitle = courseMap.get(resource.courseId)?.title || resource.courseId;
                          const openLabel = resource.localPath ? "Open cached" : "Open platform";
                          return `
                            <article class="rounded-2xl bg-surface-container-low px-4 py-4">
                              <div class="flex items-start justify-between gap-3">
                                <h4 class="line-clamp-2 text-sm font-bold text-on-background">${escapeHtml(resource.title)}</h4>
                                <span class="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">${escapeHtml(resource.resourceType)}</span>
                              </div>
                              <p class="mt-2 line-clamp-1 text-xs text-on-surface-variant">${escapeHtml(courseTitle)}</p>
                              ${href
                                ? `<a class="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-on-background shadow-sm hover:bg-surface-container" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" data-action="open-resource" data-href="${escapeHtml(href)}">${icon(resource.localPath ? "file_open" : "open_in_new", "text-[16px]")}${escapeHtml(openLabel)}</a>`
                                : `<p class="mt-4 text-xs leading-5 text-on-surface-variant">No openable URL or local cache recorded.</p>`}
                            </article>
                          `;
                        }).join("")}
                      </div>
                    </div>
                  `).join("")
                : `<div class="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">No project/course resources are available yet. Open Library to sync or add course resources.</div>`}
            </div>
          </section>
        </section>
      </main>
      ${renderFlash()}
    </div>
  `;
}

function cronRunsFor(cronId) {
  return (state.snapshot?.cronRuns || []).filter((run) => run.cronId === cronId);
}

function selectedCron() {
  return (state.snapshot?.crons || []).find((cron) => cron.cronId === state.selectedCronId) || (state.snapshot?.crons || [])[0] || null;
}

function objectSearchNeedle() {
  return String(state.objectSearch || "").trim().toLowerCase();
}

function textMatchesSearch(values, needle = objectSearchNeedle()) {
  if (!needle) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(needle));
}

function filteredProjects() {
  return (state.snapshot?.projects || state.snapshot?.plans || [])
    .filter((plan) => plan.projectStatus !== "archived")
    .filter((plan) => textMatchesSearch([
      plan.title,
      plan.summary,
      plan.projectId || plan.planId,
      ...(plan.courseIds || []),
      ...(plan.threads || []).map((thread) => thread.title).join(" "),
    ]))
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

function filteredCrons() {
  return (state.snapshot?.crons || [])
    .filter((cron) => textMatchesSearch([
      cron.title,
      cron.schedule,
      cron.prompt,
      cron.cronId,
      ...(cron.courseIds || []),
      cron.projectId,
    ]))
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

function cronCourseLabel(cron) {
  const courseIds = cron?.courseIds || [];
  if (!courseIds.length) return "Standalone";
  const courseMap = new Map((state.snapshot?.education?.courses || []).map((course) => [course.id, course]));
  return courseIds.map((courseId) => courseMap.get(courseId)?.title || courseId).join(", ");
}

function cronRunLabel(run) {
  const labels = {
    created: "Created",
    updated: "Updated",
    manual_run: "Manual run",
    scheduled_run: "Scheduled run",
    follow_up: "Follow-up",
  };
  return labels[run.kind] || run.status || "Message";
}

function renderCronConversation(cron, runs) {
  const messages = [];
  for (const run of runs.slice().reverse()) {
    if (run.userMessage) {
      messages.push({
        role: "user",
        title: cronRunLabel(run),
        ts: run.triggeredAt,
        text: run.userMessage,
        status: run.status,
      });
    }
    const reply = run.assistantReply || run.output || run.reason;
    if (reply) {
      messages.push({
        role: "assistant",
        title: run.status === "failed" ? "MentorClaw error" : "MentorClaw",
        ts: run.triggeredAt,
        text: reply,
        status: run.status,
      });
    }
  }
  if (state.runningCronId === cron?.cronId) {
    messages.push({
      role: "assistant",
      title: "MentorClaw",
      ts: new Date().toISOString(),
      text: "Running this Cron now...",
      status: "pending",
      pending: true,
    });
  }
  if (state.sendingCronMessage) {
    messages.push({
      role: "assistant",
      title: "MentorClaw",
      ts: new Date().toISOString(),
      text: "Thinking about your follow-up...",
      status: "pending",
      pending: true,
    });
  }
  if (!messages.length) {
    return `<div class="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">No conversation yet. Create, run, or ask about this Cron to start one.</div>`;
  }
  return `
    <div class="space-y-5">
      ${messages.map((message) => {
        const isUser = message.role === "user";
        const tone = message.status === "failed"
          ? "bg-error-container text-on-error-container"
          : isUser
            ? "bg-primary text-on-primary"
            : "bg-surface-container-low text-on-background";
        return `
          <div class="flex ${isUser ? "justify-end" : "justify-start"}">
            <div class="${isUser ? "max-w-[82%]" : "max-w-[88%]"}">
              <div class="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant/60 ${isUser ? "justify-end" : ""}">
                <span>${escapeHtml(message.title)}</span>
                <span>${escapeHtml(formatDateTime(message.ts))}</span>
                ${message.pending ? `<span class="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-primary">${icon("progress_activity", "text-[14px]")}Running</span>` : ""}
              </div>
              <div class="chat-bubble rounded-[24px] px-5 py-4 text-sm leading-7 shadow-[0_16px_32px_-24px_rgba(49,51,46,0.35)] ${isUser ? "rounded-br-lg" : "rounded-bl-lg"} ${tone}">
                ${escapeHtml(message.text)}
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderGlobalCronComposer() {
  if (!state.showDashboardCron) return "";
  const editingCron = state.editingDashboardCronId
    ? (state.snapshot?.crons || []).find((cron) => cron.cronId === state.editingDashboardCronId)
    : null;
  const courseId = state.drafts.quickCourseId || editingCron?.courseIds?.[0] || "";
  return `
    <form id="global-cron-form" class="space-y-4 rounded-2xl bg-surface-container-low px-4 py-4">
      ${renderCourseSelect("quickCourseId", courseId, { includeEmpty: true })}
      <input type="hidden" name="editingDashboardCronId" value="${escapeHtml(editingCron?.cronId || "")}" />
      <label class="grid gap-2">
        <span class="text-xs font-semibold text-on-surface-variant">Cron name</span>
        <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="quickCronTitle" value="${escapeHtml(state.drafts.quickCronTitle)}" />
      </label>
      <label class="grid gap-2">
        <span class="text-xs font-semibold text-on-surface-variant">Schedule rule</span>
        <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="quickCronSchedule" value="${escapeHtml(state.drafts.quickCronSchedule)}" />
      </label>
      <label class="grid gap-2">
        <span class="text-xs font-semibold text-on-surface-variant">Action to run</span>
        <textarea class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm leading-7 shadow-sm focus:border-primary focus:ring-primary/20 resize-none" name="quickCronPrompt" rows="5">${escapeHtml(state.drafts.quickCronPrompt)}</textarea>
      </label>
      <div class="flex flex-wrap items-center gap-3">
        <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm disabled:opacity-60" type="submit" ${state.submittingCronForm ? "disabled" : ""}>
          ${icon(state.submittingCronForm ? "progress_activity" : "save", "text-[18px]")}
          <span>${state.submittingCronForm ? "MentorClaw is processing" : editingCron ? "Save Cron" : "Create Cron"}</span>
        </button>
        <button class="rounded-xl px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-white" type="button" data-action="cancel-dashboard-cron-edit" ${state.submittingCronForm ? "disabled" : ""}>Cancel</button>
      </div>
    </form>
  `;
}

function renderObjectSearch(placeholder) {
  return `
    <label class="relative block min-w-[240px] flex-1 sm:max-w-[420px]">
      <span class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/60">${icon("search", "text-[18px]")}</span>
      <input class="w-full rounded-2xl border border-outline-variant/18 bg-white py-3 pl-11 pr-4 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="objectSearch" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(state.objectSearch)}" />
    </label>
  `;
}

function renderProjectsPage() {
  const projects = filteredProjects();
  return `
    <div class="flex h-screen overflow-hidden bg-background text-on-background">
      ${renderSidebar("projects")}
      <main class="min-w-0 flex-1 overflow-hidden">
        <section class="mx-auto flex h-full max-w-[1180px] flex-col px-6 py-8 lg:px-10">
          <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-on-surface-variant/60">Workspace Objects</p>
              <h2 class="mt-2 font-headline text-5xl font-bold tracking-tight">Projects</h2>
            </div>
            <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm" data-action="set-view" data-view="new-project">
              ${icon("note_stack_add", "text-[18px]")}
              <span>New Project</span>
            </button>
          </div>
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            ${renderObjectSearch("Search projects or chats...")}
            <span class="rounded-full bg-surface-container px-3 py-1 text-xs font-semibold text-on-surface-variant">${escapeHtml(String(projects.length))} projects</span>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
            <div class="grid gap-3">
              ${projects.length
                ? projects.map((project) => `
                  <button class="w-full rounded-[24px] border border-outline-variant/15 bg-surface-container-lowest px-5 py-5 text-left shadow-[0_18px_50px_-42px_rgba(49,51,46,0.35)] transition-all hover:border-primary/30 hover:bg-white" data-action="select-plan" data-plan-id="${escapeHtml(project.planId || project.projectId)}">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <h3 class="truncate font-headline text-2xl font-bold text-on-background">${escapeHtml(project.title)}</h3>
                          <span class="rounded-full bg-primary-container px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">${escapeHtml(project.projectStatus || project.status)}</span>
                        </div>
                        <p class="mt-2 line-clamp-2 text-sm leading-7 text-on-surface-variant">${escapeHtml(project.summary || "No project summary yet.")}</p>
                        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
                          <span>${escapeHtml(String(project.threads?.length || 0))} chats</span>
                          <span>${escapeHtml(String(project.courseIds?.length || 0))} courses</span>
                          <span>Updated ${escapeHtml(formatDateShort(project.updatedAt))}</span>
                        </div>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <span class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container text-primary">${icon("chevron_right", "text-[20px]")}</span>
                      </div>
                    </div>
                  </button>
                `).join("")
                : `<div class="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">No projects match the current search.</div>`}
            </div>
          </div>
        </section>
      </main>
      ${renderFlash()}
    </div>
  `;
}

function renderCronsPage() {
  const crons = filteredCrons();
  return `
    <div class="flex h-screen overflow-hidden bg-background text-on-background">
      ${renderSidebar("crons")}
      <main class="min-w-0 flex-1 overflow-hidden">
        <section class="mx-auto flex h-full max-w-[1180px] flex-col px-6 py-8 lg:px-10">
          <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-on-surface-variant/60">Automation Objects</p>
              <h2 class="mt-2 font-headline text-5xl font-bold tracking-tight">Crons</h2>
            </div>
            <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm" data-action="new-global-cron">
              ${icon("alarm_add", "text-[18px]")}
              <span>New Cron</span>
            </button>
          </div>
          ${renderGlobalCronComposer()}
          <div class="mb-4 mt-${state.showDashboardCron ? "6" : "0"} flex flex-wrap items-center justify-between gap-3">
            ${renderObjectSearch("Search crons, schedules, or prompts...")}
            <span class="rounded-full bg-surface-container px-3 py-1 text-xs font-semibold text-on-surface-variant">${escapeHtml(String(crons.length))} crons</span>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
            <div class="grid gap-3">
              ${crons.length
                ? crons.map((cron) => `
                  <button class="w-full rounded-[24px] border border-outline-variant/15 bg-surface-container-lowest px-5 py-5 text-left shadow-[0_18px_50px_-42px_rgba(49,51,46,0.35)] transition-all hover:border-primary/30 hover:bg-white" data-action="select-cron" data-cron-id="${escapeHtml(cron.cronId)}">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <h3 class="truncate font-headline text-2xl font-bold text-on-background">${escapeHtml(cron.title)}</h3>
                          ${cron.enabled === false ? `<span class="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant">Off</span>` : `<span class="rounded-full bg-primary-container px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">On</span>`}
                        </div>
                        <p class="mt-2 text-sm text-on-surface-variant">${escapeHtml(cron.schedule)}</p>
                        <p class="mt-2 line-clamp-2 text-sm leading-7 text-on-surface-variant/80">${escapeHtml(cron.prompt)}</p>
                        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
                          <span>${escapeHtml(cronCourseLabel(cron))}</span>
                          <span>${escapeHtml(String(cronRunsFor(cron.cronId).length))} records</span>
                          <span>Updated ${escapeHtml(formatDateShort(cron.updatedAt))}</span>
                        </div>
                      </div>
                      <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-container text-primary">${icon("chevron_right", "text-[20px]")}</span>
                    </div>
                  </button>
                `).join("")
                : `<div class="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">No crons match the current search.</div>`}
            </div>
          </div>
        </section>
      </main>
      ${renderFlash()}
    </div>
  `;
}

function renderCronDetailPage() {
  const cron = selectedCron();
  const runs = cron ? cronRunsFor(cron.cronId) : [];
  return `
    <div class="flex h-screen overflow-hidden bg-background text-on-background">
      ${renderSidebar("crons")}
      <main class="min-w-0 flex-1 overflow-hidden">
        <section class="mx-auto flex h-full max-w-[1180px] flex-col px-6 py-8 lg:px-10">
          <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-on-surface-variant/60">Automation</p>
              <h2 class="mt-2 font-headline text-5xl font-bold tracking-tight">Crons</h2>
            </div>
            <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm" data-action="new-global-cron">
              ${icon("alarm_add", "text-[18px]")}
              <span>New Cron</span>
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
            <section class="rounded-[28px] border border-outline-variant/15 bg-surface-container-lowest px-6 py-6 shadow-[0_26px_70px_-48px_rgba(49,51,46,0.3)]">
              ${state.showDashboardCron
                ? renderGlobalCronComposer()
                : cron
                  ? `
                    <div class="flex h-full min-h-[620px] flex-col">
                      <div class="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <h3 class="font-headline text-3xl font-bold">${escapeHtml(cron.title)}</h3>
                          <p class="mt-2 text-sm text-on-surface-variant">${escapeHtml(cron.schedule)}</p>
                          <p class="mt-1 text-xs text-on-surface-variant">${escapeHtml(cronCourseLabel(cron))}</p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                          <button class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-on-surface-variant shadow-sm hover:bg-surface-container hover:text-primary" data-action="edit-dashboard-cron" data-cron-id="${escapeHtml(cron.cronId)}" title="Edit Cron">${icon("edit", "text-[18px]")}</button>
                          <button class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-on-surface-variant shadow-sm hover:bg-surface-container hover:text-primary" data-action="toggle-dashboard-cron-enabled" data-cron-id="${escapeHtml(cron.cronId)}" title="${cron.enabled === false ? "Enable Cron" : "Disable Cron"}">${icon(cron.enabled === false ? "toggle_off" : "toggle_on", "text-[20px]")}</button>
                          <button class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#8A4B3A] shadow-sm hover:bg-surface-container" data-action="delete-dashboard-cron" data-cron-id="${escapeHtml(cron.cronId)}" title="Delete Cron">${icon("delete", "text-[18px]")}</button>
                          <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm disabled:cursor-not-allowed disabled:opacity-50" data-action="run-cron" data-cron-id="${escapeHtml(cron.cronId)}" ${cron.enabled === false || state.runningCronId === cron.cronId ? "disabled" : ""}>${icon(state.runningCronId === cron.cronId ? "progress_activity" : "play_arrow", "text-[18px]")}${state.runningCronId === cron.cronId ? "Running" : "Run"}</button>
                        </div>
                      </div>
                      <div class="mt-6 rounded-2xl bg-surface-container-low px-4 py-4">
                        <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/60">Prompt</p>
                        <p class="mt-3 whitespace-pre-wrap text-sm leading-7">${escapeHtml(cron.prompt)}</p>
                      </div>
                      <div class="mt-6 flex min-h-0 flex-1 flex-col space-y-4">
                        <div class="flex items-center justify-between gap-3">
                          <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/60">Conversation</p>
                          <span class="rounded-full bg-surface-container px-3 py-1 text-xs font-semibold text-on-surface-variant">${escapeHtml(String(runs.length))} records</span>
                        </div>
                        <div class="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                          ${renderCronConversation(cron, runs)}
                        </div>
                        <form id="cron-message-form" class="rounded-[24px] border border-outline-variant/20 bg-surface-container-low px-4 py-4">
                          <textarea class="w-full resize-none border-0 bg-transparent text-sm leading-7 focus:ring-0 placeholder:text-on-surface-variant/45" name="cronMessage" rows="3" placeholder="Ask MentorClaw about this Cron run...">${escapeHtml(state.drafts.cronMessage)}</textarea>
                          <div class="mt-3 flex justify-end">
                            <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm disabled:opacity-60" type="submit" ${state.sendingCronMessage || !cron ? "disabled" : ""}>
                              ${icon(state.sendingCronMessage ? "progress_activity" : "arrow_upward", "text-[18px]")}
                              <span>${state.sendingCronMessage ? "Sending" : "Send"}</span>
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  `
                  : `<div class="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">Create a cron to start collecting scheduled outputs.</div>`}
            </section>
          </div>
        </section>
      </main>
      ${renderFlash()}
    </div>
  `;
}

function renderNewProjectPage() {
  return `
    <div class="flex min-h-screen bg-background text-on-background">
      ${renderSidebar("new-project")}
      <main class="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
        <div class="mx-auto max-w-[760px] px-6 py-8 lg:px-10">
          <div class="mb-6 space-y-3">
            <p class="text-[10px] font-bold uppercase tracking-[0.26em] text-on-surface-variant/60">New Project</p>
            <h2 class="font-headline text-5xl font-bold tracking-tight">Create a course project</h2>
          </div>
          <form id="create-plan-form" class="space-y-6">
            <section class="rounded-[28px] border border-outline-variant/15 bg-surface-container-lowest px-6 py-6 shadow-[0_28px_70px_-44px_rgba(49,51,46,0.3)]">
              <div class="space-y-5">
                <div>
                  <label class="mb-3 block text-sm font-semibold text-on-background">Project title</label>
                  <input class="w-full rounded-2xl border border-outline-variant/18 bg-white px-5 py-4 text-lg font-semibold shadow-sm focus:border-primary focus:ring-primary/20" name="planTitle" value="${escapeHtml(state.drafts.planTitle)}" />
                </div>
                <div>
                  <label class="mb-3 block text-sm font-semibold text-on-background">Target course</label>
                  ${renderCourseSelect("planCourseId", state.drafts.planCourseId)}
                </div>
              </div>
            </section>
            <button class="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-on-primary shadow-sm hover:opacity-95" type="submit">${icon("auto_fix_high", "text-[18px]")}Initialize Project</button>
          </form>
        </div>
      </main>
      ${renderFlash()}
    </div>
  `;
}

function renderThreadForm() {
  if (!state.showCreateThread) return "";
  return `
    <form id="create-thread-form" class="space-y-5">
      <div class="paper-input rounded-xl overflow-hidden">
        <input class="w-full bg-transparent border-0 py-4 px-5 text-lg font-headline focus:ring-0 placeholder:text-outline-variant/40" name="threadTitle" placeholder="Conversation title" value="${escapeHtml(state.drafts.threadTitle)}" />
      </div>
      <div class="paper-input rounded-xl overflow-hidden">
        <textarea class="w-full bg-transparent border-0 py-4 px-5 text-base leading-relaxed focus:ring-0 placeholder:text-outline-variant/40 resize-none" name="threadQuestion" rows="4" placeholder="Opening question or task for MentorClaw...">${escapeHtml(state.drafts.threadQuestion)}</textarea>
      </div>
      <div class="flex items-center justify-between">
        <button class="text-on-surface-variant hover:text-primary transition-colors font-body text-sm font-medium" type="button" data-action="close-thread-form">Cancel</button>
        <button class="bg-primary text-on-primary px-5 py-3 rounded-xl font-body font-semibold text-sm shadow-sm hover:shadow-md transition-all" type="submit">Create Chat</button>
      </div>
    </form>
  `;
}

function renderProjectHistory(plan) {
  if (!plan?.threads?.length) {
    return `<div class="py-6 text-on-surface-variant text-sm">No conversations yet.</div>`;
  }
  const extraSessionsExpanded = projectExtraSessionsExpanded(plan.planId);
  const visibleThreads = extraSessionsExpanded ? plan.threads : plan.threads.slice(0, DEFAULT_VISIBLE_PROJECT_SESSIONS);
  const hiddenSessionCount = Math.max(plan.threads.length - DEFAULT_VISIBLE_PROJECT_SESSIONS, 0);
  return `
    <div class="space-y-0 border-t border-outline-variant/10">
      ${visibleThreads
        .map(
          (thread) => `
            <button class="archive-item group py-4 flex justify-between items-start hover:bg-surface-container-lowest/50 transition-colors px-2 rounded-lg -mx-2 w-full text-left ${
              thread.threadId === state.selectedThreadId ? "bg-surface-container-low/60" : ""
            }" data-action="select-thread" data-plan-id="${escapeHtml(plan.planId)}" data-thread-id="${escapeHtml(thread.threadId)}">
              <div class="flex-1 min-w-0 pr-4">
                <h4 class="font-headline text-base font-semibold text-on-surface truncate">${escapeHtml(thread.title)}</h4>
                <p class="text-on-surface-variant text-sm line-clamp-1 mt-0.5 opacity-70">${escapeHtml(compactText(thread.currentQuestion || thread.summary || "No summary yet.", 120))}</p>
                <div class="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-on-surface-variant/50">
                  <span>${thread.boundSessions.length} sessions</span>
                  <span>${thread.workingMemory.length} memory lines</span>
                </div>
              </div>
              <span class="text-[11px] font-medium text-on-surface-variant/50 whitespace-nowrap pt-1">${escapeHtml(formatDateShort(thread.updatedAt))}</span>
            </button>
          `,
        )
        .join("")}
      ${hiddenSessionCount
        ? `<button class="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-outline-variant/15 bg-white/60 px-3 py-3 text-sm font-semibold text-primary hover:bg-surface-container-lowest" data-action="toggle-project-session-overflow" data-plan-id="${escapeHtml(plan.planId)}">
            ${icon(extraSessionsExpanded ? "expand_less" : "expand_more", "text-[18px]")}
            <span>${extraSessionsExpanded ? "Show fewer sessions" : `Show ${hiddenSessionCount} more sessions`}</span>
          </button>`
        : ""}
    </div>
  `;
}

function renderBindingPanel(plan, thread, binding) {
  const memoryPath = thread?.localFiles?.find((file) => file.label === "Working Memory")?.relativePath || "No thread file yet";
  return `
    <section class="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-[0_16px_40px_-24px_rgba(49,51,46,0.24)]">
      <div class="flex items-center justify-between gap-4 mb-5">
        <div>
          <h3 class="font-headline text-2xl font-bold">Session Binding</h3>
          <p class="text-sm text-on-surface-variant mt-1">Every conversation maps to a specific runtime thread and local file set.</p>
        </div>
        <span class="px-3 py-1 rounded-full bg-surface-container text-primary text-[10px] uppercase tracking-[0.2em] font-bold">${binding ? "Bound" : "Unbound"}</span>
      </div>
      <div class="space-y-4">
        <div class="paper-input rounded-xl overflow-hidden">
          <input class="w-full bg-transparent border-0 py-4 px-5 text-sm font-body focus:ring-0 placeholder:text-outline-variant/40" name="sessionKey" placeholder="browser-..." value="${escapeHtml(state.sessionKey)}" />
        </div>
        <div class="flex flex-wrap gap-3">
          <button class="px-4 py-2 rounded-full bg-surface-container text-on-surface text-sm font-semibold hover:bg-surface-container-high transition-all" data-action="new-session">New Session Key</button>
          <button class="px-4 py-2 rounded-full bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-all" data-action="bind-session" ${plan && thread ? "" : "disabled"}>Bind</button>
          <button class="px-4 py-2 rounded-full bg-tertiary-container text-on-tertiary-container text-sm font-semibold hover:opacity-90 transition-all" data-action="unbind-session" ${state.sessionKey ? "" : "disabled"}>Unbind</button>
        </div>
        ${
          thread?.boundSessions?.length
            ? `<div class="flex flex-wrap gap-2">${thread.boundSessions
                .map(
                  (item) => `
                    <button class="px-3 py-2 rounded-full text-xs font-bold tracking-wide transition-all ${
                      item.sessionKey === state.sessionKey ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                    }" data-action="select-session" data-session-key="${escapeHtml(item.sessionKey)}">${escapeHtml(compactText(item.sessionKey, 20))}</button>
                  `,
                )
                .join("")}</div>`
            : ""
        }
        ${
          binding
            ? `
              <div class="grid gap-3 sm:grid-cols-2 text-sm">
                <div class="rounded-xl bg-surface-container-low p-4"><p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-2">Plan</p><p class="font-semibold">${escapeHtml(binding.planId)}</p></div>
                <div class="rounded-xl bg-surface-container-low p-4"><p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-2">Thread</p><p class="font-semibold">${escapeHtml(binding.threadId)}</p></div>
                <div class="rounded-xl bg-surface-container-low p-4"><p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-2">Workflow</p><p class="font-semibold">${escapeHtml(binding.lastWorkflow)}</p></div>
                <div class="rounded-xl bg-surface-container-low p-4"><p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-2">Memory Target</p><p class="font-semibold break-all">${escapeHtml(memoryPath)}</p></div>
              </div>
            `
            : '<div class="rounded-xl bg-surface-container-low p-4 text-sm text-on-surface-variant">No session is bound yet. Binding a session will make this conversation discoverable from the external client.</div>'
        }
      </div>
    </section>
  `;
}

function renderMemoryPanel(thread) {
  if (!thread) {
    return `<section class="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6"><h3 class="font-headline text-2xl font-bold">Working Memory</h3><p class="mt-3 text-sm text-on-surface-variant">Select a conversation to inspect its memory and write back assistant replies.</p></section>`;
  }
  const memoryTarget = thread.localFiles.find((file) => file.label === "Working Memory")?.relativePath || "No working memory file";
  return `
    <section class="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-[0_16px_40px_-24px_rgba(49,51,46,0.24)]">
      <div class="flex items-center justify-between gap-4 mb-5">
        <div>
          <h3 class="font-headline text-2xl font-bold">Working Memory</h3>
          <p class="text-sm text-on-surface-variant mt-1">The lines below are persisted inside the selected thread, not mocked in the browser.</p>
        </div>
        <span class="px-3 py-1 rounded-full bg-surface-container text-primary text-[10px] uppercase tracking-[0.2em] font-bold">${thread.workingMemory.length} lines</span>
      </div>
      <div class="space-y-3">
        ${thread.workingMemory.length
          ? thread.workingMemory.map((line) => `<div class="rounded-xl bg-surface-container-low px-4 py-3 text-sm leading-relaxed">${escapeHtml(line)}</div>`).join("")
          : '<div class="rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">No memory lines have been recorded yet.</div>'}
      </div>
      <div class="mt-6 space-y-4">
        <div>
          <h4 class="font-headline text-xl font-semibold">Assistant Reply Sync</h4>
          <p class="text-sm text-on-surface-variant mt-1">Normal sends now write back automatically into <span class="font-semibold text-on-background">${escapeHtml(memoryTarget)}</span>. Use the box below only if you want to manually override or append a reply.</p>
        </div>
        <form id="assistant-reply-form" class="space-y-4">
          <div class="paper-input rounded-xl overflow-hidden">
            <textarea class="w-full bg-transparent border-0 py-4 px-5 text-base leading-relaxed focus:ring-0 placeholder:text-outline-variant/40 resize-none" name="assistantMessage" rows="4" placeholder="Optional manual reply override...">${escapeHtml(state.drafts.assistantMessage)}</textarea>
          </div>
          <button class="bg-primary text-on-primary px-5 py-3 rounded-xl font-body font-semibold text-sm shadow-sm hover:shadow-md transition-all" type="submit">Write Reply</button>
        </form>
      </div>
    </section>
  `;
}

function renderFilesPanel(plan, thread) {
  const sections = currentFileSections(plan, thread);
  const fileRecord = state.fileCache[state.activeFilePath];
  return `
    <section id="sources-section" class="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-[0_16px_40px_-24px_rgba(49,51,46,0.24)]">
      <div class="flex items-center justify-between gap-4 mb-5">
        <div>
          <h3 class="font-headline text-2xl font-bold">Sources & Local Files</h3>
          <p class="text-sm text-on-surface-variant mt-1">This is the actual local correspondence for the selected plan and conversation.</p>
        </div>
        <span class="px-3 py-1 rounded-full bg-surface-container text-primary text-[10px] uppercase tracking-[0.2em] font-bold">${sections.reduce((total, section) => total + section.items.length, 0)} files</span>
      </div>
      <div class="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div class="space-y-5 max-h-[520px] overflow-y-auto custom-scrollbar pr-1">
          ${sections
            .map(
              (section) => `
                <div>
                  <p class="mb-3 text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60 font-bold">${escapeHtml(section.title)}</p>
                  <div class="space-y-2">
                    ${section.items
                      .map(
                        (file) => `
                          <button class="w-full text-left rounded-xl border px-4 py-3 transition-all ${
                            file.absolutePath === state.activeFilePath ? "border-primary bg-primary-container/45" : "border-outline-variant/20 bg-surface-container-low hover:bg-surface-container"
                          }" data-action="open-file" data-path="${escapeHtml(file.absolutePath)}">
                            <div class="font-semibold text-sm">${escapeHtml(file.label)}</div>
                            <div class="mt-1 text-[11px] leading-relaxed text-on-surface-variant break-all">${escapeHtml(file.relativePath)}</div>
                          </button>
                        `,
                      )
                      .join("")}
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
        <div class="rounded-2xl bg-surface-container-low border border-outline-variant/15 overflow-hidden min-h-[360px]">
          <div class="px-5 py-4 border-b border-outline-variant/10 bg-white/50">
            <h4 class="font-headline text-xl font-semibold">${escapeHtml(fileRecord?.relativePath || "Select a file")}</h4>
            <p class="mt-1 text-xs text-on-surface-variant break-all">${escapeHtml(fileRecord?.absolutePath || "Choose a file from the left to preview its current disk content.")}</p>
          </div>
          <div class="p-5 max-h-[420px] overflow-auto custom-scrollbar">
            ${
              state.loadingFilePath === state.activeFilePath
                ? '<div class="text-sm text-on-surface-variant">Loading file preview...</div>'
                : fileRecord
                  ? `<pre class="code-preview text-sm leading-7">${escapeHtml(fileRecord.content)}</pre>`
                  : '<div class="text-sm text-on-surface-variant">No file selected yet.</div>'
            }
          </div>
        </div>
      </div>
    </section>
  `;
}

function isPanelCollapsed(key) {
  return Boolean(state.collapsedPanels[key]);
}

function renderCollapsiblePanel(key, title, subtitle, content, options = {}) {
  const collapsed = isPanelCollapsed(key);
  const count = options.count ? `<span class="px-3 py-1 rounded-full bg-surface-container text-primary text-[10px] uppercase tracking-[0.2em] font-bold">${escapeHtml(options.count)}</span>` : "";
  return `
    <section class="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl overflow-hidden shadow-[0_16px_40px_-24px_rgba(49,51,46,0.24)]" id="${escapeHtml(options.id || "")}">
      <button class="w-full flex items-start justify-between gap-4 px-6 py-5 text-left hover:bg-surface-container-low/35 transition-colors" data-action="toggle-panel" data-panel="${escapeHtml(key)}">
        <div>
          <h3 class="font-headline text-2xl font-bold">${escapeHtml(title)}</h3>
          <p class="text-sm text-on-surface-variant mt-1">${escapeHtml(subtitle)}</p>
        </div>
        <div class="flex items-center gap-3">
          ${count}
          <span class="flex h-9 w-9 items-center justify-center rounded-full bg-surface-container text-primary">${icon(collapsed ? "add" : "remove")}</span>
        </div>
      </button>
      ${collapsed ? "" : `<div class="px-6 pb-6">${content}</div>`}
    </section>
  `;
}

function renderThreadSummaryPanel(thread) {
  if (!thread) {
    return `<div class="rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">Select a conversation to inspect its current question, status, and recent runtime changes.</div>`;
  }
  return `
    <div class="space-y-4">
      <div class="rounded-xl bg-surface-container-low px-4 py-4">
        <p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-2">Current Question</p>
        <p class="text-sm leading-7">${escapeHtml(latestUserQuestion(thread))}</p>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 text-sm">
        <div class="rounded-xl bg-surface-container-low p-4">
          <p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-2">Status</p>
          <p class="font-semibold">${escapeHtml(thread.status)}</p>
        </div>
        <div class="rounded-xl bg-surface-container-low p-4">
          <p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-2">Updated</p>
          <p class="font-semibold">${escapeHtml(formatDateTime(thread.updatedAt))}</p>
        </div>
      </div>
      <div class="rounded-xl bg-surface-container-low px-4 py-4">
        <p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-2">Summary</p>
        <p class="text-sm leading-7 text-on-surface-variant">${escapeHtml(thread.summary || "No summary yet.")}</p>
      </div>
    </div>
  `;
}

function workflowLabel(workflow) {
  const labels = {
    planning: "Planning",
    tutoring: "Tutoring",
    evaluation: "Evaluation",
    review: "Review",
    replanning: "Replanning",
    "manual-bind": "Manual Bind",
  };
  return labels[workflow] || workflow || "Session";
}

function extractUserMessage(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "```" && !line.startsWith("[message_id:"));
  const candidate = lines.at(-1) || String(text ?? "").trim();
  const stripped = candidate.replace(/^[^:]{1,24}:\s*/, "");
  return stripped || candidate;
}

function buildTranscript(thread) {
  if (!thread) return [];
  const items = [];
  const seen = new Set();
  const push = (role, text, ts, tone = "default") => {
    const content = String(text ?? "").trim();
    if (!content) return;
    const key = `${role}:${content}:${ts || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ role, text: content, ts, tone });
  };

  for (const event of [...(thread.events || [])].reverse()) {
    if (event.type === "turn_processed") {
      push("user", extractUserMessage(event.evidence?.[0] || ""), event.ts);
      continue;
    }
    if (event.type === "assistant_reply_recorded") {
      push("assistant", event.evidence?.[0] || event.impact, event.ts);
      continue;
    }
    if (event.type === "assistant_reply_failed") {
      push("system", event.error || event.impact || "Assistant reply failed.", event.ts, "error");
    }
  }

  if (!items.length) {
    if (thread.currentQuestion) push("user", thread.currentQuestion, thread.createdAt);
    const lastAssistant = [...(thread.workingMemory || [])]
      .reverse()
      .find((line) => line.startsWith("Assistant reply:"));
    if (lastAssistant) push("assistant", lastAssistant.replace(/^Assistant reply:\s*/, ""), thread.updatedAt);
  }

  return items;
}

function latestUserQuestion(thread) {
  const transcript = buildTranscript(thread);
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (transcript[index].role === "user") return transcript[index].text;
  }
  return thread?.currentQuestion || "No question recorded yet.";
}

function renderTranscript(thread, binding) {
  const messages = buildTranscript(thread);
  if (state.submittingTurn && state.pendingTurnMessage) {
    messages.push({
      role: "user",
      text: state.pendingTurnMessage,
      ts: new Date().toISOString(),
      pending: true,
    });
    messages.push({
      role: "assistant",
      text: "MentorClaw is aligning this turn with the runtime, session binding, and working memory...",
      ts: new Date().toISOString(),
      pending: true,
    });
  }

  if (!thread) {
    return `
      <div class="h-full min-h-[360px]"></div>
    `;
  }

  if (!messages.length) {
    return `
      <div class="h-full min-h-[320px]"></div>
    `;
  }

  return `
    <div class="space-y-6">
      ${messages
        .map((message) => {
          if (message.role === "user") {
            return `
              <div class="flex justify-end">
                <div class="max-w-[82%]">
                  <div class="mb-2 flex items-center justify-end gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">
                    <span>You</span>
                    <span>${escapeHtml(formatDateTime(message.ts))}</span>
                  </div>
                  <div class="chat-bubble rounded-[28px] rounded-br-lg bg-primary px-5 py-4 text-sm leading-7 text-on-primary shadow-[0_16px_32px_-20px_rgba(85,99,67,0.65)] ${message.pending ? "opacity-70" : ""}">${escapeHtml(message.text)}</div>
                </div>
              </div>
            `;
          }

          const tone =
            message.tone === "error"
              ? "bg-error-container text-on-error-container"
              : "bg-surface-container-low text-on-surface";
          const title = message.role === "system" ? "Runtime" : "MentorClaw";
          return `
            <div class="flex justify-start">
              <div class="flex max-w-[88%] gap-3">
                <div class="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${message.tone === "error" ? "bg-error-container text-on-error-container" : "bg-primary-container text-primary"}">
                  ${icon(message.role === "system" ? "warning" : "school", "text-[20px]")}
                </div>
                <div class="min-w-0">
                  <div class="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">
                    <span>${title}</span>
                    <span>${escapeHtml(formatDateTime(message.ts))}</span>
                    ${message.role === "assistant" ? `<span class="rounded-full bg-white px-2 py-1 text-primary">${escapeHtml(workflowLabel(binding?.lastWorkflow))}</span>` : ""}
                    ${message.pending ? '<span class="rounded-full bg-white px-2 py-1 text-primary">Thinking</span>' : ""}
                  </div>
                  <div class="chat-bubble rounded-[28px] rounded-bl-lg px-5 py-4 text-sm leading-7 shadow-[0_16px_32px_-24px_rgba(49,51,46,0.35)] ${tone}">${escapeHtml(message.text)}</div>
                </div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderProjectCronShelf(plan) {
  const planCrons = getPlanCrons(plan);
  return `
    <section class="rounded-[22px] border border-outline-variant/16 bg-surface-container-low px-4 py-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/60">Project Cron</p>
          <h4 class="mt-1 font-headline text-xl font-bold text-on-background">${escapeHtml(planCrons.length ? `${planCrons.length} active` : "No Cron yet")}</h4>
        </div>
        <button class="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-on-background shadow-sm ring-1 ring-outline-variant/15 hover:bg-surface-container-lowest" data-action="toggle-cron-composer">
          ${icon(state.showCronComposer ? "close" : "alarm_add", "text-[18px]")}
          <span>${state.showCronComposer ? "Close" : "New Cron"}</span>
        </button>
      </div>
      ${
        state.showCronComposer
          ? `
            <form id="cron-form" class="mt-4 space-y-3 rounded-2xl bg-white/65 px-4 py-4 ring-1 ring-outline-variant/12">
              <label class="grid gap-2">
                <span class="text-xs font-semibold text-on-surface-variant">Cron name</span>
                <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="cronTitle" value="${escapeHtml(state.drafts.cronTitle)}" />
              </label>
              <label class="grid gap-2">
                <span class="text-xs font-semibold text-on-surface-variant">Schedule rule</span>
                <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="cronSchedule" value="${escapeHtml(state.drafts.cronSchedule)}" />
              </label>
              <label class="grid gap-2">
                <span class="text-xs font-semibold text-on-surface-variant">Action to run</span>
                <textarea class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm leading-7 shadow-sm focus:border-primary focus:ring-primary/20 resize-none" name="cronPrompt" rows="3">${escapeHtml(state.drafts.cronPrompt)}</textarea>
              </label>
              <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-sm" type="submit">${icon("schedule_send", "text-[18px]")}Create Cron</button>
            </form>
          `
          : ""
      }
      <div class="mt-4 grid max-h-44 gap-2 overflow-y-auto pr-1 custom-scrollbar md:grid-cols-2">
        ${
          planCrons.length
            ? planCrons
                .map(
                  (cron) => `
                    <article class="rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-outline-variant/10">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <h5 class="truncate text-sm font-bold text-on-background">${escapeHtml(cron.title)}</h5>
                          <p class="mt-1 line-clamp-1 text-xs text-on-surface-variant">${escapeHtml(cron.schedule || cron.scheduleRule?.kind || "Manual")}</p>
                        </div>
                        <button class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-background hover:bg-primary hover:text-on-primary" data-action="run-cron" data-cron-id="${escapeHtml(cron.cronId)}" title="Run now">
                          ${icon("play_arrow", "text-[18px]")}
                        </button>
                      </div>
                    </article>
                  `,
                )
                .join("")
            : `<div class="rounded-2xl bg-white/60 px-4 py-3 text-sm text-on-surface-variant md:col-span-2">Add a Cron when this project needs automatic review or reminders.</div>`
        }
      </div>
    </section>
  `;
}

function renderProjectConversation(plan, thread, binding, placeholder) {
  const shouldShowTranscript = Boolean(thread) || state.submittingTurn;
  return `
    <section class="project-chat-panel overflow-hidden">
      ${
        shouldShowTranscript
          ? `
            <div id="chat-feed" class="chat-feed custom-scrollbar px-1 py-4 md:px-2 md:py-5">
              ${renderTranscript(thread, binding)}
            </div>
          `
          : ""
      }
      <div class="${shouldShowTranscript ? "border-t border-outline-variant/10" : ""} bg-background/95 px-1 pb-1 pt-4 backdrop-blur-sm md:px-2">
        <div class="mb-4 space-y-3">
          ${renderResourceComposer(plan)}
        </div>
        <form id="user-turn-form" class="rounded-[24px] border border-outline-variant/20 bg-surface-container-low shadow-[0_16px_40px_-28px_rgba(49,51,46,0.35)] transition-all focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
          <div class="flex items-center justify-end gap-3 border-b border-outline-variant/10 px-4 py-3">
            <button class="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-on-background shadow-sm ring-1 ring-outline-variant/15 hover:bg-surface-container-lowest" type="button" data-action="toggle-resource-composer">${icon("attach_file", "text-[18px]")}${escapeHtml(t("addResource"))}</button>
          </div>
          <div class="flex items-end gap-3 p-4">
            <textarea class="flex-1 bg-transparent border-none focus:ring-0 text-on-surface text-base resize-none py-1 placeholder:text-on-surface-variant/40 custom-scrollbar max-h-48" name="userMessage" rows="3" placeholder="${escapeHtml(placeholder)}" ${state.submittingTurn ? "disabled" : ""}>${escapeHtml(state.drafts.userMessage)}</textarea>
            <button class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary shadow-md transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50" type="submit" ${state.submittingTurn ? "disabled" : ""}>
              ${state.submittingTurn ? icon("progress_activity") : icon("arrow_upward")}
            </button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderProjectPage() {
  const plan = getSelectedPlan();
  const thread = getSelectedThread();
  const binding = getSelectedBinding();
  const placeholder = plan ? `Ask MentorClaw anything about ${plan.title}...` : "Ask MentorClaw anything...";

  return `
    <div class="flex h-screen bg-background text-on-background overflow-hidden">
      ${renderSidebar("project")}
      <main class="flex-1 flex flex-col min-w-0 relative h-screen">
        <header class="flex justify-between items-center px-6 py-4 w-full bg-background border-b border-surface-container-low lg:px-8">
          <div class="min-w-0">
            <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/55">Project</p>
            <h2 class="truncate font-headline font-bold text-2xl text-primary leading-tight">${escapeHtml(plan?.title || "Project")}</h2>
            <p class="font-body text-[11px] text-on-surface-variant/70 tracking-wide">${escapeHtml(plan ? `${plan.courseIds?.length || 0} course bindings` : "Select a project from the left rail")}</p>
          </div>
          <div class="flex items-center gap-2">
            <button class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-container text-on-surface-variant hover:text-primary transition-colors" data-action="refresh" title="Refresh">${icon("refresh")}</button>
            <div class="w-10 h-10 rounded-full bg-primary-container overflow-hidden ring-2 ring-surface-container flex items-center justify-center text-primary font-bold">${escapeHtml(learnerName().slice(0, 1))}</div>
          </div>
        </header>
        <div id="project-page-scroll" class="flex-1 overflow-y-auto custom-scrollbar">
          <div class="mx-auto flex min-h-full max-w-[1120px] flex-col px-6 py-6 lg:px-8">
            ${renderCronSummaryCard()}
            ${renderProjectConversation(plan, thread, binding, placeholder)}
          </div>
        </div>
      </main>
      ${renderFlash()}
    </div>
  `;
}

const WEEKDAY_LABELS = ["鍛ㄤ竴", "鍛ㄤ簩", "鍛ㄤ笁", "鍛ㄥ洓", "鍛ㄤ簲", "鍛ㄥ叚", "鍛ㄦ棩"];

function startOfWeek(referenceDate) {
  const start = new Date(referenceDate);
  const day = start.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + delta);
  start.setHours(0, 0, 0, 0);
  return start;
}

function shiftDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function resolvedCourseItemTitle(item) {
  return item.manualTitle || item.title || "Untitled course item";
}

function resolvedCourseItemStart(item) {
  return item.manualStartAt || item.startAt || item.dueAt || null;
}

function scheduleEntryToneFromCourseType(type) {
  if (type === "assignment" || type === "exam") return "tertiary";
  if (type === "class" || type === "notice") return "secondary";
  return "primary";
}

function scheduleEntryMetaFromCourseItem(item, courseTitle) {
  const parts = [];
  if (courseTitle) parts.push(courseTitle);
  if (item.type === "assignment" && item.dueAt) {
    parts.push(`Due ${formatDateTime(item.dueAt)}`);
  } else if (item.type === "class" && (item.manualLocation || item.location)) {
    parts.push(item.manualLocation || item.location);
  } else if (item.type === "replay") {
    parts.push("Replay and materials ready");
  } else if (item.type === "notice") {
    parts.push("Course notice");
  } else if (item.type === "exam" && item.dueAt) {
    parts.push(`Exam window ${formatDateTime(item.dueAt)}`);
  }
  if (item.manualNote) parts.push(item.manualNote);
  if (item.body) parts.push(compactText(item.body, 84));
  return parts.filter(Boolean).join(" · ");
}

function collectScheduleEntries() {
  const start = startOfWeek(new Date());
  const end = shiftDays(start, 6);
  end.setHours(23, 59, 59, 999);
  const entries = [];
  const pushEntry = (title, detail, when, tone = "primary", source = "runtime") => {
    if (!when) return;
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || date < start || date > end) return;
    entries.push({
      title,
      detail,
      when: date,
      dayIndex: Math.max(0, Math.min(6, (date.getDay() + 6) % 7)),
      tone,
      source,
    });
  };
  for (const plan of state.snapshot?.plans || []) {
    for (const task of plan.tasks || []) pushEntry(task.title, `${plan.title} · ${task.status}`, task.dueAt, task.status === "blocked" ? "tertiary" : "primary");
    for (const milestone of plan.milestones || []) pushEntry(milestone.title, `${plan.title} milestone`, milestone.dueAt, "secondary");
    for (const event of plan.events || []) pushEntry(event.type.replaceAll("_", " "), `${plan.title} · ${event.impact}`, event.ts, "secondary");
    for (const thread of plan.threads || []) for (const event of thread.events || []) pushEntry(event.type.replaceAll("_", " "), `${thread.title} · ${event.impact}`, event.ts, "primary");
  }
  for (const event of state.snapshot?.learnerEvents || []) pushEntry(event.type.replaceAll("_", " "), event.impact, event.ts, "tertiary");

  const education = state.snapshot?.education;
  const courseMap = new Map((education?.courses || []).map((course) => [course.id, course]));
  for (const item of education?.courseItems || []) {
    if (item.isHidden) continue;
    if (!education?.schedulePreferences?.showTimetableInSchedule && item.type === "class") continue;
    pushEntry(
      resolvedCourseItemTitle(item),
      scheduleEntryMetaFromCourseItem(item, courseMap.get(item.courseId)?.title || ""),
      resolvedCourseItemStart(item),
      scheduleEntryToneFromCourseType(item.type),
      "education",
    );

    if (item.type === "assignment" && item.dueAt) {
      const reminderAt = new Date(item.dueAt);
      if (!Number.isNaN(reminderAt.getTime())) {
        reminderAt.setDate(reminderAt.getDate() - 1);
        reminderAt.setHours(20, 0, 0, 0);
        pushEntry(
          `${resolvedCourseItemTitle(item)} Reminder`,
          `${courseMap.get(item.courseId)?.title || "Course"} · Submit tomorrow before ${formatClock(item.dueAt)}`,
          reminderAt.toISOString(),
          "tertiary",
          "education",
        );
      }
    }
  }

  return { entries: entries.sort((left, right) => left.when - right.when).slice(0, 24), start, end };
}

function renderLegacySchedulePage() {
  const { entries, start, end } = collectScheduleEntries();
  const days = Array.from({ length: 7 }, (_, index) => shiftDays(start, index));
  const todayKey = isoDateKey(new Date());
  const todayIndex = days.findIndex((day) => isoDateKey(day) === todayKey);
  const educationEntries = entries.filter((entry) => entry.source === "education");
  const runtimeEntries = entries.filter((entry) => entry.source !== "education");
  const tones = {
    primary: "bg-primary/10 border-primary text-primary",
    secondary: "bg-secondary-container/70 border-[#7b806f] text-[#4d5148]",
    tertiary: "bg-tertiary-container/70 border-[#9a7e60] text-[#6f5c45]",
  };
  return `
    <div class="bg-background text-on-surface antialiased flex min-h-screen">
      ${renderSidebar("schedule")}
      <main class="flex-1 flex flex-col h-screen overflow-hidden">
        <header class="flex justify-between items-center px-8 py-4 w-full sticky top-0 z-50 bg-background/80 backdrop-blur-md">
          <nav class="hidden md:flex items-center gap-6">
            <button class="font-headline font-medium text-lg tracking-tight text-on-surface-variant hover:text-primary transition-colors" data-action="set-view" data-view="dashboard">Chat</button>
            <button class="font-headline font-medium text-lg tracking-tight text-on-surface-variant hover:text-primary transition-colors" data-action="set-view" data-view="new-project">Plan</button>
            <button class="font-headline font-medium text-lg tracking-tight text-on-surface-variant hover:text-primary transition-colors" data-action="set-view" data-view="project">Resources</button>
            <button class="font-headline font-medium text-lg tracking-tight text-primary border-b-2 border-primary pb-1" data-action="set-view" data-view="schedule">Calendar</button>
          </nav>
          <div class="flex items-center gap-4">
            <button class="text-on-surface-variant hover:text-primary transition-colors p-2 cursor-pointer" data-action="refresh">${icon("notifications")}</button>
            <div class="w-8 h-8 rounded-full overflow-hidden bg-surface-container border border-outline-variant/20 flex items-center justify-center text-primary font-bold">${escapeHtml(learnerName().slice(0, 1))}</div>
          </div>
        </header>
        <div class="flex-1 overflow-y-auto px-8 pb-12 custom-scrollbar">
          <div class="max-w-[1200px] mx-auto mt-8">
            <div class="flex items-end justify-between mb-10">
              <div class="space-y-1">
                <h2 class="font-headline text-4xl font-bold tracking-tight">Your Academic Rhythm</h2>
                <p class="font-body text-on-surface-variant">${escapeHtml(formatDateShort(start.toISOString(), "en-US", { month: "long", day: "numeric" }))} - ${escapeHtml(formatDateShort(end.toISOString(), "en-US", { month: "long", day: "numeric", year: "numeric" }))}</p>
              </div>
              <div class="flex items-center gap-3 bg-surface-container-low p-1.5 rounded-full">
                <button class="p-2 hover:bg-white rounded-full transition-all flex items-center justify-center" data-action="schedule-prev">${icon("chevron_left", "text-sm")}</button>
                <button class="text-sm font-bold px-2" data-action="schedule-today">Today</button>
                <button class="p-2 hover:bg-white rounded-full transition-all flex items-center justify-center" data-action="schedule-next">${icon("chevron_right", "text-sm")}</button>
              </div>
            </div>
            <div class="bg-surface-container-lowest rounded-xl shadow-[0_32px_64px_-12px_rgba(49,51,46,0.04)] overflow-hidden flex flex-col h-[700px] border border-outline-variant/10">
              <div class="grid grid-cols-[100px_repeat(7,1fr)] border-b border-outline-variant/10 bg-surface-container-low">
                <div class="p-4"></div>
                ${days
                  .map(
                    (day, index) => `
                      <div class="p-4 text-center border-l border-outline-variant/10 ${index === todayIndex ? "bg-white/40" : ""}">
                        <p class="text-[10px] font-bold uppercase tracking-widest ${index === todayIndex ? "text-primary" : "text-on-surface-variant/60"}">${escapeHtml(day.toLocaleDateString("en-US", { weekday: "short" }))}</p>
                        <p class="text-xl font-headline font-bold mt-1 ${index === todayIndex ? "text-primary" : ""}">${day.getDate()}</p>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
              <div class="flex-1 overflow-y-auto learning-grid relative custom-scrollbar">
                <div class="grid grid-cols-[100px_repeat(7,1fr)] min-h-[1200px]">
                  <div class="flex flex-col text-right pr-4 text-[10px] font-bold tracking-tighter text-on-surface-variant/40 pt-10 gap-[44px]">
                    ${Array.from({ length: 13 }, (_, offset) => new Date(2026, 0, 1, 8 + offset, 0, 0).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })).map((label) => `<div>${escapeHtml(label)}</div>`).join("")}
                  </div>
                  ${days
                    .map(
                      (_, index) => `
                        <div class="border-l border-outline-variant/10 relative">
                          ${entries
                            .filter((entry) => entry.dayIndex === index)
                            .map((entry) => {
                              const hour = entry.when.getHours() + entry.when.getMinutes() / 60;
                              const top = Math.max(16, Math.min(1080, 40 + (hour - 8) * 48));
                              return `
                                <div class="absolute left-1 right-1 rounded-md p-3 flex flex-col gap-1 transition-transform hover:scale-[1.02] cursor-pointer shadow-sm border-l-4 ${tones[entry.tone] || tones.primary}" style="top:${top}px; height:112px;">
                                  <span class="text-[10px] font-bold uppercase tracking-wide">${escapeHtml(formatClock(entry.when))}</span>
                                  <strong class="text-sm leading-tight">${escapeHtml(entry.title)}</strong>
                                  <p class="text-[11px] leading-snug opacity-80">${escapeHtml(compactText(entry.detail, 70))}</p>
                                </div>
                              `;
                            })
                            .join("")}
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              </div>
            </div>
            <div class="mt-8 grid gap-6 md:grid-cols-2">
              <section class="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 p-6">
                <h3 class="font-headline text-2xl font-bold">This Week's Signals</h3>
                <div class="mt-4 space-y-3">
                  ${entries.length
                    ? entries.slice(0, 4).map((entry) => `
                        <div class="rounded-xl bg-surface-container-low px-4 py-3">
                          <div class="flex items-center justify-between gap-3">
                            <strong class="text-sm">${escapeHtml(entry.title)}</strong>
                            <span class="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">${escapeHtml(formatDateShort(entry.when.toISOString()))}</span>
                          </div>
                          <p class="mt-1 text-sm text-on-surface-variant">${escapeHtml(compactText(entry.detail, 88))}</p>
                        </div>
                      `).join("")
                    : '<div class="rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">No dated tasks or events are currently scheduled for this week.</div>'}
                </div>
              </section>
              <section class="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 p-6">
                <h3 class="font-headline text-2xl font-bold">Course Automation Proof</h3>
                <div class="mt-4 space-y-3">
                  <div class="rounded-xl bg-surface-container-low px-4 py-3">
                    <div class="flex items-center justify-between gap-3">
                      <strong class="text-sm">Education events</strong>
                      <span class="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">${educationEntries.length}</span>
                    </div>
                    <p class="mt-1 text-sm text-on-surface-variant">Classes, replays, assignments, and derived reminders now appear inside the weekly rhythm.</p>
                  </div>
                  <div class="rounded-xl bg-surface-container-low px-4 py-3">
                    <div class="flex items-center justify-between gap-3">
                      <strong class="text-sm">Runtime tasks</strong>
                      <span class="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">${runtimeEntries.length}</span>
                    </div>
                    <p class="mt-1 text-sm text-on-surface-variant">${escapeHtml(getSelectedPlan()?.summary || state.snapshot?.learner?.state?.current_focus || "No current focus set yet.")}</p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
      ${renderFlash()}
    </div>
  `;
}

const SCHEDULE_WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SCHEDULE_PERIOD_SLOTS = [
  { section: 1, label: "一", startTime: "08:00", endTime: "08:45" },
  { section: 2, label: "二", startTime: "08:50", endTime: "09:35" },
  { section: 3, label: "三", startTime: "09:50", endTime: "10:35" },
  { section: 4, label: "四", startTime: "10:40", endTime: "11:25" },
  { section: 5, label: "五", startTime: "11:30", endTime: "12:15" },
  { section: 6, label: "六", startTime: "14:00", endTime: "14:45" },
  { section: 7, label: "七", startTime: "14:50", endTime: "15:35" },
  { section: 8, label: "八", startTime: "15:50", endTime: "16:35" },
  { section: 9, label: "九", startTime: "16:40", endTime: "17:25" },
  { section: 10, label: "十", startTime: "17:30", endTime: "18:15" },
  { section: 11, label: "十一", startTime: "19:00", endTime: "19:45" },
  { section: 12, label: "十二", startTime: "19:50", endTime: "20:35" },
  { section: 13, label: "十三", startTime: "20:40", endTime: "21:25" },
  { section: 14, label: "十四", startTime: "21:30", endTime: "22:15" },
];
const SCHEDULE_FALLBACK_COLORS = ["#FFF0CC", "#DDE4FE", "#D3F4F8", "#E8F3DB", "#FCE0EA", "#CCEAE7", "#FFDDD3", "#D3EAFD"];

function scheduleParseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scheduleDateKey(date) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scheduleWeekStart(referenceDate) {
  const start = new Date(referenceDate);
  const day = start.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + delta);
  start.setHours(0, 0, 0, 0);
  return start;
}

function scheduleMonthStart(referenceDate) {
  const start = new Date(referenceDate);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function scheduleMonthEnd(referenceDate) {
  const end = new Date(referenceDate);
  end.setMonth(end.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return end;
}

function scheduleAddDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function scheduleAddMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function scheduleIsSameDay(left, right) {
  return scheduleDateKey(left) === scheduleDateKey(right);
}

function scheduleIsSameMonth(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function scheduleCurrentViewMode() {
  return state.scheduleViewMode === "month" ? "month" : "week";
}

function scheduleCurrentCursorDate() {
  return scheduleParseDate(state.scheduleCursorDate) || new Date();
}

function scheduleMonthGridDates(cursorDate) {
  const start = scheduleWeekStart(scheduleMonthStart(cursorDate));
  return Array.from({ length: 42 }, (_, index) => scheduleAddDays(start, index));
}

function scheduleResolvedItemTitle(item) {
  if (!item) return t("unlinkedResources");
  return item.manualTitle || item.title || (isZh() ? "未命名课堂" : "Untitled class");
}

function scheduleResolvedItemLocation(item) {
  if (!item) return "";
  return item.manualLocation || item.location || "";
}

function scheduleResolvedItemStart(item) {
  if (!item) return null;
  return item.manualStartAt || item.startAt || item.dueAt || null;
}

function scheduleResolvedItemEnd(item) {
  if (!item) return null;
  return item.manualEndAt || item.endAt || item.startAt || item.dueAt || null;
}

function scheduleResolvedItemNote(item) {
  if (!item) return "";
  return item.manualNote || item.body || "";
}

function scheduleFindItem(itemId) {
  return (state.snapshot?.education?.courseItems || []).find((item) => item.id === itemId) || null;
}

function scheduleItemTimeLabel(item) {
  const start = scheduleParseDate(scheduleResolvedItemStart(item));
  const end = scheduleParseDate(scheduleResolvedItemEnd(item));
  if (!start) return "Unscheduled";
  const date = formatDateShort(start.toISOString(), "zh-CN", { month: "short", day: "numeric", weekday: "short" });
  const endText = end ? ` - ${formatClock(end)}` : "";
  return `${date} ${formatClock(start)}${endText}`;
}

function scheduleTimeValue(value) {
  const date = scheduleParseDate(value);
  if (!date) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function scheduleSetDraftFromItem(item) {
  const start = scheduleParseDate(scheduleResolvedItemStart(item));
  const end = scheduleParseDate(scheduleResolvedItemEnd(item));
  state.drafts.scheduleTitle = scheduleResolvedItemTitle(item);
  state.drafts.scheduleDate = start ? scheduleDateKey(start) : scheduleDateKey(scheduleCurrentCursorDate());
  state.drafts.scheduleStartTime = scheduleTimeValue(start) || "19:00";
  state.drafts.scheduleEndTime = scheduleTimeValue(end) || "20:00";
  state.drafts.scheduleLocation = scheduleResolvedItemLocation(item);
  state.drafts.scheduleNote = scheduleResolvedItemNote(item);
}

function scheduleResetDrafts() {
  state.drafts.scheduleTitle = "";
  state.drafts.scheduleDate = scheduleDateKey(scheduleCurrentCursorDate());
  state.drafts.scheduleStartTime = "19:00";
  state.drafts.scheduleEndTime = "20:00";
  state.drafts.scheduleLocation = "";
  state.drafts.scheduleNote = "";
}

function scheduleMinutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function scheduleParseClock(value) {
  const [hourPart, minutePart] = String(value || "").split(":");
  const hour = Number.parseInt(hourPart, 10);
  const minute = Number.parseInt(minutePart, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 0;
  return hour * 60 + minute;
}

function scheduleSectionFromDate(date, mode = "start") {
  const targetMinutes = scheduleMinutesOfDay(date);
  let resolved = SCHEDULE_PERIOD_SLOTS[0].section;
  for (const slot of SCHEDULE_PERIOD_SLOTS) {
    const anchor = mode === "end" ? scheduleParseClock(slot.endTime) : scheduleParseClock(slot.startTime);
    if (targetMinutes >= anchor) resolved = slot.section;
  }
  return resolved;
}

function scheduleHash(value) {
  return Array.from(String(value || "")).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

function scheduleHexToRgb(hex) {
  const normalized = typeof hex === "string" && /^#([0-9a-f]{6})$/i.test(hex.trim()) ? hex.trim() : null;
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function scheduleMixRgb(source, target, amount) {
  return {
    r: Math.round(source.r + (target.r - source.r) * amount),
    g: Math.round(source.g + (target.g - source.g) * amount),
    b: Math.round(source.b + (target.b - source.b) * amount),
  };
}

function scheduleRgbString(rgb, alpha = 1) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function scheduleCourseAppearance(course) {
  const fallback = SCHEDULE_FALLBACK_COLORS[Math.abs(scheduleHash(course?.id || course?.title || "course")) % SCHEDULE_FALLBACK_COLORS.length];
  const rgb = scheduleHexToRgb(course?.displayColor) || scheduleHexToRgb(fallback);
  const soft = scheduleMixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.74);
  const edge = scheduleMixRgb(rgb, { r: 45, g: 56, b: 40 }, 0.42);
  return {
    surface: scheduleRgbString(soft, 1),
    edge: scheduleRgbString(edge, 0.92),
    chip: scheduleRgbString(rgb, 0.24),
    shadow: scheduleRgbString(rgb, 0.2),
  };
}

function scheduleRangeLabel(mode, cursorDate) {
  if (mode === "month") return cursorDate.toLocaleDateString("en-US", { year: "numeric", month: "long" });
  const start = scheduleWeekStart(cursorDate);
  const end = scheduleAddDays(start, 6);
  return `${start.toLocaleDateString("en-US", { month: "long", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
}

function scheduleCollectEntries(rangeStart, rangeEnd, options = {}) {
  const includeClassItems = options.includeClassItems !== false;
  const education = state.snapshot?.education;
  if (!education) return { entries: [], courseMap: new Map(), totalCourses: 0, totalClasses: 0, termLabel: "" };
  const periodCount = SCHEDULE_PERIOD_SLOTS.length;
  const courseMap = new Map(education.courses.map((course) => [course.id, course]));
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  const entries = education.courseItems
    .filter((item) => {
      if (item.isHidden) return false;
      if (item.type === "class") return includeClassItems;
      return item.type === "assignment" || item.type === "exam" || item.type === "manual";
    })
    .map((item) => {
      const start = scheduleParseDate(scheduleResolvedItemStart(item));
      const end = scheduleParseDate(scheduleResolvedItemEnd(item));
      const startSection = start ? scheduleSectionFromDate(start, "start") : 1;
      const endSection = item.type === "class" && end
        ? Math.max(startSection, scheduleSectionFromDate(end, "end"))
        : startSection;
      return {
        id: item.id,
        courseId: item.courseId,
        type: item.type,
        title: scheduleResolvedItemTitle(item),
        teacher: item.teacher || courseMap.get(item.courseId)?.teacher || "",
        location: scheduleResolvedItemLocation(item),
        start,
        end,
        startSection,
        endSection,
      };
    })
    .filter((entry) => entry.start && entry.start.getTime() >= startMs && entry.start.getTime() <= endMs)
    .map((entry) => ({
      ...entry,
      dateKey: scheduleDateKey(entry.start),
      gridRowStart: Math.max(1, Math.min(periodCount, entry.startSection)),
      gridSpan: Math.max(1, Math.min(periodCount, entry.type === "class" || entry.type === "manual" ? entry.endSection - entry.startSection + 1 : 1)),
      sectionLabel: entry.type === "class" || entry.type === "manual"
        ? `${entry.startSection}${entry.startSection === entry.endSection ? "" : `-${entry.endSection}`}`
        : "Due",
    }))
    .sort((left, right) => left.start - right.start);
  return {
    entries,
    courseMap,
    totalCourses: education.courses.filter((course) => course.status !== "hidden").length,
    totalClasses: education.courseItems.filter((item) => item.type === "class" && !item.isHidden).length,
    termLabel: education.courses[0]?.term || "",
  };
}

function renderScheduleWeekCardLegacy(entry, courseMap) {
  const appearance = scheduleCourseAppearance(courseMap.get(entry.courseId));
  const metaLine = [entry.location, entry.teacher].filter(Boolean).join(" · ");
  const cardClass = entry.type === "class" || entry.type === "manual" ? "schedule-course-card" : "schedule-course-card schedule-course-card--due";
  const fallbackMeta = entry.type === "class" || entry.type === "manual"
    ? `${formatClock(entry.start)} - ${formatClock(entry.end || entry.start)}`
    : `Due ${formatClock(entry.start)}`;
  return `
    <article class="${cardClass}" style="grid-row:${entry.gridRowStart} / span ${entry.gridSpan}; --course-surface:${appearance.surface}; --course-edge:${appearance.edge}; --course-chip:${appearance.chip}; --course-shadow:${appearance.shadow};">
      <strong class="line-clamp-2 text-[12px] leading-4 text-[#243022]">${escapeHtml(entry.title)}</strong>
      <p class="line-clamp-1 text-[10px] leading-4 text-[#41503b]">${escapeHtml(metaLine || fallbackMeta)}</p>
    </article>
  `;
}

function renderScheduleWeekCard(entry, courseMap) {
  const appearance = scheduleCourseAppearance(courseMap.get(entry.courseId));
  const metaLine = [entry.location, entry.teacher].filter(Boolean).join(" / ");
  const isTimed = entry.type === "class" || entry.type === "manual";
  const isCompact = entry.gridSpan <= 1;
  const cardClass = isTimed ? "schedule-course-card" : "schedule-course-card schedule-course-card--due";
  const fallbackMeta = isTimed
    ? `${formatClock(entry.start)} - ${formatClock(entry.end || entry.start)}`
    : `Due ${formatClock(entry.start)}`;
  return `
    <article class="${cardClass} ${isCompact ? "schedule-course-card--compact" : ""}" data-action="open-schedule-actions" data-item-id="${escapeHtml(entry.id)}" style="grid-row:${entry.gridRowStart} / span ${entry.gridSpan}; --course-surface:${appearance.surface}; --course-edge:${appearance.edge}; --course-chip:${appearance.chip}; --course-shadow:${appearance.shadow};">
      <strong class="${isCompact ? "" : "line-clamp-2"} text-[12px] leading-4 text-[#243022]">${escapeHtml(entry.title)}</strong>
      <p class="${isCompact ? "schedule-course-card__meta--compact" : "line-clamp-1"} text-[10px] leading-4 text-[#41503b]">${escapeHtml(metaLine || fallbackMeta)}</p>
    </article>
  `;
}

function renderCourseSelect(name, value, { includeEmpty = true } = {}) {
  const options = getAvailableCourses();
  return `
    <select class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm text-on-background shadow-sm focus:border-primary focus:ring-primary/20" name="${escapeHtml(name)}">
      ${includeEmpty ? `<option value="">${escapeHtml(t("noFixedCourse"))}</option>` : ""}
      ${options
        .map((course) => {
          const title = courseDisplayTitle(course);
          const teacher = courseDisplayTeacher(course);
          const label = [title, teacher].filter(Boolean).join(" · ");
          return `
            <option value="${escapeHtml(course.id)}" ${course.id === value ? "selected" : ""}>
              ${escapeHtml(course.title)} · ${escapeHtml(course.teacher || "")}
            </option>
          `;
        })
        .join("")}
    </select>
  `;
}

function renderCanonicalCourseSelect(name, value, { includeEmpty = true } = {}) {
  const options = getAvailableCourses();
  return `
    <select class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm text-on-background shadow-sm focus:border-primary focus:ring-primary/20" name="${escapeHtml(name)}">
      ${includeEmpty ? `<option value="">${escapeHtml(t("noFixedCourse"))}</option>` : ""}
      ${options
        .map((course) => {
          const title = courseDisplayTitle(course);
          const teacher = courseDisplayTeacher(course);
          const label = [title, teacher].filter(Boolean).join(" / ");
          return `
            <option value="${escapeHtml(course.id)}" ${course.id === value ? "selected" : ""}>
              ${escapeHtml(label)}
            </option>
          `;
        })
        .join("")}
    </select>
  `;
}

renderCourseSelect = renderCanonicalCourseSelect;

const RESOURCE_TYPE_ORDER = ["video", "ppt", "pptx", "pdf", "subtitle", "notes", "link", "folder"];
const RESOURCE_TYPE_META = {
  video: { labelKey: "video", icon: "play_circle" },
  ppt: { labelKey: "slides", icon: "slideshow" },
  pptx: { labelKey: "slides", icon: "slideshow" },
  pdf: { labelKey: "pdf", icon: "picture_as_pdf" },
  subtitle: { labelKey: "subtitle", icon: "subtitles" },
  notes: { labelKey: "notes", icon: "notes" },
  link: { labelKey: "link", icon: "link" },
  folder: { labelKey: "folder", icon: "folder" },
};

function resourceTypeMeta(type) {
  const meta = RESOURCE_TYPE_META[type];
  if (!meta) return { label: String(type || t("resourceGeneric")), icon: "draft" };
  return { label: t(meta.labelKey), icon: meta.icon };
}

function resourceTypeLabel(type) {
  return resourceTypeMeta(type).label;
}

function sortResources(left, right) {
  const leftIndex = RESOURCE_TYPE_ORDER.indexOf(left.resourceType);
  const rightIndex = RESOURCE_TYPE_ORDER.indexOf(right.resourceType);
  const leftRank = leftIndex < 0 ? RESOURCE_TYPE_ORDER.length : leftIndex;
  const rightRank = rightIndex < 0 ? RESOURCE_TYPE_ORDER.length : rightIndex;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
}

function resourceSourceLabel(resource) {
  const origin = String(resource.metaJson?.origin || resource.metaJson?.source || "");
  if (origin.includes("manual") || String(resource.url || "").startsWith("local://")) return t("localSource");
  if (resource.localPath) return t("cachedSource");
  return t("platformSource");
}

function resourceLocationLabel(resource) {
  return resource.localPath || resource.url || t("noLocation");
}

function resourceCourseItems(courseId) {
  return (state.snapshot?.education?.courseItems || [])
    .filter((item) => !item.isHidden)
    .filter((item) => item.courseId === courseId)
    .filter((item) => item.type === "class" || item.type === "replay" || item.type === "manual")
    .slice()
    .sort((left, right) => String(scheduleResolvedItemStart(right) || right.lastSyncedAt || "").localeCompare(String(scheduleResolvedItemStart(left) || left.lastSyncedAt || "")));
}

function itemDisplayTitle(item) {
  if (!item) return t("unlinkedResources");
  return scheduleResolvedItemTitle(item) || item.title || t("untitledSession");
}

function itemDisplayDate(item, fallback = "") {
  const value = item ? scheduleResolvedItemStart(item) || item.dueAt || item.lastSyncedAt : fallback;
  const date = scheduleParseDate(value);
  if (!date) return { day: t("noDate"), time: "" };
  return {
    day: formatDateShort(date.toISOString(), "zh-CN", { month: "short", day: "numeric" }),
    time: formatClock(date.toISOString()),
  };
}

function renderResourceItemSelect(name, value, courseId) {
  const items = resourceCourseItems(courseId);
  const selectedValue = value && items.some((item) => item.id === value) ? value : items[0]?.id || "";
  state.drafts.resourceItemId = selectedValue;
  return `
    <select class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm text-on-background shadow-sm focus:border-primary focus:ring-primary/20" name="${escapeHtml(name)}">
      ${items.length
        ? items.map((item) => {
            const stamp = itemDisplayDate(item);
            const label = [stamp.day !== t("noDate") ? `${stamp.day} ${stamp.time}` : "", itemDisplayTitle(item), resourceTypeLabel(item.type)]
              .filter(Boolean)
              .join(" - ");
            return `<option value="${escapeHtml(item.id)}" ${item.id === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
          }).join("")
        : `<option value="">${escapeHtml(t("noSyncedClassOrReplay"))}</option>`}
    </select>
  `;
}

function resourcesForCourse(courseId) {
  const courseIds = expandRelatedCourseIds([courseId]);
  return (state.snapshot?.education?.courseResources || [])
    .filter((resource) => courseIds.has(resource.courseId))
    .filter(isPrimaryCourseResource)
    .slice()
    .sort((left, right) => {
      const leftTs = String(left.metaJson?.addedAt || left.id || "");
      const rightTs = String(right.metaJson?.addedAt || right.id || "");
      return rightTs.localeCompare(leftTs) || sortResources(left, right);
    });
}

function countResourceTypes(resources) {
  const counts = new Map();
  for (const resource of resources) {
    counts.set(resource.resourceType, (counts.get(resource.resourceType) || 0) + 1);
  }
  return Array.from(counts.entries()).sort(([left], [right]) => {
    const leftIndex = RESOURCE_TYPE_ORDER.indexOf(left);
    const rightIndex = RESOURCE_TYPE_ORDER.indexOf(right);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
  });
}

async function syncSelectedCourseResources(courseId, { quiet = false } = {}) {
  if (!courseId || state.resourceSyncingCourseId === courseId) return;
  state.resourceSyncingCourseId = courseId;
  render();
  try {
    const snapshot = await request("/api/education/buaa/sync-course-resources", {
      method: "POST",
      body: JSON.stringify({ courseId }),
    });
    invalidateFileCache();
    state.snapshot = snapshot;
    syncSelection();
    if (!quiet) setFlash("info", t("courseResourcesSynced"));
  } catch (error) {
    if (!quiet) {
      setFlash("error", error.message);
      if (/BUAA login state|Log in first|MSA login has expired|could not match .* BUAA MSA course/i.test(error.message)) {
        state.pendingBuaaCourseId = courseId;
        state.buaaLoginIntent = /could not match .* BUAA MSA course/i.test(error.message) ? "map-and-sync" : "retry-sync";
        state.showBuaaLogin = true;
        state.buaaLoginDismissed = false;
        if (!buaaLoginNeedsMsaCourseIds()) {
          state.drafts.buaaMsaCourseIds = "";
        }
      }
    }
  } finally {
    state.resourceSyncingCourseId = "";
    render();
  }
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function renderResourceChips(resources) {
  return countResourceTypes(resources)
    .map(([type, count]) => `<span class="resource-chip">${escapeHtml(resourceTypeLabel(type))} ${escapeHtml(count)}</span>`)
    .join("");
}

function renderResourceOpenAction(resource) {
  const href = resourceOpenHref(resource);
  if (!href) {
    return `<span class="resource-open-disabled">${icon("block", "text-[16px]")}${escapeHtml(t("unavailable"))}</span>`;
  }
  return `<a class="resource-open" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" data-action="open-resource" data-href="${escapeHtml(href)}">${icon(resource.localPath ? "file_open" : "open_in_new", "text-[16px]")}${escapeHtml(t("open"))}</a>`;
}

function resourceDisplayTitle(resource, item = null) {
  const itemTitle = itemDisplayTitle(item);
  const isMsaResource = String(resource?.sourceResourceId || "").startsWith("msa-") || String(resource?.id || "").startsWith("resource-buaa-msa-");
  if (itemTitle && isMsaResource) {
    const label = String(resource?.metaJson?.label || "").trim();
    if (resource.resourceType === "video") {
      if (label === "slides-video") return `${itemTitle} 课件视频`;
      if (label === "teacher-video") return `${itemTitle} 教师视频`;
      return `${itemTitle} 视频`;
    }
    if (resource.resourceType === "ppt" || resource.resourceType === "pptx") return `${itemTitle} 课件`;
  }
  return resource.title || "Untitled resource";
}

resourceDisplayTitle = function resourceDisplayTitleLocalized(resource, item = null) {
  const itemTitle = itemDisplayTitle(item);
  const isMsaResource = String(resource?.sourceResourceId || "").startsWith("msa-") || String(resource?.id || "").startsWith("resource-buaa-msa-");
  if (itemTitle && isMsaResource) {
    const label = String(resource?.metaJson?.label || "").trim();
    if (resource.resourceType === "video") {
      if (label === "slides-video") return isZh() ? `${itemTitle} 课件视频` : `${itemTitle} slides video`;
      if (label === "teacher-video") return isZh() ? `${itemTitle} 教师视频` : `${itemTitle} teacher video`;
      return isZh() ? `${itemTitle} 视频` : `${itemTitle} video`;
    }
    if (resource.resourceType === "ppt" || resource.resourceType === "pptx") return isZh() ? `${itemTitle} 课件` : `${itemTitle} slides`;
  }
  return resource.title || (isZh() ? "未命名资源" : "Untitled resource");
};

function renderResourceRow(resource, item = null) {
  const meta = resourceTypeMeta(resource.resourceType);
  const title = resourceDisplayTitle(resource, item);
  return `
    <details class="resource-row">
      <summary>
        <span class="resource-row-icon">${icon(meta.icon, "text-[18px]")}</span>
        <span class="min-w-0 flex-1">
          <strong class="line-clamp-1 text-sm text-on-background">${escapeHtml(title)}</strong>
          <span class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
            <span>${escapeHtml(meta.label)}</span>
            <span>${escapeHtml(resourceSourceLabel(resource))}</span>
          </span>
        </span>
        ${renderResourceOpenAction(resource)}
      </summary>
      <div class="resource-row-detail">
        <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant/55">${escapeHtml(t("location"))}</span>
        <p class="mt-1 break-all text-xs leading-5 text-on-surface-variant">${escapeHtml(resourceLocationLabel(resource))}</p>
      </div>
    </details>
  `;
}

function renderPlatformResourcePicker(courseId) {
  const resources = resourcesForCourse(courseId);
  const course = getAvailableCourses().find((entry) => entry.id === courseId);
  const itemMap = new Map((state.snapshot?.education?.courseItems || []).map((item) => [item.id, item]));
  const syncing = state.resourceSyncingCourseId === courseId;
  const latest = itemDisplayDate(null, latestResourceTime(resources, itemMap));
  return `
    <div class="space-y-4">
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <label class="grid gap-2 text-xs font-semibold text-on-surface-variant">
          ${escapeHtml(t("course"))}
          ${renderCourseSelect("resourceCourseId", courseId, { includeEmpty: false })}
        </label>
        <button class="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-on-primary shadow-sm disabled:opacity-55" data-action="sync-course-resources" data-course-id="${escapeHtml(courseId)}" ${syncing ? "disabled" : ""}>
          ${icon(syncing ? "sync" : "cloud_sync", "text-[18px]")}
          <span>${escapeHtml(syncing ? t("syncing") : t("sync"))}</span>
        </button>
      </div>
      <div class="resource-picker-panel">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/55">${escapeHtml(t("syncedFromPlatform"))}</p>
            <h4 class="mt-1 text-base font-bold">${escapeHtml(courseDisplayTitle(course) || t("chooseCourse"))}</h4>
            <p class="mt-1 text-xs leading-5 text-on-surface-variant">${escapeHtml(t("platformResourceHelp"))}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            ${latest.day !== t("noDate") ? `<span class="resource-count-pill">${escapeHtml(t("latest"))} ${escapeHtml(latest.day)} ${escapeHtml(latest.time)}</span>` : ""}
            <span class="resource-count-pill">${escapeHtml(String(resources.length))} ${escapeHtml(t("resourcesCount"))}</span>
          </div>
        </div>
        <div class="mt-4">
          ${resources.length
            ? renderCourseResourceTimeline({ course: course || { id: courseId, title: courseId, teacher: "", term: "", status: "active" }, resources }, itemMap)
            : `<div class="resource-empty">
                <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-on-surface-variant">${icon("sync_problem", "text-[20px]")}</div>
                <div>
                  <p class="font-semibold text-on-background">${escapeHtml(t("noPlatformResources"))}</p>
                  <p class="mt-1 text-sm leading-6 text-on-surface-variant">${escapeHtml(t("clickSyncHelp"))}</p>
                </div>
              </div>`}
        </div>
      </div>
    </div>
  `;
}

function latestResourceTime(resources, itemMap) {
  let latest = "";
  for (const resource of resources) {
    const item = itemMap.get(resource.linkedItemId);
    const candidate = scheduleResolvedItemStart(item) || item?.lastSyncedAt || resource.metaJson?.addedAt || resource.id || "";
    if (String(candidate).localeCompare(String(latest)) > 0) latest = candidate;
  }
  return latest;
}

function buildResourceCourseGroups() {
  const education = state.snapshot?.education;
  if (!education) return [];
  const courseMap = new Map((education.courses || []).map((course) => [course.id, course]));
  const itemMap = new Map((education.courseItems || []).map((item) => [item.id, item]));
  const courseIds = new Set((education.courseResources || []).filter(isPrimaryCourseResource).map((resource) => resource.courseId));
  return Array.from(courseIds)
    .map((courseId) => {
      const course = courseMap.get(courseId) || { id: courseId, title: courseId, teacher: "", term: "", status: "active" };
      const resources = resourcesForCourse(courseId);
      return {
        course,
        resources,
        latest: latestResourceTime(resources, itemMap),
      };
    })
    .filter((group) => group.course.status !== "hidden")
    .sort((left, right) => {
      if (left.resources.length !== right.resources.length) return right.resources.length - left.resources.length;
      return String(left.course.title || "").localeCompare(String(right.course.title || ""), "zh-CN");
    });
}

function renderCourseResourceTimeline(group, itemMap) {
  const buckets = new Map();
  for (const resource of group.resources) {
    const key = resource.linkedItemId || "__unlinked";
    const bucket = buckets.get(key) || { item: itemMap.get(resource.linkedItemId) || null, resources: [] };
    bucket.resources.push(resource);
    buckets.set(key, bucket);
  }
  const entries = Array.from(buckets.values()).sort((left, right) => {
    const leftTime = scheduleResolvedItemStart(left.item) || left.item?.lastSyncedAt || left.resources[0]?.metaJson?.addedAt || "";
    const rightTime = scheduleResolvedItemStart(right.item) || right.item?.lastSyncedAt || right.resources[0]?.metaJson?.addedAt || "";
    return String(rightTime).localeCompare(String(leftTime));
  });
  if (!entries.length) {
    return `
      <div class="resource-empty">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-on-surface-variant">${icon("folder_off", "text-[20px]")}</div>
        <div>
          <p class="font-semibold text-on-background">${escapeHtml(t("noResourcesInCourse"))}</p>
          <p class="mt-1 text-sm leading-6 text-on-surface-variant">${escapeHtml(t("clickSyncHelp"))}</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="resource-timeline">
      ${entries.map((entry, index) => {
        const stamp = itemDisplayDate(entry.item, entry.resources[0]?.metaJson?.addedAt || "");
        return `
          <details class="resource-session" ${index === 0 ? "open" : ""}>
            <summary>
              <span class="resource-date-badge">
                <strong>${escapeHtml(stamp.day)}</strong>
                ${stamp.time ? `<span>${escapeHtml(stamp.time)}</span>` : ""}
              </span>
              <span class="min-w-0 flex-1">
                <strong class="line-clamp-1 text-sm text-on-background">${escapeHtml(itemDisplayTitle(entry.item))}</strong>
                <span class="mt-1 flex flex-wrap gap-1.5">${renderResourceChips(entry.resources)}</span>
              </span>
              <span class="resource-count-pill">${escapeHtml(String(entry.resources.length))}</span>
            </summary>
            <div class="mt-3 space-y-2">
              ${entry.resources.sort(sortResources).map((resource) => renderResourceRow(resource, entry.item)).join("")}
            </div>
          </details>
        `;
      }).join("")}
    </div>
  `;
}

function renderCronSummaryCard() {
  const preview = state.cronPreview;
  if (!preview) return "";
  const tone = preview.canRun ? "bg-primary-container/30 border-primary/20" : "bg-tertiary-container/25 border-[#9a7e60]/20";
  const status = preview.canRun
    ? `${preview.courseTitle || "Course"} summary preview generated successfully.`
    : preview.reason || "Automation cannot run yet.";
  return `
    <section class="mb-6 rounded-[24px] border ${tone} px-5 py-5 shadow-[0_18px_45px_-30px_rgba(49,51,46,0.3)]">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-on-surface-variant/65">Automation Preview</p>
          <h3 class="mt-2 font-headline text-2xl font-bold">${escapeHtml(preview.summaryTitle)}</h3>
          <p class="mt-2 text-sm text-on-surface-variant">${escapeHtml(status)}</p>
        </div>
        <div class="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.2em]">
          <span class="rounded-full bg-white px-3 py-2 text-on-surface-variant">${escapeHtml(preview.cron.title)}</span>
          ${preview.sourceResource ? `<span class="rounded-full bg-white px-3 py-2 text-primary">${escapeHtml(preview.sourceResource.resourceType)}</span>` : ""}
          ${preview.latestClass ? `<span class="rounded-full bg-white px-3 py-2 text-on-surface-variant">${escapeHtml(preview.latestClass.title)}</span>` : ""}
        </div>
      </div>
      ${
        preview.canRun
          ? `
            <div class="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
              <div class="rounded-2xl bg-white/70 px-4 py-4">
                <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/60">Summary</p>
                <div class="mt-3 space-y-3">
                  ${preview.summaryPoints.map((point) => `<div class="rounded-xl bg-surface-container-low px-4 py-3 text-sm leading-7">${escapeHtml(point)}</div>`).join("")}
                </div>
              </div>
              <div class="space-y-4">
                <div class="rounded-2xl bg-white/70 px-4 py-4">
                  <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/60">Self-check</p>
                  <div class="mt-3 space-y-2">
                    ${preview.reviewQuestions.map((question) => `<div class="rounded-xl bg-surface-container-low px-4 py-3 text-sm leading-7">${escapeHtml(question)}</div>`).join("")}
                  </div>
                </div>
                <div class="rounded-2xl bg-white/70 px-4 py-4">
                  <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/60">Next Actions</p>
                  <div class="mt-3 space-y-2">
                    ${preview.nextActions.map((action) => `<div class="rounded-xl bg-surface-container-low px-4 py-3 text-sm leading-7">${escapeHtml(action)}</div>`).join("")}
                  </div>
                </div>
              </div>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderResourceComposer(plan) {
  if (!state.showResourceComposer) return "";
  const courseId = state.drafts.resourceCourseId || plan?.courseIds?.[0] || getAvailableCourses()[0]?.id || "";
  const mode = state.drafts.resourceSourceMode === "local" ? "local" : "platform";
  return `
    <section class="rounded-[24px] border border-outline-variant/18 bg-surface-container-lowest px-5 py-5 shadow-[0_16px_36px_-28px_rgba(49,51,46,0.35)]">
      <div class="flex items-center justify-between gap-3">
        <div class="inline-flex rounded-full bg-surface-container-low p-1 shadow-sm ring-1 ring-outline-variant/10">
          <button class="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${mode === "platform" ? "bg-white text-primary shadow-sm" : "text-on-surface-variant hover:text-on-background"}" data-action="set-resource-source" data-source-mode="platform">${icon("account_tree", "text-[17px]")} ${escapeHtml(t("platform"))}</button>
          <button class="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${mode === "local" ? "bg-white text-primary shadow-sm" : "text-on-surface-variant hover:text-on-background"}" data-action="set-resource-source" data-source-mode="local">${icon("upload_file", "text-[17px]")} ${escapeHtml(t("local"))}</button>
        </div>
        <button class="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container text-on-surface-variant hover:text-primary" data-action="toggle-resource-composer">${icon("close")}</button>
      </div>
      <div class="mt-5">
        ${mode === "platform"
          ? renderPlatformResourcePicker(courseId)
          : `
            <form id="resource-upload-form" class="space-y-4">
              <div class="grid gap-4 lg:grid-cols-[1fr_auto]">
                <label class="grid gap-2 text-xs font-semibold text-on-surface-variant">
                  ${escapeHtml(t("course"))}
                  ${renderCourseSelect("resourceCourseId", courseId, { includeEmpty: false })}
                </label>
                <button class="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-sm disabled:opacity-55" type="button" data-action="choose-resource-file" ${state.uploadingResource ? "disabled" : ""}>
                  ${icon(state.uploadingResource ? "sync" : "upload_file", "text-[18px]")}
                  <span>${escapeHtml(state.uploadingResource ? t("uploading") : t("chooseFile"))}</span>
                </button>
              </div>
              <input class="hidden" name="resourceFile" type="file" />
              <div class="resource-empty">
                <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-on-surface-variant">${icon("folder_open", "text-[20px]")}</div>
                <div>
                  <p class="font-semibold text-on-background">${escapeHtml(t("uploadLocalFile"))}</p>
                  <p class="mt-1 text-sm leading-6 text-on-surface-variant">${escapeHtml(t("localFileHelp"))}</p>
                </div>
              </div>
            </form>
          `}
      </div>
    </section>
  `;
}

function renderAutomationPanel(plan) {
  if (!state.showCronComposer) return "";
  if (!plan) {
    return `
      <section class="rounded-2xl border border-outline-variant/18 bg-surface-container-lowest px-5 py-5">
        <h3 class="font-headline text-2xl font-bold">Plan & Cron</h3>
        <p class="mt-2 text-sm text-on-surface-variant">Create and select a project first. Then bind a course resource and one or more crons to it.</p>
      </section>
    `;
  }
  const planCrons = getPlanCrons(plan);
  return `
    <section class="rounded-2xl border border-outline-variant/18 bg-surface-container-lowest px-5 py-5 shadow-[0_16px_36px_-28px_rgba(49,51,46,0.35)]">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="font-headline text-2xl font-bold">Plan & Cron</h3>
          <p class="mt-1 text-sm text-on-surface-variant">Create a runtime cron bound to this project.</p>
        </div>
        <button class="inline-flex items-center gap-2 rounded-xl bg-surface-container px-4 py-2 text-sm font-semibold text-on-background hover:bg-surface-container-high" data-action="toggle-cron-composer">
          ${icon(state.showCronComposer ? "remove" : "add", "text-[18px]")}
          <span>${state.showCronComposer ? "Hide" : "New Cron"}</span>
        </button>
      </div>
      ${
        state.showCronComposer
          ? `
            <form id="cron-form" class="mt-5 space-y-4 rounded-2xl bg-surface-container-low px-4 py-4">
              <label class="grid gap-2">
                <span class="text-xs font-semibold text-on-surface-variant">Cron name</span>
                <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="cronTitle" value="${escapeHtml(state.drafts.cronTitle)}" />
              </label>
              <label class="grid gap-2">
                <span class="text-xs font-semibold text-on-surface-variant">Schedule rule</span>
                <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="cronSchedule" value="${escapeHtml(state.drafts.cronSchedule)}" />
              </label>
              <label class="grid gap-2">
                <span class="text-xs font-semibold text-on-surface-variant">Action to run</span>
                <textarea class="w-full rounded-xl border border-outline-variant/18 bg-white px-4 py-3 text-sm leading-7 shadow-sm focus:border-primary focus:ring-primary/20 resize-none" name="cronPrompt" rows="4">${escapeHtml(state.drafts.cronPrompt)}</textarea>
              </label>
              <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-sm" type="submit">${icon("schedule_send", "text-[18px]")}Create Cron</button>
            </form>
          `
          : ""
      }
      <div class="mt-5 space-y-3">
        ${
          planCrons.length
            ? planCrons
                .map(
                  (cron) => `
                    <div class="rounded-2xl bg-surface-container-low px-4 py-4">
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 class="font-semibold text-on-background">${escapeHtml(cron.title)}</h4>
                          <p class="mt-1 text-sm text-on-surface-variant">${escapeHtml(cron.schedule)}</p>
                        </div>
                        <button class="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-on-background shadow-sm hover:bg-surface-container" data-action="run-cron" data-cron-id="${escapeHtml(cron.cronId)}">
                          ${icon("play_arrow", "text-[18px]")}
                          <span>Run now</span>
                        </button>
                      </div>
                    </div>
                  `,
                )
                .join("")
            : ""
        }
      </div>
    </section>
  `;
}

function renderDebugPanel(plan, thread, binding) {
    const planCrons = getPlanCrons(plan);
    const memoryPath = thread?.localFiles?.find((file) => file.label === "Working Memory")?.relativePath || "No memory file";
    const educationConnections = (state.snapshot?.education?.connections || [])
      .filter((connection) => ["buaa-byxt", "buaa-msa"].includes(connection.sourceType))
      .map((connection) => {
        const statusTone =
          connection.status === "connected"
            ? "text-primary"
            : connection.status === "error" || connection.status === "invalid"
              ? "text-[#8A4B3A]"
              : "text-on-surface-variant";
        const syncText = connection.lastSyncedAt ? formatDateTime(connection.lastSyncedAt) : "Never synced";
        const detail = connection.lastError ? compactText(connection.lastError, 120) : `Last sync ${syncText}`;
        return `
          <div class="rounded-2xl bg-surface-container-low px-4 py-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60">${escapeHtml(connection.sourceType)}</p>
                <p class="mt-2 text-sm font-semibold">${escapeHtml(connection.accountLabel || connection.id)}</p>
              </div>
              <span class="text-xs font-semibold uppercase tracking-[0.18em] ${statusTone}">${escapeHtml(connection.status)}</span>
            </div>
            <p class="mt-3 text-sm text-on-surface-variant">${escapeHtml(detail)}</p>
          </div>
        `;
      })
      .join("");
    return `
      <section class="rounded-2xl border border-outline-variant/18 bg-surface-container-lowest px-5 py-5 shadow-[0_16px_36px_-28px_rgba(49,51,46,0.35)]">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="font-headline text-2xl font-bold">Debug Context</h3>
          <p class="mt-1 text-sm text-on-surface-variant">Use this rail to verify whether the current session, project, thread, files, and cron are really pointing at the same runtime context.</p>
        </div>
        <button class="inline-flex items-center gap-2 rounded-xl bg-surface-container px-4 py-2 text-sm font-semibold text-on-background hover:bg-surface-container-high" data-action="focus-files">${icon("folder_open", "text-[18px]")}Files</button>
      </div>
      <div class="mt-5 space-y-4">
        <div class="paper-input rounded-xl overflow-hidden">
          <input class="w-full bg-transparent border-0 py-4 px-5 text-sm font-body focus:ring-0 placeholder:text-outline-variant/40" name="sessionKey" placeholder="browser-..." value="${escapeHtml(state.sessionKey)}" />
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="rounded-xl bg-surface-container px-4 py-2 text-sm font-semibold text-on-background hover:bg-surface-container-high" data-action="new-session">New Session</button>
          <button class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm" data-action="bind-session" ${plan && thread ? "" : "disabled"}>Bind</button>
          <button class="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-on-background shadow-sm" data-action="unbind-session" ${state.sessionKey ? "" : "disabled"}>Unbind</button>
          <button class="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-on-background shadow-sm" data-action="open-buaa-login">BUAA Login</button>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="rounded-2xl bg-surface-container-low px-4 py-4"><p class="text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60">Runtime Root</p><p class="mt-2 break-all text-sm">${escapeHtml(state.snapshot?.runtimeRoot || "")}</p></div>
          <div class="rounded-2xl bg-surface-container-low px-4 py-4"><p class="text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60">Workspace Root</p><p class="mt-2 break-all text-sm">${escapeHtml(state.snapshot?.workspaceRoot || "")}</p></div>
          <div class="rounded-2xl bg-surface-container-low px-4 py-4"><p class="text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60">Project ID</p><p class="mt-2 break-all text-sm">${escapeHtml(plan?.planId || "none")}</p></div>
          <div class="rounded-2xl bg-surface-container-low px-4 py-4"><p class="text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60">Thread ID</p><p class="mt-2 break-all text-sm">${escapeHtml(thread?.threadId || "none")}</p></div>
          <div class="rounded-2xl bg-surface-container-low px-4 py-4"><p class="text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60">Bound Session</p><p class="mt-2 break-all text-sm">${escapeHtml(binding?.sessionKey || state.sessionKey || "unbound")}</p></div>
          <div class="rounded-2xl bg-surface-container-low px-4 py-4"><p class="text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60">Workflow</p><p class="mt-2 break-all text-sm">${escapeHtml(workflowLabel(binding?.lastWorkflow || plan?.currentPhase || "idle"))}</p></div>
            <div class="rounded-2xl bg-surface-container-low px-4 py-4 sm:col-span-2"><p class="text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60">Course Scope</p><p class="mt-2 text-sm break-all">${escapeHtml((plan?.courseIds || []).join(", ") || "No course bound yet")}</p></div>
            <div class="rounded-2xl bg-surface-container-low px-4 py-4"><p class="text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60">Cron Count</p><p class="mt-2 text-sm">${escapeHtml(String(planCrons.length))}</p></div>
            <div class="rounded-2xl bg-surface-container-low px-4 py-4"><p class="text-[10px] uppercase tracking-[0.22em] text-on-surface-variant/60">Memory Target</p><p class="mt-2 break-all text-sm">${escapeHtml(memoryPath)}</p></div>
            ${
              educationConnections
                ? `<div class="sm:col-span-2 grid gap-3 sm:grid-cols-2">${educationConnections}</div>`
                : ""
            }
          </div>
        </div>
      </section>
    `;
  }

function renderScheduleMonthCard(entry, courseMap) {
  const appearance = scheduleCourseAppearance(courseMap.get(entry.courseId));
  return `
    <div class="schedule-month-course" data-action="open-schedule-actions" data-item-id="${escapeHtml(entry.id)}" style="--course-surface:${appearance.surface}; --course-edge:${appearance.edge}; --course-shadow:${appearance.shadow};">
      <span class="truncate font-semibold">${escapeHtml(entry.title)}</span>
      <span class="shrink-0 text-[10px] opacity-70">${escapeHtml(formatClock(entry.start))}</span>
    </div>
  `;
}

function renderScheduleWeekView(entries, courseMap, cursorDate) {
  const weekStart = scheduleWeekStart(cursorDate);
  const days = Array.from({ length: 7 }, (_, index) => scheduleAddDays(weekStart, index));
  const today = new Date();
  return `
    <div class="schedule-calendar-shell">
      <div class="schedule-week-layout">
        <div class="schedule-week-head schedule-week-sidehead">
          <span class="text-xs font-semibold uppercase tracking-[0.24em] text-on-surface-variant/60">节次</span>
        </div>
        ${days
          .map((day) => {
            const isToday = scheduleIsSameDay(day, today);
            return `
              <div class="schedule-week-head ${isToday ? "schedule-week-head--today" : ""}">
                <span class="text-[11px] font-semibold uppercase tracking-[0.24em] ${isToday ? "text-primary" : "text-on-surface-variant/70"}">${escapeHtml(SCHEDULE_WEEKDAY_LABELS[(day.getDay() + 6) % 7])}</span>
                <strong class="font-headline text-2xl ${isToday ? "text-primary" : "text-on-background"}">${day.getDate()}</strong>
              </div>
            `;
          })
          .join("")}
        <div class="schedule-period-axis">
          ${SCHEDULE_PERIOD_SLOTS.map((slot) => `
            <div class="schedule-period-label">
              <span class="text-[15px] font-bold text-on-background">${escapeHtml(slot.label)}</span>
              <span class="text-[10px] text-on-surface-variant">${escapeHtml(`${slot.startTime} - ${slot.endTime}`)}</span>
            </div>
          `).join("")}
        </div>
        ${days
          .map((day) => {
            const isToday = scheduleIsSameDay(day, today);
            const dayEntries = entries.filter((entry) => entry.dateKey === scheduleDateKey(day));
            return `
              <div class="schedule-day-lane ${isToday ? "schedule-day-lane--today" : ""}">
                <div class="schedule-period-stack">
                  ${SCHEDULE_PERIOD_SLOTS.map(() => '<div class="schedule-period-cell"></div>').join("")}
                  ${dayEntries.map((entry) => renderScheduleWeekCard(entry, courseMap)).join("")}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderScheduleMonthView(entries, courseMap, cursorDate) {
  const days = scheduleMonthGridDates(cursorDate);
  const today = new Date();
  const entriesByDate = new Map();
  for (const entry of entries) {
    const bucket = entriesByDate.get(entry.dateKey) || [];
    bucket.push(entry);
    entriesByDate.set(entry.dateKey, bucket);
  }
  return `
    <div class="schedule-calendar-shell">
      <div class="schedule-month-weekdays">
        ${SCHEDULE_WEEKDAY_LABELS.map((label) => `<div class="schedule-month-weekday">${escapeHtml(label)}</div>`).join("")}
      </div>
      <div class="schedule-month-grid">
        ${days
          .map((day) => {
            const inMonth = scheduleIsSameMonth(day, cursorDate);
            const isToday = scheduleIsSameDay(day, today);
            const dayEntries = (entriesByDate.get(scheduleDateKey(day)) || []).sort((left, right) => left.start - right.start);
            const visibleEntries = dayEntries.slice(0, 3);
            const overflowCount = Math.max(0, dayEntries.length - visibleEntries.length);
            return `
              <div class="schedule-month-cell ${inMonth ? "" : "schedule-month-cell--muted"} ${isToday ? "schedule-month-cell--today" : ""}">
                <div class="flex items-center justify-between gap-3">
                  <strong class="text-sm ${isToday ? "text-primary" : inMonth ? "text-on-background" : "text-on-surface-variant/55"}">${day.getDate()}</strong>
                  ${dayEntries.length ? `<span class="text-[10px] font-semibold uppercase tracking-[0.18em] text-on-surface-variant/55">${dayEntries.length} items</span>` : ""}
                </div>
                <div class="mt-2 space-y-1.5">
                  ${visibleEntries.map((entry) => renderScheduleMonthCard(entry, courseMap)).join("")}
                  ${overflowCount ? `<div class="schedule-month-more">+ ${overflowCount} more</div>` : ""}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderScheduleEmptyState(totalCourses, totalClasses) {
  return `
    <div class="schedule-empty-state">
      <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">${icon("calendar_month")}</div>
      <h3 class="mt-5 font-headline text-3xl font-bold">Timetable detected</h3>
      <p class="mt-3 max-w-[560px] text-sm leading-7 text-on-surface-variant">
        ${escapeHtml(totalCourses)} courses and ${escapeHtml(totalClasses)} class slots are already available in OpenClaw EduClaw. Use the button above to place them on the calendar.
      </p>
    </div>
  `;
}

function renderScheduleNoClasses(mode) {
  return `
    <div class="schedule-empty-state">
      <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">${icon("event_busy")}</div>
      <h3 class="mt-5 font-headline text-3xl font-bold">No classes in this ${escapeHtml(mode)}</h3>
      <p class="mt-3 max-w-[560px] text-sm leading-7 text-on-surface-variant">
        Try the arrows in the top-right corner to move across weeks or months.
      </p>
    </div>
  `;
}

function scheduleComposerDateValue() {
  return state.drafts.scheduleDate || scheduleDateKey(scheduleCurrentCursorDate());
}

function scheduleClockOptions() {
  const options = [];
  for (let minutes = 8 * 60; minutes <= 22 * 60 + 30; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    options.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  return options;
}

function scheduleClockMinutes(value) {
  const [hourPart, minutePart] = String(value || "").split(":");
  const hour = Number.parseInt(hourPart, 10);
  const minute = Number.parseInt(minutePart, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 0;
  return hour * 60 + minute;
}

function scheduleNearestClockOption(value, options) {
  const minutes = scheduleClockMinutes(value);
  return options.reduce((nearest, option) => {
    const nearestDistance = Math.abs(scheduleClockMinutes(nearest) - minutes);
    const optionDistance = Math.abs(scheduleClockMinutes(option) - minutes);
    return optionDistance < nearestDistance ? option : nearest;
  }, options[0] || "19:00");
}

function scheduleNormalizeManualTimes() {
  const options = scheduleClockOptions();
  const startOptions = options.slice(0, -1);
  if (!startOptions.includes(state.drafts.scheduleStartTime)) {
    state.drafts.scheduleStartTime = scheduleNearestClockOption(state.drafts.scheduleStartTime || "19:00", startOptions);
  }
  const startMinutes = scheduleClockMinutes(state.drafts.scheduleStartTime);
  const validEndOptions = options.filter((option) => scheduleClockMinutes(option) > startMinutes);
  const preferredEnd = options.find((option) => scheduleClockMinutes(option) >= startMinutes + 60) || validEndOptions[0] || state.drafts.scheduleStartTime;
  if (!validEndOptions.includes(state.drafts.scheduleEndTime)) {
    const snappedEnd = scheduleNearestClockOption(state.drafts.scheduleEndTime || preferredEnd, validEndOptions);
    state.drafts.scheduleEndTime = validEndOptions.includes(snappedEnd) ? snappedEnd : preferredEnd;
  }
}

function renderScheduleTimeSelect(name, value, options) {
  return `
    <select class="w-full rounded-xl border border-outline-variant/18 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="${escapeHtml(name)}">
      ${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
    </select>
  `;
}

function scheduleLocalDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return "";
  const date = new Date(`${dateValue}T${timeValue}:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function renderScheduleComposer() {
  const editingItem = state.editingScheduleItemId ? scheduleFindItem(state.editingScheduleItemId) : null;
  const isEditing = Boolean(editingItem);
  if (!state.showScheduleComposer && !isEditing) return "";
  scheduleNormalizeManualTimes();
  const clockOptions = scheduleClockOptions();
  const startOptions = clockOptions.slice(0, -1);
  const startMinutes = scheduleClockMinutes(state.drafts.scheduleStartTime);
  const endOptions = clockOptions.filter((option) => scheduleClockMinutes(option) > startMinutes);
  const panel = `
    <section class="schedule-popover ${isEditing ? "schedule-popover--modal" : "mt-3"}">
      <div class="mb-4 flex items-center justify-between gap-3">
        <h3 class="font-headline text-xl font-bold">${isEditing ? "Edit schedule" : "Add schedule"}</h3>
        <button class="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container text-on-surface-variant hover:text-primary" data-action="close-schedule-composer" title="Close">${icon("close")}</button>
      </div>
      <form id="schedule-manual-form" class="grid gap-3">
        <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="scheduleTitle" placeholder="Title" value="${escapeHtml(state.drafts.scheduleTitle)}" />
        <div class="grid grid-cols-[1fr_0.72fr_0.72fr] gap-2">
          <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="scheduleDate" type="date" value="${escapeHtml(scheduleComposerDateValue())}" />
          ${renderScheduleTimeSelect("scheduleStartTime", state.drafts.scheduleStartTime, startOptions)}
          ${renderScheduleTimeSelect("scheduleEndTime", state.drafts.scheduleEndTime, endOptions)}
        </div>
        <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="scheduleLocation" placeholder="Location" value="${escapeHtml(state.drafts.scheduleLocation)}" />
        <input class="w-full rounded-xl border border-outline-variant/18 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-primary focus:ring-primary/20" name="scheduleNote" placeholder="Note" value="${escapeHtml(state.drafts.scheduleNote)}" />
        <div class="grid gap-2 ${isEditing ? "sm:grid-cols-[1fr_auto]" : ""}">
          <button class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-sm" type="submit">${icon(isEditing ? "save" : "add", "text-[18px]")}${isEditing ? "Save" : "Add"}</button>
          ${
            isEditing
              ? `<button class="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#8A4B3A] shadow-sm ring-1 ring-outline-variant/20" type="button" data-action="delete-schedule-item" data-item-id="${escapeHtml(editingItem.id)}">${icon("delete", "text-[18px]")}Delete</button>`
              : ""
          }
        </div>
      </form>
    </section>
  `;
  return isEditing ? `<div class="schedule-modal-backdrop">${panel}</div>` : panel;
}

function renderScheduleActionDialog() {
  const item = state.selectedScheduleItemId ? scheduleFindItem(state.selectedScheduleItemId) : null;
  if (!item) return "";
  const left = Number.isFinite(state.scheduleActionMenuLeft) ? state.scheduleActionMenuLeft : 16;
  const top = Number.isFinite(state.scheduleActionMenuTop) ? state.scheduleActionMenuTop : 16;
  return `
    <div class="schedule-action-layer">
      <section class="schedule-action-dialog" role="dialog" aria-modal="false" aria-labelledby="schedule-action-title" style="left:${left}px; top:${top}px;">
        <div class="flex items-center justify-between gap-3">
          <h3 id="schedule-action-title" class="min-w-0 truncate text-sm font-bold">${escapeHtml(scheduleResolvedItemTitle(item))}</h3>
          <button class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant hover:text-primary" data-action="close-schedule-actions" title="Close">${icon("close", "text-[18px]")}</button>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-on-primary shadow-sm" data-action="edit-schedule-item" data-item-id="${escapeHtml(item.id)}">
            ${icon("edit", "text-[18px]")}
            <span>Edit</span>
          </button>
          <button class="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-[#8A4B3A] shadow-sm ring-1 ring-outline-variant/20" data-action="delete-schedule-item" data-item-id="${escapeHtml(item.id)}">
            ${icon("delete", "text-[18px]")}
            <span>Delete</span>
          </button>
        </div>
      </section>
    </div>
  `;
}

function renderSchedulePage() {
  const mode = scheduleCurrentViewMode();
  const cursorDate = scheduleCurrentCursorDate();
  const education = state.snapshot?.education;
  const showTimetable = Boolean(education?.schedulePreferences?.showTimetableInSchedule);
  const visibleDates = mode === "month"
    ? scheduleMonthGridDates(cursorDate)
    : Array.from({ length: 7 }, (_, index) => scheduleAddDays(scheduleWeekStart(cursorDate), index));
  const rangeStart = visibleDates[0];
  const rangeEnd = new Date(visibleDates[visibleDates.length - 1]);
  rangeEnd.setHours(23, 59, 59, 999);
  const { entries, courseMap, totalCourses, totalClasses } = scheduleCollectEntries(rangeStart, rangeEnd, { includeClassItems: showTimetable });
  const calendarMarkup = !entries.length
    ? renderScheduleNoClasses(mode)
    : mode === "month"
      ? renderScheduleMonthView(entries, courseMap, cursorDate)
      : renderScheduleWeekView(entries, courseMap, cursorDate);
  const resetLabel = mode === "month" ? "This month" : "This week";

  return `
    <div class="bg-background text-on-surface antialiased flex min-h-screen">
      ${renderSidebar("schedule")}
      <main class="flex-1 flex flex-col h-screen overflow-hidden">
        <div class="flex-1 overflow-y-auto px-5 py-5 custom-scrollbar lg:px-6">
          <div class="relative mx-auto max-w-[1460px]">
            <section class="rounded-[24px] border border-outline-variant/15 bg-surface-container-lowest px-5 py-4 shadow-[0_24px_70px_-48px_rgba(49,51,46,0.28)] lg:px-6">
              <div class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div class="min-w-0">
                  <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-on-surface-variant/60">Schedule</p>
                  <div class="mt-2 flex flex-wrap items-center gap-3">
                    <h2 class="font-headline text-4xl font-bold tracking-tight">${mode === "month" ? "Month view" : "Week view"}</h2>
                    <span class="rounded-full bg-surface-container px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface-variant">${escapeHtml(scheduleRangeLabel(mode, cursorDate))}</span>
                  </div>
                </div>
                <div class="flex flex-col gap-3 xl:items-end">
                  <div class="flex flex-wrap items-center gap-2">
                    <button class="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-on-background shadow-sm ring-1 ring-outline-variant/20 transition-all hover:bg-surface-container-low" data-action="toggle-schedule-composer">
                      ${icon("add", "text-[18px]")}
                      <span>Add</span>
                    </button>
                    <button class="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-sm transition-all ${showTimetable ? "bg-primary text-on-primary" : "bg-white text-on-background ring-1 ring-outline-variant/20 hover:bg-surface-container-low"}" data-action="toggle-schedule-timetable">
                      ${icon(showTimetable ? "visibility_off" : "calendar_add_on", "text-[18px]")}
                      <span>${showTimetable ? "Hide Timetable" : "Show Timetable"}</span>
                    </button>
                    <div class="flex items-center gap-1 rounded-full bg-surface-container-low p-1.5 shadow-sm ring-1 ring-outline-variant/10">
                      <button class="rounded-full px-4 py-2 text-sm font-semibold transition-colors ${mode === "week" ? "bg-white text-primary shadow-sm" : "text-on-surface-variant hover:text-on-background"}" data-action="schedule-set-view" data-mode="week">Week</button>
                      <button class="rounded-full px-4 py-2 text-sm font-semibold transition-colors ${mode === "month" ? "bg-white text-primary shadow-sm" : "text-on-surface-variant hover:text-on-background"}" data-action="schedule-set-view" data-mode="month">Month</button>
                    </div>
                  </div>
                  <div class="flex items-center gap-1 rounded-full bg-surface-container-low p-1.5 shadow-sm ring-1 ring-outline-variant/10">
                    <button class="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-white hover:text-primary" data-action="schedule-prev">${icon("chevron_left")}</button>
                    <button class="rounded-full px-4 py-2 text-sm font-semibold text-on-background transition-colors hover:bg-white" data-action="schedule-today">${escapeHtml(resetLabel)}</button>
                    <button class="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-white hover:text-primary" data-action="schedule-next">${icon("chevron_right")}</button>
                  </div>
                </div>
              </div>
            </section>
            ${renderScheduleComposer()}
            <section class="mt-4 overflow-hidden rounded-[28px] border border-outline-variant/15 bg-surface-container-lowest shadow-[0_34px_90px_-56px_rgba(49,51,46,0.34)]">
              ${calendarMarkup}
            </section>
          </div>
        </div>
      </main>
      ${renderScheduleActionDialog()}
      ${renderFlash()}
    </div>
  `;
}

function renderResourcesPage() {
  const education = state.snapshot?.education;
  const resources = (education?.courseResources || []).filter(isPrimaryCourseResource);
  const itemMap = new Map((education?.courseItems || []).map((item) => [item.id, item]));
  const groups = buildResourceCourseGroups();
  const syncedCourseCount = groups.filter((group) => group.resources.length).length;
  const resourceTypeCounts = countResourceTypes(resources);
  return `
    <div class="flex h-screen bg-background text-on-background overflow-hidden">
      ${renderSidebar("resources")}
      <main class="flex-1 flex flex-col min-w-0 h-screen">
        <header class="flex justify-between items-center px-6 py-4 w-full bg-background border-b border-surface-container-low lg:px-8">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/55">${escapeHtml(t("resources"))}</p>
            <h2 class="font-headline font-bold text-2xl text-primary leading-tight">${escapeHtml(t("courseResourceLibrary"))}</h2>
          </div>
          <div class="flex items-center gap-2">
            <button class="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm" data-action="toggle-resource-composer">${icon("add", "text-[18px]")}${escapeHtml(t("addResource"))}</button>
            <button class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-container text-on-surface-variant hover:text-primary transition-colors" data-action="refresh" title="${escapeHtml(t("refresh"))}">${icon("refresh")}</button>
          </div>
        </header>
        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 py-6 lg:px-8">
          <div class="mx-auto max-w-[1220px] space-y-5">
            ${renderResourceComposer(getSelectedPlan())}
            <section class="resource-overview">
              <div class="grid gap-3 md:grid-cols-3">
                <div class="resource-stat">
                  <span>${escapeHtml(t("coursesWithResources"))}</span>
                  <strong>${escapeHtml(String(syncedCourseCount))}</strong>
                </div>
                <div class="resource-stat">
                  <span>${escapeHtml(t("totalResources"))}</span>
                  <strong>${escapeHtml(String(resources.length))}</strong>
                </div>
                <div class="resource-stat">
                  <span>${escapeHtml(t("sourceModel"))}</span>
                  <strong>${escapeHtml(t("platformAndLocal"))}</strong>
                </div>
              </div>
              <div class="mt-4 flex flex-wrap gap-2">
                ${resourceTypeCounts.length
                  ? resourceTypeCounts.map(([type, count]) => `<span class="resource-chip resource-chip--large">${escapeHtml(resourceTypeLabel(type))} ${escapeHtml(count)}</span>`).join("")
                  : `<span class="text-sm text-on-surface-variant">${escapeHtml(t("noResourcesYet"))}</span>`}
              </div>
            </section>
            <section class="space-y-3">
              ${groups.length
                ? groups.map((group, index) => {
                    const latest = itemDisplayDate(null, group.latest);
                    return `
                      <details class="resource-course-group" ${index === 0 ? "open" : ""}>
                        <summary>
                          <span class="resource-course-mark">${icon("school", "text-[20px]")}</span>
                          <span class="min-w-0 flex-1">
                            <strong class="line-clamp-1 text-base text-on-background">${escapeHtml(courseDisplayTitle(group.course))}</strong>
                            <span class="mt-1 flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
                              ${courseDisplayTeacher(group.course) ? `<span>${escapeHtml(courseDisplayTeacher(group.course))}</span>` : ""}
                              ${group.course.term ? `<span>${escapeHtml(group.course.term)}</span>` : ""}
                              <span>${escapeHtml(String(group.resources.length))} ${escapeHtml(t("resourcesCount"))}</span>
                              ${latest.day !== t("noDate") ? `<span>${escapeHtml(t("latest"))} ${escapeHtml(latest.day)} ${escapeHtml(latest.time)}</span>` : ""}
                            </span>
                          </span>
                          <span class="hidden flex-wrap gap-1.5 md:flex">${renderResourceChips(group.resources)}</span>
                          <span class="resource-course-chevron">${icon("expand_more", "text-[20px]")}</span>
                        </summary>
                        <div class="resource-course-body">
                          ${renderCourseResourceTimeline(group, itemMap)}
                        </div>
                      </details>
                    `;
                  }).join("")
                : `<div class="resource-empty">
                    <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-on-surface-variant">${icon("folder_off", "text-[20px]")}</div>
                    <div>
                      <p class="font-semibold text-on-background">${escapeHtml(t("noCoursesAvailable"))}</p>
                      <p class="mt-1 text-sm leading-6 text-on-surface-variant">${escapeHtml(t("logInSyncFirst"))}</p>
                    </div>
                  </div>`}
            </section>
          </div>
        </div>
      </main>
      ${renderFlash()}
    </div>
  `;
}

function selectedConfigFile() {
  const files = state.snapshot?.configFiles || [];
  return files.find((file) => file.id === state.selectedConfigId) || files[0] || null;
}

function renderConfigPage() {
  const files = state.snapshot?.configFiles || [];
  const selected = selectedConfigFile();
  const descriptions = {
    soul: "Identity, values, and interaction posture.",
    agents: "Operational instructions loaded into the runtime.",
    heartbeat: "Follow-up rhythm and continuity behavior.",
  };
  return `
    <div class="flex h-screen overflow-hidden bg-background text-on-background">
      ${renderSidebar("config")}
      <main class="min-w-0 flex-1 overflow-hidden">
        <section class="mx-auto flex h-full max-w-[1180px] flex-col px-6 py-8 lg:px-10">
          <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-on-surface-variant/60">MentorClaw Runtime</p>
              <h2 class="mt-2 font-headline text-5xl font-bold tracking-tight">Config</h2>
            </div>
            <button class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-container text-on-surface-variant hover:text-primary transition-colors" data-action="refresh" title="Refresh">${icon("refresh")}</button>
          </div>
          <div class="grid min-h-0 flex-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside class="min-h-0 overflow-y-auto rounded-[24px] border border-outline-variant/15 bg-surface-container-lowest p-3 custom-scrollbar">
              ${files.map((file) => `
                <button class="mb-2 w-full rounded-2xl px-4 py-4 text-left transition-all ${file.id === selected?.id ? "bg-primary-container text-primary" : "text-on-surface-variant hover:bg-surface-container-low"}" data-action="select-config" data-config-id="${escapeHtml(file.id)}">
                  <div class="flex items-center gap-3">
                    ${icon(file.id === "heartbeat" ? "monitor_heart" : file.id === "agents" ? "smart_toy" : "psychology", "text-[20px]")}
                    <div class="min-w-0">
                      <p class="truncate text-sm font-bold">${escapeHtml(file.label)}</p>
                      <p class="mt-1 line-clamp-2 text-xs leading-5">${escapeHtml(descriptions[file.id] || file.relativePath)}</p>
                    </div>
                  </div>
                </button>
              `).join("")}
            </aside>
            <form id="config-form" class="flex min-h-0 flex-col rounded-[28px] border border-outline-variant/15 bg-surface-container-lowest shadow-[0_26px_70px_-48px_rgba(49,51,46,0.3)]">
              <div class="flex flex-wrap items-start justify-between gap-4 border-b border-outline-variant/10 px-6 py-5">
                <div class="min-w-0">
                  <h3 class="font-headline text-3xl font-bold">${escapeHtml(selected?.label || "Config")}</h3>
                  <p class="mt-1 break-all text-xs text-on-surface-variant">${escapeHtml(selected?.relativePath || "No config file selected.")}</p>
                </div>
                <button class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm disabled:opacity-60" type="submit" ${state.savingConfig || !selected ? "disabled" : ""}>
                  ${icon(state.savingConfig ? "progress_activity" : "save", "text-[18px]")}
                  <span>${state.savingConfig ? "Saving" : "Save"}</span>
                </button>
              </div>
              <textarea class="min-h-[520px] flex-1 resize-none border-0 bg-white/70 px-6 py-5 font-mono text-sm leading-7 text-on-background focus:ring-0 custom-scrollbar" name="configContent" spellcheck="false">${escapeHtml(selected?.content || "")}</textarea>
              <input type="hidden" name="configId" value="${escapeHtml(selected?.id || "")}" />
            </form>
          </div>
        </section>
      </main>
      ${renderFlash()}
    </div>
  `;
}

function renderLoading() {
  return `
    <div class="min-h-screen flex items-center justify-center bg-background px-6">
      <div class="text-center">
        <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-on-primary">${icon("school")}</div>
        <h1 class="font-headline text-4xl font-bold text-primary">MentorClaw</h1>
        <p class="mt-3 text-sm tracking-[0.24em] uppercase text-on-surface-variant">${escapeHtml(state.loading ? t("loadingRuntime") : t("preparingAtelier"))}</p>
      </div>
    </div>
  `;
}

function renderApp() {
  if (!state.snapshot) return renderLoading();
  const page =
    state.activeView === "new-project"
      ? renderNewProjectPage()
      : state.activeView === "crons"
        ? renderCronsPage()
        : state.activeView === "cron"
          ? renderCronDetailPage()
          : state.activeView === "projects"
            ? renderProjectsPage()
            : state.activeView === "config"
              ? renderConfigPage()
              : state.activeView === "schedule"
                ? renderSchedulePage()
                : state.activeView === "resources"
                  ? renderResourcesPage()
                  : state.activeView === "project"
                    ? renderProjectPage()
                    : renderDashboardPage();
  return `${page}${renderBuaaLoginModal()}`;
}

function render() {
  const projectScroller = document.getElementById("project-page-scroll");
  const restoreProjectScroll =
    state.activeView === "project"
    && app.dataset.activeView === "project"
    && app.dataset.selectedPlanId === state.selectedPlanId
    && app.dataset.selectedThreadId === state.selectedThreadId
    && projectScroller;
  const projectScrollTop = restoreProjectScroll ? projectScroller.scrollTop : 0;
  app.innerHTML = renderApp();
  app.dataset.activeView = state.activeView || "";
  app.dataset.selectedPlanId = state.selectedPlanId || "";
  app.dataset.selectedThreadId = state.selectedThreadId || "";
  if (state.activeView === "project" && state.activeFilePath) ensureFileLoaded(state.activeFilePath);
  if (state.activeView === "project") {
    window.requestAnimationFrame(() => {
      if (restoreProjectScroll) {
        const nextProjectScroller = document.getElementById("project-page-scroll");
        if (nextProjectScroller) nextProjectScroller.scrollTop = projectScrollTop;
      }
      const feed = document.getElementById("chat-feed");
      if (feed) feed.scrollTop = feed.scrollHeight;
    });
  }
}

function scrollToId(id) {
  const element = document.getElementById(id);
  if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
}

function randomSessionTitle() {
  return "New session";
}

function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
  if (target.name === "sessionKey") {
    state.sessionKey = target.value;
    writeStored("sessionKey", state.sessionKey);
    return;
  }
  if (target.name === "language") {
    state.language = target.value === "en" ? "en" : "zh";
    writeStored("language", state.language);
    render();
    return;
  }
  if (target.name === "objectSearch") {
    state.objectSearch = target.value;
    writeStored("objectSearch", state.objectSearch);
    render();
    return;
  }
  if (target.name in state.drafts) {
    state.drafts[target.name] = target.value;
    if (target.name === "quickCourseId") state.drafts.quickItemId = "";
    if (target.name === "resourceCourseId") {
      state.drafts.resourceItemId = "";
      render();
      if (state.drafts.resourceSourceMode === "platform") syncSelectedCourseResources(target.value, { quiet: true });
    }
    if (target.name === "scheduleStartTime") {
      scheduleNormalizeManualTimes();
      render();
    }
  }
}

function handleKeyDown(event) {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  if (target.name !== "userMessage") return;
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  target.form?.requestSubmit();
}

async function handleChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name !== "resourceFile") return;
  const file = target.files?.[0];
  if (!file) return;

  state.uploadingResource = true;
  render();
  try {
    const snapshot = await request("/api/education/resources/upload", {
      method: "POST",
      body: JSON.stringify({
        courseId: state.drafts.resourceCourseId || getSelectedPlan()?.courseIds?.[0] || undefined,
        projectId: state.selectedPlanId || undefined,
        fileName: file.name,
        contentType: file.type || undefined,
        base64: await fileToBase64(file),
      }),
    });
    invalidateFileCache();
    state.snapshot = snapshot;
    state.showResourceComposer = false;
    syncSelection();
    setFlash("info", t("localFileUploaded"));
  } catch (error) {
    setFlash("error", error.message);
  } finally {
    state.uploadingResource = false;
    target.value = "";
    render();
  }
}

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "open-resource") {
    event.preventDefault();
    event.stopPropagation();
    const href = button.dataset.href || button.getAttribute("href") || "";
    if (!href) return setFlash("error", t("openableMissing"));
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = href;
    return;
  }
  if (action === "set-view") {
    state.activeView = button.dataset.view || "dashboard";
    if (state.activeView === "new-project") {
      state.drafts.planTitle = "";
      state.drafts.planCourseId = "";
    }
    if (state.activeView !== "crons") state.showDashboardCron = false;
    syncSelection();
    render();
    return;
  }
  if (action === "dismiss-buaa-login") {
    state.showBuaaLogin = false;
    state.buaaLoginDismissed = true;
    resetBuaaLoginContext();
    render();
    return;
  }
  if (action === "open-buaa-login") {
    resetBuaaLoginContext();
    state.showBuaaLogin = true;
    state.buaaLoginDismissed = false;
    render();
    return;
  }
  if (action === "toggle-left-sidebar") {
    state.leftSidebarCollapsed = !state.leftSidebarCollapsed;
    syncSelection();
    render();
    return;
  }
  if (action === "refresh") return refresh();
  if (action === "select-plan") {
    const planId = button.dataset.planId || state.snapshot?.activePlanId || state.snapshot?.plans?.[0]?.planId || "";
    if (!planId) return;
    state.selectedPlanId = planId;
    state.selectedThreadId = "";
    state.sessionKey = "";
    state.activeView = "project";
    state.cronPreview = null;
    state.showCronComposer = false;
    resetCronDraft();
    syncSelection();
    render();
    return;
  }
  if (action === "toggle-project-sessions") {
    const planId = button.dataset.planId || "";
    if (!planId) return;
    if (planId !== state.selectedPlanId) {
      state.selectedPlanId = planId;
      state.selectedThreadId = "";
      state.sessionKey = "";
      state.activeView = "project";
      state.cronPreview = null;
      state.showCronComposer = false;
      resetCronDraft();
      setProjectSessionsCollapsed(planId, false);
    } else {
      setProjectSessionsCollapsed(planId, !projectSessionsCollapsed(planId));
    }
    syncSelection();
    render();
    return;
  }
  if (action === "toggle-project-session-overflow") {
    const planId = button.dataset.planId || state.selectedPlanId || "";
    if (!planId) return;
    setProjectExtraSessionsExpanded(planId, !projectExtraSessionsExpanded(planId));
    render();
    return;
  }
  if (action === "select-thread") {
    state.selectedPlanId = button.dataset.planId || state.selectedPlanId;
    state.selectedThreadId = button.dataset.threadId || "";
    state.activeView = "project";
    state.showCronComposer = false;
    resetCronDraft();
    syncSelection();
    render();
    return;
  }
  if (action === "new-chat") {
    const planId = button.dataset.planId || state.selectedPlanId || state.snapshot?.activePlanId || state.snapshot?.plans?.[0]?.planId || "";
    if (!planId) {
      state.activeView = "new-project";
      render();
      return;
    }
    const alreadyOnDraft = state.activeView === "project" && state.selectedPlanId === planId && !state.selectedThreadId;
    state.selectedPlanId = planId;
    if (!alreadyOnDraft) state.sessionKey = "";
    state.selectedThreadId = "";
    state.activeView = "project";
    state.showCreateThread = false;
    state.showCronComposer = false;
    resetCronDraft();
    setProjectSessionsCollapsed(planId, false);
    syncSelection();
    render();
    return;
  }
  if (action === "new-cron") {
    const planId = button.dataset.planId || state.selectedPlanId || "";
    if (!planId) return;
    state.selectedPlanId = planId;
    state.selectedThreadId = "";
    state.sessionKey = "";
    state.activeView = "project";
    state.showCronComposer = true;
    state.showResourceComposer = false;
    resetCronDraft();
    syncSelection();
    render();
    return;
  }
  if (action === "close-thread-form") {
    state.showCreateThread = false;
    render();
    return;
  }
  if (action === "toggle-panel") {
    const key = button.dataset.panel;
    if (!key) return;
    state.collapsedPanels[key] = !state.collapsedPanels[key];
    writeCollapsedPanels();
    render();
    return;
  }
  if (action === "toggle-resource-composer") {
    state.showResourceComposer = !state.showResourceComposer;
    if (state.showResourceComposer) syncResourceCourseDraft();
    syncSelection();
    render();
    if (state.showResourceComposer && state.drafts.resourceSourceMode === "platform") {
      syncSelectedCourseResources(state.drafts.resourceCourseId, { quiet: true });
    }
    return;
  }
  if (action === "set-resource-source") {
    state.drafts.resourceSourceMode = button.dataset.sourceMode === "local" ? "local" : "platform";
    syncResourceCourseDraft();
    render();
    if (state.drafts.resourceSourceMode === "platform") syncSelectedCourseResources(state.drafts.resourceCourseId, { quiet: true });
    return;
  }
  if (action === "sync-course-resources") {
    const courseId = button.dataset.courseId || state.drafts.resourceCourseId || "";
    syncSelectedCourseResources(courseId);
    return;
  }
  if (action === "choose-resource-file") {
    const form = button.closest("form");
    const input = form?.querySelector('input[name="resourceFile"]');
    input?.click();
    return;
  }
  if (action === "toggle-cron-composer") {
    state.showCronComposer = !state.showCronComposer;
    if (state.showCronComposer) resetCronDraft();
    syncSelection();
    render();
    return;
  }
  if (action === "toggle-dashboard-summary") {
    state.showDashboardSummary = !state.showDashboardSummary;
    if (state.showDashboardSummary) state.showDashboardCron = false;
    syncSelection();
    render();
    return;
  }
  if (action === "toggle-dashboard-cron") {
    state.showDashboardCron = !state.showDashboardCron;
    if (state.showDashboardCron) state.showDashboardSummary = false;
    if (state.showDashboardCron) resetDashboardCronDraft();
    syncSelection();
    render();
    return;
  }
  if (action === "new-global-cron") {
    resetDashboardCronDraft();
    state.showDashboardCron = true;
    state.showDashboardSummary = false;
    state.activeView = "crons";
    syncSelection();
    render();
    return;
  }
  if (action === "select-cron") {
    state.selectedCronId = button.dataset.cronId || "";
    state.activeView = "cron";
    state.showDashboardCron = false;
    resetDashboardCronDraft();
    syncSelection();
    render();
    return;
  }
  if (action === "select-config") {
    state.selectedConfigId = button.dataset.configId || "soul";
    syncSelection();
    render();
    return;
  }
  if (action === "edit-dashboard-cron") {
    const cron = (state.snapshot?.crons || []).find((entry) => entry.cronId === button.dataset.cronId);
    if (!cron) return setFlash("error", "Cron was not found.");
    state.selectedCronId = cron.cronId;
    setDashboardCronDraft(cron);
    state.showDashboardCron = true;
    state.showDashboardSummary = false;
    syncSelection();
    render();
    return;
  }
  if (action === "cancel-dashboard-cron-edit") {
    resetDashboardCronDraft();
    state.showDashboardCron = false;
    render();
    return;
  }
  if (action === "toggle-dashboard-cron-enabled") {
    const cron = (state.snapshot?.crons || []).find((entry) => entry.cronId === button.dataset.cronId);
    if (!cron) return setFlash("error", "Cron was not found.");
    submitJson("/api/crons/update", {
      cronId: cron.cronId,
      title: cron.title,
      schedule: cron.schedule,
      prompt: cron.prompt,
      enabled: cron.enabled === false,
      projectId: cron.projectId || undefined,
      courseIds: cron.courseIds || [],
    }, async (snapshot) => {
      state.snapshot = snapshot;
      syncSelection();
      render();
      setFlash("info", cron.enabled === false ? "Cron enabled." : "Cron disabled.");
    });
    return;
  }
  if (action === "delete-dashboard-cron") {
    const cronId = button.dataset.cronId || "";
    if (!cronId) return;
    if (!window.confirm("Delete this Cron?")) return;
    submitJson("/api/crons/delete", { cronId }, async (snapshot) => {
      state.snapshot = snapshot;
      if (state.editingDashboardCronId === cronId) resetDashboardCronDraft();
      syncSelection();
      render();
      setFlash("info", "Cron deleted.");
    });
    return;
  }
  if (action === "toggle-schedule-composer") {
    state.showScheduleComposer = !state.showScheduleComposer;
    state.selectedScheduleItemId = "";
    state.editingScheduleItemId = "";
    if (state.showScheduleComposer) {
      scheduleResetDrafts();
    }
    render();
    return;
  }
  if (action === "close-schedule-composer") {
    state.showScheduleComposer = false;
    state.selectedScheduleItemId = "";
    state.editingScheduleItemId = "";
    render();
    return;
  }
  if (action === "open-schedule-actions") {
    const item = scheduleFindItem(button.dataset.itemId || "");
    if (!item) return;
    const rect = button.getBoundingClientRect();
    const menuWidth = 260;
    const menuHeight = 104;
    let left = rect.right + 8;
    if (left + menuWidth > window.innerWidth - 16) {
      left = rect.left - menuWidth - 8;
    }
    state.scheduleActionMenuLeft = Math.round(Math.max(16, Math.min(left, window.innerWidth - menuWidth - 16)));
    state.scheduleActionMenuTop = Math.round(Math.max(16, Math.min(rect.top, window.innerHeight - menuHeight - 16)));
    state.selectedScheduleItemId = item.id;
    state.showScheduleComposer = false;
    state.editingScheduleItemId = "";
    render();
    return;
  }
  if (action === "close-schedule-actions") {
    state.selectedScheduleItemId = "";
    render();
    return;
  }
  if (action === "edit-schedule-item") {
    const item = scheduleFindItem(button.dataset.itemId || "");
    if (!item) return;
    state.editingScheduleItemId = item.id;
    state.selectedScheduleItemId = "";
    state.showScheduleComposer = false;
    scheduleSetDraftFromItem(item);
    render();
    return;
  }
  if (action === "delete-schedule-item") {
    const itemId = button.dataset.itemId || state.editingScheduleItemId;
    if (!itemId) return;
    submitJson("/api/education/schedule-items/delete", { itemId }, async (snapshot) => {
      state.snapshot = snapshot;
      state.selectedScheduleItemId = "";
      state.editingScheduleItemId = "";
      state.showScheduleComposer = false;
      syncSelection();
      render();
      setFlash("info", "Schedule deleted.");
    });
    return;
  }
  if (action === "run-cron") {
    const cronId = button.dataset.cronId;
    if (!cronId) return;
    state.runningCronId = cronId;
    state.selectedCronId = cronId;
    render();
    request("/api/crons/run", { method: "POST", body: JSON.stringify({ cronId }) })
      .then(async (preview) => {
        state.selectedCronId = cronId;
        state.snapshot = await request("/api/state");
        syncSelection();
        render();
        setFlash("info", preview.canRun ? "Cron run finished." : preview.reason || "Cron run finished.");
      })
      .catch((error) => setFlash("error", error.message))
      .finally(() => {
        state.runningCronId = "";
        render();
      });
    return;
  }
  if (action === "new-session") {
    state.sessionKey = `browser-${Date.now().toString(36)}`;
    syncSelection();
    render();
    return;
  }
  if (action === "select-session") {
    state.sessionKey = button.dataset.sessionKey || "";
    syncSelection();
    render();
    return;
  }
  if (action === "bind-session") {
    if (!state.selectedPlanId || !state.selectedThreadId) return setFlash("error", "Select a project and conversation first.");
    state.sessionKey = state.sessionKey.trim() || `browser-${Date.now().toString(36)}`;
    submitJson("/api/bindings", { sessionKey: state.sessionKey, planId: state.selectedPlanId, threadId: state.selectedThreadId }, async (snapshot) => {
      state.snapshot = snapshot;
      syncSelection();
      render();
      setFlash("info", "Session binding updated.");
    });
    return;
  }
  if (action === "unbind-session") {
    if (!state.sessionKey.trim()) return;
    submitJson("/api/bindings/unbind", { sessionKey: state.sessionKey.trim() }, async (snapshot) => {
      state.snapshot = snapshot;
      state.sessionKey = "";
      syncSelection();
      render();
      setFlash("info", "Session binding removed.");
    });
    return;
  }
  if (action === "open-file") {
    state.collapsedPanels.files = false;
    writeCollapsedPanels();
    return setActiveFile(button.dataset.path || "");
  }
  if (action === "focus-files") {
    state.collapsedPanels.files = false;
    writeCollapsedPanels();
    render();
    return scrollToId("sources-panel");
  }
  if (action === "toggle-schedule-timetable") {
    const nextValue = !(state.snapshot?.education?.schedulePreferences?.showTimetableInSchedule);
    updateSchedulePreferences(
      { showTimetableInSchedule: nextValue },
      nextValue ? "Timetable loaded into the calendar." : "Timetable hidden from the calendar.",
    );
    return;
  }
  if (action === "schedule-set-view") {
    const nextMode = button.dataset.mode === "month" ? "month" : "week";
    state.scheduleViewMode = nextMode;
    syncSelection();
    render();
    updateSchedulePreferences(
      { scheduleDefaultView: nextMode },
      nextMode === "month" ? "Month view ready." : "Week view ready.",
    );
    return;
  }
  if (action === "schedule-prev") {
    const current = scheduleCurrentCursorDate();
    state.scheduleCursorDate = (scheduleCurrentViewMode() === "month" ? scheduleAddMonths(current, -1) : scheduleAddDays(current, -7)).toISOString();
    syncSelection();
    render();
    return;
  }
  if (action === "schedule-next") {
    const current = scheduleCurrentCursorDate();
    state.scheduleCursorDate = (scheduleCurrentViewMode() === "month" ? scheduleAddMonths(current, 1) : scheduleAddDays(current, 7)).toISOString();
    syncSelection();
    render();
    return;
  }
  if (action === "schedule-today") {
    state.scheduleCursorDate = new Date().toISOString();
    syncSelection();
    render();
    return;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.id === "buaa-login-form") {
    const username = state.drafts.buaaUsername.trim();
    const password = state.drafts.buaaPassword;
    const loginIntent = state.buaaLoginIntent;
    const pendingCourseId = state.pendingBuaaCourseId;
    const rawMsaCourseIds = state.drafts.buaaMsaCourseIds
      .split(/[,\s，]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const msaCourseIds = buaaLoginNeedsMsaCourseIds() ? rawMsaCourseIds : [];
    if (!username || !password.trim()) return setFlash("error", "请输入北航账号和密码。");
    state.submittingBuaaLogin = true;
    render();
    try {
      const snapshot = await request("/api/education/buaa/login", {
        method: "POST",
        body: JSON.stringify({ username, password, msaCourseIds }),
      });
      invalidateFileCache();
      state.snapshot = snapshot;
      state.showBuaaLogin = false;
      state.buaaLoginDismissed = false;
      state.drafts.buaaPassword = "";
      resetBuaaLoginContext();
      syncSelection();
      render();
      if (pendingCourseId && (loginIntent === "retry-sync" || (loginIntent === "map-and-sync" && msaCourseIds.length))) {
        await syncSelectedCourseResources(pendingCourseId, { quiet: true });
      }
      setFlash("info", "北航课表和 MSA 课程映射已同步。");
      if (loginIntent === "retry-sync") {
        setFlash("info", "MSA 登录已恢复，并已继续同步刚才那门课的资源。");
      } else if (loginIntent === "map-and-sync") {
        setFlash("info", "MentorClaw 已重新发现课程映射，并继续同步刚才那门课的资源。");
      }
    } catch (error) {
      setFlash("error", error.message);
    } finally {
      state.submittingBuaaLogin = false;
      render();
    }
    return;
  }

  if (form.id === "dashboard-summary-form") {
    const courseId = dashboardCourseId();
    const course = getAvailableCourses().find((item) => item.id === courseId);
    const item = dashboardCourseItems(courseId).find((entry) => entry.id === state.drafts.quickItemId) || dashboardCourseItems(courseId)[0];
    if (!courseId || !course) return setFlash("error", "Choose a course first.");
    if (!item) return setFlash("error", "No class or replay item is available for this course yet.");
    try {
      let plan = (state.snapshot?.plans || []).find((entry) => entry.courseIds?.includes(courseId)) || null;
      if (!plan) {
        const snapshot = await request("/api/plans", {
          method: "POST",
          body: JSON.stringify({
            title: `${course.title} · 课程总结`,
            goals: [],
            timebox: "manual",
            courseIds: [courseId],
          }),
        });
        invalidateFileCache();
        state.snapshot = snapshot;
        plan = snapshot.plans.find((entry) => entry.courseIds?.includes(courseId)) || snapshot.plans.find((entry) => entry.planId === snapshot.activePlanId) || null;
      }
      if (!plan) throw new Error("Could not resolve a course project for this summary.");
      const itemTitle = scheduleResolvedItemTitle(item);
      const threadSnapshot = await request("/api/threads", {
        method: "POST",
        body: JSON.stringify({
          planId: plan.planId,
          title: `总结：${itemTitle}`,
          currentQuestion: `总结 ${course.title} 的 ${itemTitle}`,
        }),
      });
      invalidateFileCache();
      state.snapshot = threadSnapshot;
      const updatedPlan = state.snapshot.plans.find((entry) => entry.planId === plan.planId);
      const thread = updatedPlan?.threads?.find((entry) => entry.title === `总结：${itemTitle}`) || updatedPlan?.threads?.[0];
      if (!thread) throw new Error("Could not create a summary session.");
      state.selectedPlanId = plan.planId;
      state.selectedThreadId = thread.threadId;
      state.sessionKey = `browser-${Date.now().toString(36)}`;
      state.activeView = "project";
      state.showDashboardSummary = false;
      state.submittingTurn = true;
      state.pendingTurnMessage = `请总结 ${course.title} 的 ${itemTitle}`;
      syncSelection();
      render();
      const result = await request("/api/turns", {
        method: "POST",
        body: JSON.stringify({
          sessionKey: state.sessionKey,
          planId: state.selectedPlanId,
          threadId: state.selectedThreadId,
          message: `请基于已有课程资源，总结《${course.title}》的「${itemTitle}」：先列出核心知识点，再列出需要复习的问题，最后给出下一步行动。`,
          forceWorkflow: "review",
        }),
      });
      state.snapshot = result.snapshot;
      state.selectedPlanId = result.binding.planId;
      state.selectedThreadId = result.binding.threadId;
      state.sessionKey = result.binding.sessionKey;
      syncSelection();
      setFlash("info", "Summary started.");
    } catch (error) {
      setFlash("error", error.message);
    } finally {
      state.submittingTurn = false;
      state.pendingTurnMessage = "";
      render();
    }
    return;
  }

  if (form.id === "global-cron-form") {
    const selectedCourseId = state.drafts.quickCourseId.trim();
    const title = state.drafts.quickCronTitle.trim() || "New Cron";
    const schedule = state.drafts.quickCronSchedule.trim();
    const prompt = state.drafts.quickCronPrompt.trim();
    if (!schedule) return setFlash("error", "Schedule rule is required.");
    if (!prompt) return setFlash("error", "Cron prompt is required.");
    const editingCron = state.editingDashboardCronId
      ? (state.snapshot?.crons || []).find((cron) => cron.cronId === state.editingDashboardCronId)
      : null;
    state.submittingCronForm = true;
    render();
    try {
      await submitJson(editingCron ? "/api/crons/update" : "/api/crons", {
        ...(editingCron ? { cronId: editingCron.cronId } : {}),
        title,
        schedule,
        prompt,
        enabled: editingCron ? editingCron.enabled !== false : true,
        projectId: undefined,
        courseIds: selectedCourseId ? [selectedCourseId] : [],
      }, async (snapshot) => {
        state.snapshot = snapshot;
        const saved = editingCron
          ? snapshot.crons.find((entry) => entry.cronId === editingCron.cronId)
          : snapshot.crons.find((entry) => entry.title === title) || snapshot.crons[0];
        state.selectedCronId = saved?.cronId || state.selectedCronId;
        state.showDashboardCron = false;
        resetDashboardCronDraft();
        syncSelection();
        render();
        setFlash("info", editingCron ? "Cron saved and explained." : "Cron created and explained.");
      });
    } finally {
      state.submittingCronForm = false;
      render();
    }
    return;
  }

  if (form.id === "cron-message-form") {
    const cron = selectedCron();
    const message = state.drafts.cronMessage.trim();
    if (!cron) return setFlash("error", "Select a Cron first.");
    if (!message) return setFlash("error", "Type a message first.");
    state.sendingCronMessage = true;
    render();
    try {
      const snapshot = await request("/api/crons/message", {
        method: "POST",
        body: JSON.stringify({ cronId: cron.cronId, message }),
      });
      state.snapshot = snapshot;
      state.drafts.cronMessage = "";
      syncSelection();
      render();
      setFlash("info", "MentorClaw replied.");
    } catch (error) {
      setFlash("error", error.message);
    } finally {
      state.sendingCronMessage = false;
      render();
    }
    return;
  }

  if (form.id === "dashboard-cron-form") {
    const courseId = dashboardCourseId();
    const course = getAvailableCourses().find((item) => item.id === courseId);
    if (!courseId || !course) return setFlash("error", "Choose a course first.");
    const title = state.drafts.quickCronTitle.trim() || `${course.title} · Cron`;
    const schedule = state.drafts.quickCronSchedule.trim();
    const prompt = state.drafts.quickCronPrompt.trim();
    if (!schedule) return setFlash("error", "Schedule rule is required.");
    if (!prompt) return setFlash("error", "Cron prompt is required.");
    const editingCron = state.editingDashboardCronId
      ? (state.snapshot?.crons || []).find((cron) => cron.cronId === state.editingDashboardCronId)
      : null;
    await submitJson(editingCron ? "/api/crons/update" : "/api/crons", {
      ...(editingCron ? { cronId: editingCron.cronId } : {}),
      title,
      schedule,
      prompt,
      enabled: editingCron ? editingCron.enabled !== false : true,
      projectId: undefined,
      courseIds: [courseId],
    }, async (snapshot) => {
      state.snapshot = snapshot;
      state.showDashboardCron = false;
      resetDashboardCronDraft();
      syncSelection();
      render();
      setFlash("info", editingCron ? "Cron saved." : "Cron created.");
    });
    return;
  }

  if (form.id === "create-plan-form") {
    const title = state.drafts.planTitle.trim();
    await submitJson("/api/plans", {
      title,
      goals: [],
      timebox: "7d",
      courseIds: state.drafts.planCourseId ? [state.drafts.planCourseId] : [],
    }, async (snapshot) => {
      state.snapshot = snapshot;
      const createdPlan = snapshot.plans.find((plan) => plan.planId === snapshot.activePlanId)
        || snapshot.plans.find((plan) => plan.title === title)
        || snapshot.plans[0];
      state.selectedPlanId = createdPlan?.planId || "";
      state.selectedThreadId = "";
      state.sessionKey = "";
      state.activeView = "project";
      setProjectSessionsCollapsed(state.selectedPlanId, false);
      state.drafts.planTitle = "";
      syncSelection();
      render();
      setFlash("info", "Project initialized in the runtime.");
    });
    return;
  }

  if (form.id === "create-thread-form") {
    if (!state.selectedPlanId) return setFlash("error", "Select a project first.");
    await submitJson("/api/threads", {
      planId: state.selectedPlanId,
      title: state.drafts.threadTitle.trim() || randomSessionTitle(),
      currentQuestion: state.drafts.threadQuestion.trim() || undefined,
    }, async (snapshot) => {
      state.snapshot = snapshot;
      const plan = snapshot.plans.find((item) => item.planId === state.selectedPlanId);
      state.selectedThreadId = plan?.threads?.[0]?.threadId || "";
      state.showCreateThread = false;
      state.drafts.threadTitle = "";
      state.drafts.threadQuestion = "";
      syncSelection();
      render();
      setFlash("info", "New session created.");
    });
    return;
  }

  if (form.id === "resource-form") {
    const courseId = state.drafts.resourceCourseId || getSelectedPlan()?.courseIds?.[0] || "";
    if (!courseId) return setFlash("error", t("chooseCourseBeforeResource"));
    await submitJson("/api/education/resources", {
      courseId,
      projectId: state.selectedPlanId || undefined,
      title: state.drafts.resourceTitle || undefined,
      resourceType: state.drafts.resourceType || undefined,
      linkedItemId: state.drafts.resourceItemId || undefined,
      localPath: state.drafts.resourcePath || undefined,
      url: state.drafts.resourceUrl || undefined,
    }, async (snapshot) => {
      state.snapshot = snapshot;
      state.showResourceComposer = false;
      state.drafts.resourceTitle = "";
      state.drafts.resourcePath = "";
      state.drafts.resourceUrl = "";
      state.drafts.resourceType = "";
      syncSelection();
      render();
      setFlash("info", t("localResourceImported"));
    });
    return;
  }

  if (form.id === "cron-form") {
    const plan = getSelectedPlan();
    const courseIds = plan?.courseIds?.length ? plan.courseIds : state.drafts.resourceCourseId ? [state.drafts.resourceCourseId] : [];
    if (!state.drafts.cronSchedule.trim()) return setFlash("error", "Schedule rule is required.");
    await submitJson("/api/crons", {
      title: state.drafts.cronTitle,
      schedule: state.drafts.cronSchedule,
      prompt: state.drafts.cronPrompt,
      enabled: true,
      projectId: state.selectedPlanId || undefined,
      courseIds,
    }, async (snapshot) => {
      state.snapshot = snapshot;
      state.showCronComposer = false;
      resetCronDraft();
      syncSelection();
      render();
      setFlash("info", "Cron created.");
    });
    return;
  }

  if (form.id === "schedule-manual-form") {
    const startAt = scheduleLocalDateTime(scheduleComposerDateValue(), state.drafts.scheduleStartTime);
    const endAt = scheduleLocalDateTime(scheduleComposerDateValue(), state.drafts.scheduleEndTime);
    if (!state.drafts.scheduleTitle.trim()) return setFlash("error", "Schedule title is required.");
    if (!startAt || !endAt) return setFlash("error", "Choose a valid date and time.");
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) return setFlash("error", "End time must be after start time.");
    const isEditing = Boolean(state.editingScheduleItemId);
    await submitJson(isEditing ? "/api/education/schedule-items/update" : "/api/education/schedule-items", {
      ...(isEditing ? { itemId: state.editingScheduleItemId } : {}),
      title: state.drafts.scheduleTitle,
      startAt,
      endAt,
      location: state.drafts.scheduleLocation || undefined,
      note: state.drafts.scheduleNote || undefined,
    }, async (snapshot) => {
      state.snapshot = snapshot;
      state.showScheduleComposer = false;
      state.editingScheduleItemId = "";
      state.drafts.scheduleTitle = "";
      state.drafts.scheduleLocation = "";
      state.drafts.scheduleNote = "";
      syncSelection();
      render();
      setFlash("info", isEditing ? "Schedule saved." : "Schedule added.");
    });
    return;
  }

  if (form.id === "user-turn-form") {
    const message = state.drafts.userMessage.trim();
    if (!message) return setFlash("error", "Type a message first.");
    if (state.selectedPlanId && !state.selectedThreadId) {
      try {
        const snapshot = await request("/api/threads", {
          method: "POST",
          body: JSON.stringify({
            planId: state.selectedPlanId,
            title: randomSessionTitle(),
            currentQuestion: message,
          }),
        });
        invalidateFileCache();
        state.snapshot = snapshot;
        const plan = snapshot.plans.find((item) => item.planId === state.selectedPlanId);
        state.selectedThreadId = plan?.threads?.[0]?.threadId || "";
        syncSelection();
      } catch (error) {
        return setFlash("error", error.message);
      }
    }
    state.submittingTurn = true;
    state.pendingTurnMessage = message;
    render();
    await submitJson("/api/turns", {
      sessionKey: state.sessionKey.trim() || `browser-${Date.now().toString(36)}`,
      planId: state.selectedPlanId || undefined,
      threadId: state.selectedThreadId || undefined,
      message,
      forceWorkflow: state.forceWorkflow === "auto" ? undefined : state.forceWorkflow,
    }, async (result) => {
      state.snapshot = result.snapshot;
      state.selectedPlanId = result.binding.planId;
      state.selectedThreadId = result.binding.threadId;
      state.sessionKey = result.binding.sessionKey;
      state.activeView = "project";
      state.drafts.userMessage = "";
      syncSelection();
      render();
      setFlash("info", "Message sent and reply recorded into the runtime.");
    });
    state.submittingTurn = false;
    state.pendingTurnMessage = "";
    render();
    return;
  }

  if (form.id === "assistant-reply-form") {
    await submitJson("/api/assistant-replies", { sessionKey: state.sessionKey.trim(), text: state.drafts.assistantMessage }, async (snapshot) => {
      state.snapshot = snapshot;
      state.drafts.assistantMessage = "";
      syncSelection();
      render();
      setFlash("info", "Assistant reply recorded into thread memory.");
    });
    return;
  }

  if (form.id === "config-form") {
    const selected = selectedConfigFile();
    const content = form.querySelector('[name="configContent"]')?.value || "";
    if (!selected) return setFlash("error", "Choose a config file first.");
    state.savingConfig = true;
    render();
    try {
      await submitJson("/api/config", { id: selected.id, content }, async (snapshot) => {
        state.snapshot = snapshot;
        syncSelection();
        render();
        setFlash("info", "MentorClaw config saved.");
      });
    } finally {
      state.savingConfig = false;
      render();
    }
  }
}

app.addEventListener("click", handleClick);
app.addEventListener("input", handleInput);
app.addEventListener("change", handleChange);
app.addEventListener("keydown", handleKeyDown);
app.addEventListener("submit", handleSubmit);

refresh();











