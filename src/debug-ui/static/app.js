const app = document.getElementById("app");
const STORAGE_PREFIX = "mentorclaw.stitch";

const state = {
  snapshot: null,
  loading: false,
  loadingFilePath: "",
  activeView: readStored("activeView") || "dashboard",
  selectedPlanId: readStored("selectedPlanId"),
  selectedThreadId: readStored("selectedThreadId"),
  sessionKey: readStored("sessionKey"),
  activeFilePath: readStored("activeFilePath"),
  scheduleOffsetWeeks: Number(readStored("scheduleOffsetWeeks") || "0") || 0,
  forceWorkflow: readStored("forceWorkflow") || "auto",
  flash: null,
  fileCache: {},
  showCreateThread: false,
  collapsedPanels: readCollapsedPanels(),
  submittingTurn: false,
  pendingTurnMessage: "",
  drafts: {
    planTitle: "",
    planOutcome: "",
    threadTitle: "",
    threadQuestion: "",
    userMessage: "",
    assistantMessage: "",
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

function readStored(key) {
  return localStorage.getItem(`${STORAGE_PREFIX}.${key}`) || "";
}

function writeStored(key, value) {
  localStorage.setItem(`${STORAGE_PREFIX}.${key}`, String(value ?? ""));
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

function formatDateShort(value, locale = "en-US", options = { month: "short", day: "numeric" }) {
  if (!value) return "Unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, options);
}

function formatClock(value) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function getSelectedPlan() {
  return state.snapshot?.plans.find((plan) => plan.planId === state.selectedPlanId) || null;
}

function getSelectedThread() {
  const plan = getSelectedPlan();
  return plan?.threads.find((thread) => thread.threadId === state.selectedThreadId) || null;
}

function getSelectedBinding() {
  return state.snapshot?.sessionBindings.find((binding) => binding.sessionKey === state.sessionKey) || null;
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
    if (plan && !plan.threads.some((thread) => thread.threadId === state.selectedThreadId)) {
      state.selectedThreadId = plan.threads[0]?.threadId || "";
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

  writeStored("activeView", state.activeView);
  writeStored("selectedPlanId", state.selectedPlanId);
  writeStored("selectedThreadId", state.selectedThreadId);
  writeStored("sessionKey", state.sessionKey);
  writeStored("activeFilePath", state.activeFilePath);
  writeStored("scheduleOffsetWeeks", state.scheduleOffsetWeeks);
  writeStored("forceWorkflow", state.forceWorkflow);
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

function sidebarProjectButtons(activePlanId) {
  const plans = state.snapshot?.plans || [];
  if (!plans.length) {
    return `<div class="px-4 py-3 rounded-lg bg-white/40 text-sm text-on-surface-variant">No projects yet</div>`;
  }
  return plans
    .map((plan) => {
      const active = plan.planId === activePlanId;
      return `
        <button class="w-full flex items-center gap-3 px-4 py-3 text-sm rounded-lg transition-all ${
          active ? "bg-primary-container text-[#4F5D3D] font-bold" : "text-on-surface-variant hover:bg-white/30 font-medium"
        }" data-action="select-plan" data-plan-id="${escapeHtml(plan.planId)}">
          ${icon("folder", "text-xl")}
          <span class="truncate">${escapeHtml(plan.title)}</span>
        </button>
      `;
    })
    .join("");
}

function renderSidebar(mode) {
  const activePlan = getSelectedPlan();
  return `
    <aside class="flex flex-col h-screen w-64 p-4 gap-2 sticky left-0 shrink-0 bg-surface-container-low">
      <div class="flex items-center gap-3 px-2 py-4 mb-4">
        ${brandMark()}
        <div>
          <h1 class="font-headline font-bold text-xl text-primary leading-tight">MentorClaw</h1>
          <p class="font-body font-medium text-xs text-on-surface-variant">AI Learning OS</p>
        </div>
      </div>
      ${
        mode === "dashboard"
          ? `
            <button class="flex items-center gap-3 px-4 py-3 mb-2 bg-primary text-on-primary font-bold rounded-lg transition-all active:opacity-70" data-action="set-view" data-view="new-project">
              ${icon("add_comment")}
              <span class="text-sm">New Project</span>
            </button>
            <nav class="flex-1 space-y-1 overflow-y-auto custom-scrollbar">
              <button class="w-full flex items-center gap-3 px-4 py-2 bg-white/50 text-[#4F5D3D] font-bold rounded-lg text-sm transition-all" data-action="set-view" data-view="dashboard">
                ${icon("dashboard")}
                <span>Homepage Dashboard</span>
              </button>
              ${sidebarProjectButtons(activePlan?.planId || "")}
              <button class="w-full flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-white/30 rounded-lg text-sm transition-all mt-4" data-action="set-view" data-view="schedule">
                ${icon("calendar_today")}
                <span>Schedule</span>
              </button>
            </nav>
          `
          : `
            <button class="flex items-center gap-3 w-full px-4 py-3 bg-white/70 text-[#4F5D3D] font-bold rounded-xl transition-all hover:bg-white shadow-sm mb-2" data-action="set-view" data-view="dashboard">
              ${icon("home", "text-xl")}
              <span class="text-sm">Homepage Dashboard</span>
            </button>
            <button class="flex items-center gap-3 w-full px-4 py-3 bg-primary text-on-primary font-bold rounded-xl transition-all active:scale-95 shadow-md" data-action="set-view" data-view="new-project">
              ${icon("add_comment", "text-xl")}
              <span class="text-sm">New Project</span>
            </button>
            <nav class="mt-4 flex-grow overflow-y-auto space-y-1 custom-scrollbar">
              ${sidebarProjectButtons(mode === "project" ? activePlan?.planId || "" : "")}
              <button class="w-full flex items-center gap-3 px-4 py-3 text-sm rounded-lg transition-all mt-3 ${
                mode === "schedule" ? "bg-white/50 text-primary font-bold shadow-sm" : "text-on-surface-variant hover:bg-white/30 font-medium"
              }" data-action="set-view" data-view="schedule">
                ${icon("calendar_today", "text-xl")}
                <span>Schedule</span>
              </button>
            </nav>
          `
      }
      <div class="mt-auto pt-4 border-t border-outline-variant/10 space-y-1">
        <button class="w-full flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-white/30 rounded-lg text-sm transition-all">${icon("settings", "text-xl")}<span>Settings</span></button>
        <button class="w-full flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-white/30 rounded-lg text-sm transition-all">${icon("help_outline", "text-xl")}<span>Help</span></button>
      </div>
    </aside>
  `;
}

function focusItems() {
  const plan = getSelectedPlan() || state.snapshot?.plans?.[0] || null;
  const items = [];
  for (const task of plan?.tasks || []) {
    items.push({
      title: task.title,
      subtitle: task.description || `Priority: ${task.priority}`,
      tag: task.dueAt ? formatDateShort(task.dueAt) : task.status,
      tone: task.status === "blocked" ? "bg-tertiary-container text-on-tertiary-container" : "bg-secondary-container text-on-secondary-container",
    });
  }
  if (!items.length && plan) {
    items.push({
      title: `Continue ${plan.title}`,
      subtitle: compactText(plan.summary || "Plan ready for the next study cycle.", 72),
      tag: plan.timebox || "Plan",
      tone: "bg-secondary-container text-on-secondary-container",
    });
  }
  for (const event of (state.snapshot?.learnerEvents || []).slice(0, 2)) {
    items.push({
      title: event.type.replaceAll("_", " "),
      subtitle: compactText(event.impact, 72),
      tag: formatDateShort(event.ts),
      tone: "bg-tertiary-container text-on-tertiary-container",
    });
  }
  if (!items.length) {
    items.push({
      title: "Start your first project",
      subtitle: "Create a runtime-backed plan and let MentorClaw anchor every next step to it.",
      tag: "Ready",
      tone: "bg-secondary-container text-on-secondary-container",
    });
  }
  return items.slice(0, 4);
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

function renderDashboardPage() {
  const plan = getSelectedPlan() || state.snapshot?.plans?.[0] || null;
  const note = mentorNote();
  return `
    <div class="flex min-h-screen overflow-hidden bg-background text-on-background">
      ${renderSidebar("dashboard")}
      <main class="flex-1 flex flex-col h-screen overflow-hidden">
        <header class="flex justify-between items-center px-8 py-4 w-full sticky top-0 z-50 bg-background">
          <nav class="flex gap-8 items-center">
            <button class="font-headline font-medium text-lg tracking-tight text-primary border-b-2 border-primary pb-1" data-action="set-view" data-view="dashboard">Chat</button>
            <button class="font-headline font-medium text-lg tracking-tight text-on-surface-variant hover:text-primary transition-colors" data-action="set-view" data-view="new-project">Plan</button>
            <button class="font-headline font-medium text-lg tracking-tight text-on-surface-variant hover:text-primary transition-colors" data-action="${plan ? "select-plan" : "set-view"}" data-plan-id="${escapeHtml(plan?.planId || "")}" data-view="new-project">Resources</button>
            <button class="font-headline font-medium text-lg tracking-tight text-on-surface-variant hover:text-primary transition-colors" data-action="set-view" data-view="schedule">Calendar</button>
          </nav>
          <div class="flex items-center gap-6">
            <div class="flex gap-4">
              <button class="text-on-surface-variant hover:text-primary transition-colors">${icon("notifications")}</button>
              <button class="text-on-surface-variant hover:text-primary transition-colors" data-action="refresh">${icon("settings")}</button>
            </div>
            <div class="w-10 h-10 rounded-full overflow-hidden bg-surface-container border border-outline-variant/30 flex items-center justify-center text-primary font-bold">${escapeHtml(learnerName().slice(0, 1))}</div>
          </div>
        </header>
        <div class="bg-surface-container-low h-px w-full shrink-0"></div>
        <section class="flex-1 overflow-y-auto p-8 lg:p-12 bg-background flex justify-center custom-scrollbar">
          <div class="max-w-[720px] w-full flex flex-col gap-12">
            <header class="space-y-2">
              <h2 class="font-headline text-5xl font-extrabold tracking-tight">Welcome back, ${escapeHtml(learnerName())}.</h2>
              <p class="font-body text-on-surface-variant text-lg">Your local learning OS is now fully runtime-backed. Plans, sessions, files, and memory are all being read from disk.</p>
            </header>
            <div class="flex flex-col gap-6">
              <div class="flex items-center justify-between border-b border-outline-variant/20 pb-4">
                <h3 class="font-headline text-2xl font-bold">Today's Focus</h3>
                <span class="font-body text-sm text-on-surface-variant italic">${escapeHtml(formatDateShort(new Date().toISOString(), "en-US", { month: "long", day: "numeric", year: "numeric" }))}</span>
              </div>
              <div class="space-y-4">
                ${focusItems().map((item) => `
                  <button class="group w-full flex items-center gap-6 p-4 rounded-lg hover:bg-surface-container-low transition-all text-left" data-action="${note.action}" ${note.action === "select-plan" ? `data-plan-id="${escapeHtml(note.value)}"` : `data-view="${escapeHtml(note.value)}"`}>
                    <div class="w-6 h-6 rounded border-2 border-primary group-hover:bg-primary/10 flex items-center justify-center transition-all">${icon("check", "text-primary text-base opacity-0 group-hover:opacity-40")}</div>
                    <div class="flex-1">
                      <h5 class="font-body font-semibold text-on-background">${escapeHtml(item.title)}</h5>
                      <p class="font-body text-xs text-on-surface-variant mt-0.5">${escapeHtml(item.subtitle)}</p>
                    </div>
                    <span class="font-label text-[10px] uppercase tracking-tighter px-2 py-1 rounded ${item.tone}">${escapeHtml(item.tag)}</span>
                  </button>
                `).join("")}
              </div>
            </div>
            <div class="bg-surface-container-low rounded-xl p-8 border-l-4 border-primary">
              <div class="flex gap-6">
                <div class="shrink-0">${icon("auto_awesome", "text-primary text-3xl")}</div>
                <div class="space-y-3">
                  <h4 class="font-headline text-xl font-bold">Mentor's Note</h4>
                  <p class="font-body text-on-surface-variant leading-relaxed">${escapeHtml(note.body)}</p>
                  <div class="flex gap-4 pt-2">
                    <button class="text-primary font-body font-bold text-sm hover:underline decoration-2 underline-offset-4" data-action="${note.action}" ${note.action === "select-plan" ? `data-plan-id="${escapeHtml(note.value)}"` : `data-view="${escapeHtml(note.value)}"`}>${escapeHtml(note.primary)}</button>
                    <button class="text-on-surface-variant font-body text-sm hover:text-on-background transition-colors" data-action="refresh">Refresh</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-6 shadow-[0_16px_40px_-24px_rgba(49,51,46,0.24)]">
              <div class="flex items-center justify-between mb-5">
                <h3 class="font-headline text-2xl font-bold">Recent Runtime Events</h3>
                <span class="text-xs uppercase tracking-[0.22em] text-on-surface-variant">Live from disk</span>
              </div>
              <div class="space-y-4">
                ${(state.snapshot?.learnerEvents || []).slice(0, 4).map((event) => `
                  <div class="flex items-start justify-between gap-4 border-b border-outline-variant/10 pb-4 last:border-b-0 last:pb-0">
                    <div>
                      <h4 class="font-body font-semibold text-on-background">${escapeHtml(event.type.replaceAll("_", " "))}</h4>
                      <p class="mt-1 text-sm text-on-surface-variant">${escapeHtml(compactText(event.impact, 120))}</p>
                    </div>
                    <span class="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-on-surface-variant/60">${escapeHtml(formatDateShort(event.ts))}</span>
                  </div>
                `).join("")}
              </div>
            </div>
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
      <main class="flex-1 relative flex flex-col overflow-hidden">
        <header class="flex justify-between items-center px-8 py-4 w-full sticky top-0 z-50 bg-background">
          <nav class="hidden md:flex gap-6">
            <button class="font-headline font-medium text-lg tracking-tight text-on-surface-variant hover:text-primary transition-colors" data-action="set-view" data-view="dashboard">Chat</button>
            <button class="font-headline font-medium text-lg tracking-tight text-primary border-b-2 border-primary pb-1" data-action="set-view" data-view="new-project">Plan</button>
            <button class="font-headline font-medium text-lg tracking-tight text-on-surface-variant hover:text-primary transition-colors" data-action="set-view" data-view="schedule">Resources</button>
            <button class="font-headline font-medium text-lg tracking-tight text-on-surface-variant hover:text-primary transition-colors" data-action="set-view" data-view="schedule">Calendar</button>
          </nav>
          <div class="flex items-center gap-4 text-primary">
            <button class="cursor-pointer hover:opacity-70 transition-opacity" data-action="refresh">${icon("notifications")}</button>
            <button class="cursor-pointer hover:opacity-70 transition-opacity" data-action="refresh">${icon("settings")}</button>
            <div class="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-primary font-bold ml-2">${escapeHtml(learnerName().slice(0, 1))}</div>
          </div>
        </header>
        <div class="bg-surface-container-low h-px w-full"></div>
        <div class="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto custom-scrollbar">
          <div class="w-full max-w-[720px]">
            <div class="mb-12 text-center">
              <h2 class="font-headline text-[3.5rem] leading-tight font-light mb-4">New Chapter</h2>
              <p class="text-on-surface-variant text-lg max-w-md mx-auto">The space where intention meets execution. Define your project's soul and let MentorClaw anchor it to the runtime.</p>
            </div>
            <div class="surface-container-lowest glass-panel rounded-xl p-10 relative overflow-hidden bg-surface-container-lowest">
              <div class="absolute -top-24 -right-24 w-64 h-64 bg-primary-container/20 rounded-full blur-3xl"></div>
              <form id="create-plan-form" class="relative z-10 space-y-12">
                <div class="space-y-4">
                  <label class="block font-headline italic text-xl text-on-surface-variant px-1">What are you working on?</label>
                  <div class="paper-input rounded-lg overflow-hidden">
                    <input class="w-full bg-transparent border-0 py-5 px-6 text-xl font-headline focus:ring-0 placeholder:text-outline-variant/40" name="planTitle" placeholder="e.g., The Modern Stoic's Guide" value="${escapeHtml(state.drafts.planTitle)}" />
                  </div>
                </div>
                <div class="space-y-4">
                  <label class="block font-headline italic text-xl text-on-surface-variant px-1">What are you trying to achieve?</label>
                  <div class="paper-input rounded-lg overflow-hidden">
                    <textarea class="w-full bg-transparent border-0 py-5 px-6 text-lg font-body leading-relaxed focus:ring-0 placeholder:text-outline-variant/40 resize-none" name="planOutcome" rows="5" placeholder="Describe the outcome you seek. This becomes the first runtime-backed plan brief.">${escapeHtml(state.drafts.planOutcome)}</textarea>
                  </div>
                </div>
                <div class="flex items-center justify-between pt-4">
                  <button class="text-on-surface hover:text-primary transition-colors font-body text-sm font-medium flex items-center gap-2" type="button" data-action="set-view" data-view="dashboard">${icon("arrow_back", "text-lg")}Go back</button>
                  <button class="bg-gradient-to-r from-primary to-primary-dim text-on-primary px-10 py-4 rounded-md font-body font-bold text-sm shadow-sm hover:shadow-md active:opacity-90 transition-all flex items-center gap-3" type="submit">Initialize Project ${icon("auto_fix_high", "text-lg")}</button>
                </div>
              </form>
            </div>
            <div class="mt-12 flex items-center justify-center gap-8 text-outline-variant">
              <div class="flex items-center gap-2">${icon("verified_user", "text-[16px]")}<span class="text-[10px] uppercase tracking-tighter font-bold">Runtime Bound</span></div>
              <div class="flex items-center gap-2">${icon("folder_managed", "text-[16px]")}<span class="text-[10px] uppercase tracking-tighter font-bold">Local Files</span></div>
              <div class="flex items-center gap-2">${icon("history_edu", "text-[16px]")}<span class="text-[10px] uppercase tracking-tighter font-bold">Memory Synced</span></div>
            </div>
          </div>
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
  return `
    <div class="space-y-0 border-t border-outline-variant/10">
      ${plan.threads
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
      <div class="h-full min-h-[360px] flex items-center justify-center">
        <div class="max-w-md text-center">
          <div class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-container text-primary">${icon("forum", "text-[28px]")}</div>
          <h3 class="font-headline text-3xl font-bold">Start a real conversation</h3>
          <p class="mt-3 text-sm leading-7 text-on-surface-variant">Pick an existing chat or create a new one. Every send will bind to a runtime thread, write memory, and stay discoverable from its local files.</p>
          <button class="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-sm" data-action="new-chat">${icon("add_comment", "text-[18px]")}New Chat</button>
        </div>
      </div>
    `;
  }

  if (!messages.length) {
    return `
      <div class="h-full min-h-[320px] flex items-center justify-center">
        <div class="max-w-md text-center">
          <h3 class="font-headline text-3xl font-bold">This chat is ready</h3>
          <p class="mt-3 text-sm leading-7 text-on-surface-variant">The thread is already bound to the runtime. Send the first message below and the conversation will appear here like a normal browser chat.</p>
        </div>
      </div>
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

function renderProjectConversation(plan, thread, binding, placeholder) {
  return `
    <section class="overflow-hidden rounded-[28px] border border-outline-variant/20 bg-surface-container-lowest shadow-[0_32px_80px_-36px_rgba(49,51,46,0.35)]">
      <div class="border-b border-outline-variant/12 px-6 py-5 md:px-7">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-on-surface-variant/60">Browser Chat</p>
            <h3 class="mt-2 font-headline text-3xl font-bold text-on-background">${escapeHtml(thread?.title || "Conversation")}</h3>
            <p class="mt-2 text-sm leading-7 text-on-surface-variant">${escapeHtml(thread ? `Live in ${plan?.title || "this plan"} and anchored to ${binding?.sessionKey || "an unbound session"}.` : "Create or select a conversation first, then send a message from the composer below.")}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-surface-container px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">${escapeHtml(binding?.sessionKey || "unbound")}</span>
            <span class="rounded-full bg-surface-container px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface-variant">${escapeHtml(workflowLabel(binding?.lastWorkflow || thread?.status || "idle"))}</span>
            <button class="inline-flex items-center gap-2 rounded-full border border-outline-variant/20 bg-white px-4 py-2 text-sm font-semibold text-on-background hover:bg-surface-container-low" data-action="new-chat">${icon("add_comment", "text-[18px]")}New Chat</button>
          </div>
        </div>

        <div class="mt-6">
          <div class="mb-3 flex items-center justify-between gap-3">
            <h4 class="font-headline text-lg font-semibold text-on-surface/75">Recent History</h4>
            <span class="rounded-full bg-surface-container px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">${plan?.threads?.length || 0} sessions</span>
          </div>
          ${plan ? `<div class="max-h-[180px] overflow-y-auto custom-scrollbar pr-1">${renderProjectHistory(plan)}</div>` : '<div class="text-sm text-on-surface-variant">Select or create a project first.</div>'}
        </div>
      </div>

      <div id="chat-feed" class="chat-feed custom-scrollbar border-b border-outline-variant/10 bg-[linear-gradient(180deg,rgba(251,249,245,1)_0%,rgba(245,244,238,0.72)_100%)] px-6 py-6 md:px-7 md:py-7">
        ${renderTranscript(thread, binding)}
      </div>

      <div class="bg-white/90 px-6 py-5 backdrop-blur-sm md:px-7">
        <form id="user-turn-form" class="rounded-[24px] border border-outline-variant/20 bg-surface-container-low shadow-[0_16px_40px_-28px_rgba(49,51,46,0.35)] transition-all focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
          <div class="flex items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">${icon("link", "text-[14px]")}Runtime Bound</span>
              <span class="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">${icon("memory", "text-[14px]")}Memory Aware</span>
            </div>
            <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Enter to send · Shift+Enter for newline</span>
          </div>
          <div class="flex items-end gap-3 p-4">
            <textarea class="flex-1 bg-transparent border-none focus:ring-0 text-on-surface text-base resize-none py-1 placeholder:text-on-surface-variant/40 custom-scrollbar max-h-48" name="userMessage" rows="3" placeholder="${escapeHtml(placeholder)}" ${state.submittingTurn ? "disabled" : ""}>${escapeHtml(state.drafts.userMessage)}</textarea>
            <button class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary shadow-md transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50" type="submit" ${state.submittingTurn ? "disabled" : ""}>
              ${state.submittingTurn ? icon("progress_activity") : icon("arrow_upward")}
            </button>
          </div>
        </form>
        <p class="mt-3 text-[10px] font-medium uppercase tracking-[0.22em] text-on-surface-variant/45">This conversation is rendered from real runtime turns, session bindings, and recorded assistant replies.</p>
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
        <header class="flex justify-between items-center px-8 py-4 w-full bg-background border-b border-surface-container-low">
          <div class="flex flex-col">
            <h2 class="font-headline font-bold text-2xl text-primary leading-tight">${escapeHtml(plan?.title || "Project")}</h2>
            <p class="font-body text-[10px] text-on-surface-variant/70 tracking-wide uppercase">${escapeHtml(plan ? `Plan ${plan.planId}` : "Select a project")}</p>
          </div>
          <div class="flex items-center gap-6">
            <div class="flex items-center gap-4 border-l border-outline-variant/30 pl-6">
              <button class="rounded-full bg-surface-container p-2 text-on-surface-variant hover:text-primary transition-colors" data-action="refresh">${icon("refresh")}</button>
              <div class="w-8 h-8 rounded-full bg-primary-container overflow-hidden ring-2 ring-surface-container flex items-center justify-center text-primary font-bold">${escapeHtml(learnerName().slice(0, 1))}</div>
            </div>
          </div>
        </header>
        <div class="flex-1 overflow-y-auto custom-scrollbar">
          <div class="mx-auto max-w-[1380px] py-8 px-8">
            <div class="project-workspace-grid">
              <div class="min-w-0">
                ${renderProjectConversation(plan, thread, binding, placeholder)}
              </div>

              <aside class="project-right-rail custom-scrollbar">
                <div class="space-y-4">
                  ${
                    state.showCreateThread
                      ? renderCollapsiblePanel("new-chat", "New Chat", "Create a new runtime thread under this project.", renderThreadForm())
                      : ""
                  }
                  ${renderCollapsiblePanel("thread-summary", "Selected Chat", "Current question, status, and latest runtime context.", renderThreadSummaryPanel(thread), {
                    count: thread ? `${thread.boundSessions.length} sessions` : "",
                  })}
                  ${renderCollapsiblePanel("session-binding", "Session Binding", "External sessions and runtime thread mapping.", renderBindingPanel(plan, thread, binding), {
                    count: binding ? "bound" : "unbound",
                  })}
                  ${renderCollapsiblePanel("memory", "Working Memory", "Persisted memory lines and assistant reply writeback.", renderMemoryPanel(thread), {
                    count: thread ? `${thread.workingMemory.length} lines` : "",
                  })}
                  ${renderCollapsiblePanel("files", "Sources & Local Files", "The actual local correspondence for the selected plan and conversation.", renderFilesPanel(plan, thread), {
                    count: currentFileSections(plan, thread).reduce((sum, section) => sum + section.items.length, 0),
                    id: "sources-panel",
                  })}
                </div>
              </aside>
            </div>
          </div>
        </div>
      </main>
      ${renderFlash()}
    </div>
  `;
}

function startOfWeek(referenceDate) {
  const start = new Date(referenceDate);
  const day = start.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + delta + state.scheduleOffsetWeeks * 7);
  start.setHours(0, 0, 0, 0);
  return start;
}

function shiftDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function collectScheduleEntries() {
  const start = startOfWeek(new Date());
  const end = shiftDays(start, 6);
  end.setHours(23, 59, 59, 999);
  const entries = [];
  const pushEntry = (title, detail, when, tone = "primary") => {
    if (!when) return;
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || date < start || date > end) return;
    entries.push({ title, detail, when: date, dayIndex: Math.max(0, Math.min(6, (date.getDay() + 6) % 7)), tone });
  };
  for (const plan of state.snapshot?.plans || []) {
    for (const task of plan.tasks || []) pushEntry(task.title, `${plan.title} · ${task.status}`, task.dueAt, task.status === "blocked" ? "tertiary" : "primary");
    for (const milestone of plan.milestones || []) pushEntry(milestone.title, `${plan.title} milestone`, milestone.dueAt, "secondary");
    for (const event of plan.events || []) pushEntry(event.type.replaceAll("_", " "), `${plan.title} · ${event.impact}`, event.ts, "secondary");
    for (const thread of plan.threads || []) for (const event of thread.events || []) pushEntry(event.type.replaceAll("_", " "), `${thread.title} · ${event.impact}`, event.ts, "primary");
  }
  for (const event of state.snapshot?.learnerEvents || []) pushEntry(event.type.replaceAll("_", " "), event.impact, event.ts, "tertiary");
  return { entries: entries.sort((left, right) => left.when - right.when).slice(0, 18), start, end };
}

function renderSchedulePage() {
  const { entries, start, end } = collectScheduleEntries();
  const days = Array.from({ length: 7 }, (_, index) => shiftDays(start, index));
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
                      <div class="p-4 text-center border-l border-outline-variant/10 ${index === 2 ? "bg-white/40" : ""}">
                        <p class="text-[10px] font-bold uppercase tracking-widest ${index === 2 ? "text-primary" : "text-on-surface-variant/60"}">${escapeHtml(day.toLocaleDateString("en-US", { weekday: "short" }))}</p>
                        <p class="text-xl font-headline font-bold mt-1 ${index === 2 ? "text-primary" : ""}">${day.getDate()}</p>
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
                <h3 class="font-headline text-2xl font-bold">Current Focus</h3>
                <p class="mt-4 text-sm leading-7 text-on-surface-variant">${escapeHtml(getSelectedPlan()?.summary || state.snapshot?.learner?.state?.current_focus || "No current focus set yet.")}</p>
              </section>
            </div>
          </div>
        </div>
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
        <p class="mt-3 text-sm tracking-[0.24em] uppercase text-on-surface-variant">${state.loading ? "Connecting runtime" : "Preparing atelier"}</p>
      </div>
    </div>
  `;
}

function renderApp() {
  if (!state.snapshot) return renderLoading();
  if (state.activeView === "new-project") return renderNewProjectPage();
  if (state.activeView === "schedule") return renderSchedulePage();
  if (state.activeView === "project") return renderProjectPage();
  return renderDashboardPage();
}

function render() {
  app.innerHTML = renderApp();
  if (state.activeView === "project" && state.activeFilePath) ensureFileLoaded(state.activeFilePath);
  if (state.activeView === "project") {
    window.requestAnimationFrame(() => {
      const feed = document.getElementById("chat-feed");
      if (feed) feed.scrollTop = feed.scrollHeight;
    });
  }
}

function scrollToId(id) {
  const element = document.getElementById(id);
  if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
}

function randomThreadTitle() {
  return `Conversation ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  if (target.name === "sessionKey") {
    state.sessionKey = target.value;
    writeStored("sessionKey", state.sessionKey);
    return;
  }
  if (target.name in state.drafts) state.drafts[target.name] = target.value;
}

function handleKeyDown(event) {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  if (target.name !== "userMessage") return;
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  target.form?.requestSubmit();
}

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "set-view") {
    state.activeView = button.dataset.view || "dashboard";
    syncSelection();
    render();
    return;
  }
  if (action === "refresh") return refresh();
  if (action === "select-plan") {
    const planId = button.dataset.planId || state.snapshot?.activePlanId || state.snapshot?.plans?.[0]?.planId || "";
    if (!planId) return;
    state.selectedPlanId = planId;
    state.selectedThreadId = state.snapshot?.plans.find((plan) => plan.planId === planId)?.threads?.[0]?.threadId || "";
    state.activeView = "project";
    syncSelection();
    render();
    return;
  }
  if (action === "select-thread") {
    state.selectedPlanId = button.dataset.planId || state.selectedPlanId;
    state.selectedThreadId = button.dataset.threadId || "";
    state.activeView = "project";
    syncSelection();
    render();
    return;
  }
  if (action === "new-chat") {
    const planId = state.selectedPlanId || state.snapshot?.activePlanId || state.snapshot?.plans?.[0]?.planId || "";
    if (!planId) {
      state.activeView = "new-project";
      render();
      return;
    }
    state.selectedPlanId = planId;
    state.activeView = "project";
    state.showCreateThread = true;
    state.collapsedPanels["new-chat"] = false;
    writeCollapsedPanels();
    if (!state.drafts.threadTitle) state.drafts.threadTitle = randomThreadTitle();
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
  if (action === "schedule-prev") {
    state.scheduleOffsetWeeks -= 1;
    syncSelection();
    render();
    return;
  }
  if (action === "schedule-next") {
    state.scheduleOffsetWeeks += 1;
    syncSelection();
    render();
    return;
  }
  if (action === "schedule-today") {
    state.scheduleOffsetWeeks = 0;
    syncSelection();
    render();
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.id === "create-plan-form") {
    await submitJson("/api/plans", {
      title: state.drafts.planTitle,
      targetOutcome: state.drafts.planOutcome.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      goals: [],
      timebox: "7天",
    }, async (snapshot) => {
      state.snapshot = snapshot;
      state.selectedPlanId = snapshot.activePlanId || snapshot.plans[0]?.planId || "";
      state.selectedThreadId = snapshot.plans.find((plan) => plan.planId === state.selectedPlanId)?.threads?.[0]?.threadId || "";
      state.activeView = "project";
      state.drafts.planTitle = "";
      state.drafts.planOutcome = "";
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
      title: state.drafts.threadTitle.trim() || randomThreadTitle(),
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
      setFlash("info", "New chat created.");
    });
    return;
  }

  if (form.id === "user-turn-form") {
    const message = state.drafts.userMessage.trim();
    if (!message) return setFlash("error", "Type a message first.");
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
  }
}

app.addEventListener("click", handleClick);
app.addEventListener("input", handleInput);
app.addEventListener("keydown", handleKeyDown);
app.addEventListener("submit", handleSubmit);

refresh();
