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
  scheduleOffsetMonths: Number(readStored("scheduleOffsetMonths") || "0") || 0,
  forceWorkflow: readStored("forceWorkflow") || "auto",
  flash: null,
  fileCache: {},
  showCreateThread: false,
  showDebugRail: readStored("showDebugRail") !== "0",
  collapsedPanels: readCollapsedPanels(),
  submittingTurn: false,
  pendingTurnMessage: "",
  pendingTurnStartedAt: 0,
  pendingTurnElapsedMs: 0,
  pendingTurnTicker: 0,
  lastAssistantReplySource: "",
  lastTurnTiming: null,
  drafts: {
    planTitle: "",
    planOutcome: "",
    threadTitle: "",
    threadQuestion: "",
    userMessage: "",
    assistantMessage: "",
  },
};

let lastRenderedView = state.activeView;

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

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function normalizeMarkdown(markdown) {
  return String(markdown ?? "").replace(/\r\n?/g, "\n");
}

function isBlankMarkdownLine(line) {
  return !line.trim();
}

function isFenceStart(line) {
  return /^```/.test(line.trim());
}

function isHeadingLine(line) {
  return /^#{1,6}\s+/.test(line.trim());
}

function isHorizontalRule(line) {
  return /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function isListItem(line) {
  return /^ {0,3}(?:[-+*]|\d+\.)\s+/.test(line);
}

function isBlockquote(line) {
  return /^>\s?/.test(line.trim());
}

function safeHref(rawHref) {
  const href = String(rawHref ?? "").trim();
  if (!href) return null;
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  if (/^(#|\/|\.\/|\.\.\/)/.test(href)) return href;
  if (/^[^:\s?#/]+(?:\/[^?#\s]*)?(?:\?[^#\s]*)?(?:#\S*)?$/.test(href)) return href;
  return null;
}

function splitTableRow(line) {
  const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return normalized.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableStart(lines, index) {
  if (index + 1 >= lines.length) return false;
  if (!lines[index].includes("|")) return false;
  return isTableSeparator(lines[index + 1]);
}

function stashInline(html, stashed) {
  const token = `\u0000${stashed.length}\u0000`;
  stashed.push(html);
  return token;
}

function unstashInline(text, stashed) {
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => stashed[Number(index)] ?? "");
}

function replaceInlinePattern(text, pattern, replacer) {
  let current = text;
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current.replace(pattern, replacer);
  }
  return current;
}

function renderMarkdownInline(value) {
  const stashed = [];
  let html = String(value ?? "");

  html = html.replace(/`([^`\n]+)`/g, (_, code) => stashInline(`<code>${escapeHtml(code)}</code>`, stashed));

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+(?:\?[^)\s]*)?(?:#[^)\s]*)?)\)/g, (_, label, href) => {
    const safe = safeHref(href);
    if (!safe) return escapeHtml(`[${label}](${href})`);
    return stashInline(`<a href="${escapeAttribute(safe)}" target="_blank" rel="noreferrer">${renderMarkdownInline(label)}</a>`, stashed);
  });

  html = escapeHtml(html);
  html = replaceInlinePattern(html, /\*\*([^*][\s\S]*?)\*\*/g, (_, inner) => `<strong>${inner}</strong>`);
  html = replaceInlinePattern(html, /__([^_][\s\S]*?)__/g, (_, inner) => `<strong>${inner}</strong>`);
  html = replaceInlinePattern(html, /~~([^~][\s\S]*?)~~/g, (_, inner) => `<del>${inner}</del>`);
  html = replaceInlinePattern(html, /(^|[^\w])\*([^*\n]+)\*(?!\*)/g, (_, prefix, inner) => `${prefix}<em>${inner}</em>`);
  html = replaceInlinePattern(html, /(^|[^\w])_([^_\n]+)_(?!_)/g, (_, prefix, inner) => `${prefix}<em>${inner}</em>`);

  html = html.replace(/\n/g, "<br />");
  return unstashInline(html, stashed);
}

function parseMarkdownFence(lines, startIndex) {
  const opener = lines[startIndex].trim();
  const language = opener.slice(3).trim();
  const body = [];
  let index = startIndex + 1;

  while (index < lines.length && !/^```/.test(lines[index].trim())) {
    body.push(lines[index]);
    index += 1;
  }

  if (index < lines.length) index += 1;

  const languageAttr = language ? ` data-language="${escapeAttribute(language)}"` : "";
  const languageLabel = language ? `<div class="markdown-code-label">${escapeHtml(language)}</div>` : "";

  return {
    html: `<pre${languageAttr}>${languageLabel}<code>${escapeHtml(body.join("\n"))}</code></pre>`,
    nextIndex: index,
  };
}

function parseMarkdownList(lines, startIndex) {
  const ordered = /^\s*\d+\.\s+/.test(lines[startIndex]);
  const tag = ordered ? "ol" : "ul";
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const match = lines[index].match(/^ {0,3}(?:[-+*]|\d+\.)\s+(.*)$/);
    if (!match) break;
    items.push(`<li>${renderMarkdownInline(match[1])}</li>`);
    index += 1;
  }

  return {
    html: `<${tag}>${items.join("")}</${tag}>`,
    nextIndex: index,
  };
}

function parseMarkdownTable(lines, startIndex) {
  const headerCells = splitTableRow(lines[startIndex]);
  const separatorCells = splitTableRow(lines[startIndex + 1]);
  const alignments = separatorCells.map((cell) => {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(":");
    const right = trimmed.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });

  const rows = [];
  let index = startIndex + 2;
  while (index < lines.length) {
    const current = lines[index];
    if (isBlankMarkdownLine(current) || !current.includes("|")) break;
    rows.push(splitTableRow(current));
    index += 1;
  }

  const headerHtml = headerCells
    .map((cell, cellIndex) => {
      const align = alignments[cellIndex] ? ` style="text-align:${alignments[cellIndex]};"` : "";
      return `<th${align}>${renderMarkdownInline(cell)}</th>`;
    })
    .join("");

  const bodyHtml = rows
    .map((row) => {
      const cells = headerCells
        .map((_, cellIndex) => {
          const align = alignments[cellIndex] ? ` style="text-align:${alignments[cellIndex]};"` : "";
          return `<td${align}>${renderMarkdownInline(row[cellIndex] ?? "")}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return {
    html: `<table><thead><tr>${headerHtml}</tr></thead>${bodyHtml ? `<tbody>${bodyHtml}</tbody>` : ""}</table>`,
    nextIndex: index,
  };
}

function parseMarkdownParagraph(lines, startIndex) {
  const body = [];
  let index = startIndex;

  while (index < lines.length) {
    const current = lines[index];
    if (isBlankMarkdownLine(current)) break;
    if (isFenceStart(current) || isHeadingLine(current) || isHorizontalRule(current) || isListItem(current) || isBlockquote(current) || isTableStart(lines, index)) break;
    body.push(current.trimEnd());
    index += 1;
  }

  return {
    html: `<p>${renderMarkdownInline(body.join("\n"))}</p>`,
    nextIndex: index,
  };
}

function renderMarkdown(markdown) {
  const normalized = normalizeMarkdown(markdown).trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const blocks = [];

  for (let index = 0; index < lines.length;) {
    const current = lines[index];

    if (isBlankMarkdownLine(current)) {
      index += 1;
      continue;
    }

    if (isFenceStart(current)) {
      const parsed = parseMarkdownFence(lines, index);
      blocks.push(parsed.html);
      index = parsed.nextIndex;
      continue;
    }

    if (isHeadingLine(current)) {
      const match = current.trim().match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        blocks.push(`<h${level}>${renderMarkdownInline(match[2])}</h${level}>`);
        index += 1;
        continue;
      }
    }

    if (isHorizontalRule(current)) {
      blocks.push("<hr />");
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const parsed = parseMarkdownTable(lines, index);
      blocks.push(parsed.html);
      index = parsed.nextIndex;
      continue;
    }

    if (isBlockquote(current)) {
      const quoted = [];
      while (index < lines.length && isBlockquote(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderMarkdown(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    if (isListItem(current)) {
      const parsed = parseMarkdownList(lines, index);
      blocks.push(parsed.html);
      index = parsed.nextIndex;
      continue;
    }

    const parsed = parseMarkdownParagraph(lines, index);
    blocks.push(parsed.html);
    index = parsed.nextIndex;
  }

  return blocks.join("");
}

function compactText(value, max = 96) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
}

function renderMessageBody(text) {
  const rendered = renderMarkdown(text);
  return rendered || `<p>${escapeHtml(String(text ?? ""))}</p>`;
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

function formatElapsed(value) {
  const totalSeconds = Math.max(1, Math.floor((value || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function stopPendingTurnTicker() {
  if (state.pendingTurnTicker) window.clearInterval(state.pendingTurnTicker);
  state.pendingTurnTicker = 0;
  state.pendingTurnStartedAt = 0;
  state.pendingTurnElapsedMs = 0;
}

function startPendingTurnTicker() {
  stopPendingTurnTicker();
  state.pendingTurnStartedAt = Date.now();
  state.pendingTurnElapsedMs = 0;
  state.pendingTurnTicker = window.setInterval(() => {
    if (!state.submittingTurn) {
      stopPendingTurnTicker();
      return;
    }
    state.pendingTurnElapsedMs = Date.now() - state.pendingTurnStartedAt;
    render();
  }, 1000);
}

function turnTimingSummary(timing) {
  if (!timing) return "";
  const parts = [];
  if (typeof timing.openclawMs === "number") parts.push(`model ${formatElapsed(timing.openclawMs)}`);
  if (typeof timing.snapshotMs === "number") parts.push(`sync ${formatElapsed(timing.snapshotMs)}`);
  if (typeof timing.totalMs === "number") parts.push(`total ${formatElapsed(timing.totalMs)}`);
  return parts.join(" · ");
}

function getSelectedPlan() {
  return state.snapshot?.plans.find((plan) => plan.planId === state.selectedPlanId) || null;
}

function getSelectedThread() {
  const plan = getSelectedPlan();
  return plan?.threads.find((thread) => thread.threadId === state.selectedThreadId) || null;
}

function bindingMatchesSelection(binding, planId = state.selectedPlanId, threadId = state.selectedThreadId) {
  if (!binding || !planId) return false;
  return binding.planId === planId && (!threadId || binding.threadId === threadId);
}

function preferredSessionKeyForThread(thread) {
  return thread?.boundSessions?.[0]?.sessionKey || "";
}

function getSelectedBinding() {
  const thread = getSelectedThread();
  const current = state.snapshot?.sessionBindings.find((binding) => binding.sessionKey === state.sessionKey) || null;
  if (bindingMatchesSelection(current)) return current;
  if (thread?.boundSessions?.length) return thread.boundSessions[0];
  return null;
}

function applyProjectSelection(planId, threadId = "") {
  const plan = state.snapshot?.plans.find((item) => item.planId === planId) || null;
  if (!plan) return;
  state.selectedPlanId = plan.planId;
  state.selectedThreadId = threadId && plan.threads.some((item) => item.threadId === threadId) ? threadId : plan.threads[0]?.threadId || "";
  const selectedThread = plan.threads.find((item) => item.threadId === state.selectedThreadId) || null;
  const current = state.snapshot?.sessionBindings.find((binding) => binding.sessionKey === state.sessionKey) || null;
  if (!bindingMatchesSelection(current, state.selectedPlanId, state.selectedThreadId)) {
    state.sessionKey = preferredSessionKeyForThread(selectedThread);
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
    if (plan && !plan.threads.some((thread) => thread.threadId === state.selectedThreadId)) {
      state.selectedThreadId = plan.threads[0]?.threadId || "";
    }
    const thread = getSelectedThread();
    if (thread?.boundSessions?.length) {
      const hasCurrent = thread.boundSessions.some((binding) => binding.sessionKey === state.sessionKey);
      if (!hasCurrent) state.sessionKey = thread.boundSessions[0].sessionKey;
    } else if (!bindingMatchesSelection(state.snapshot?.sessionBindings.find((binding) => binding.sessionKey === state.sessionKey) || null)) {
      state.sessionKey = "";
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
  writeStored("scheduleOffsetMonths", state.scheduleOffsetMonths);
  writeStored("forceWorkflow", state.forceWorkflow);
  writeStored("showDebugRail", state.showDebugRail ? "1" : "0");
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
    return { ok: true, result };
  } catch (error) {
    setFlash("error", error.message);
    return { ok: false, error };
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
  const planCount = state.snapshot?.plans?.length || 0;
  return `
    <div class="flex h-screen overflow-hidden bg-background text-on-background">
      ${renderSidebar("new-project")}
      <main class="flex-1 relative flex min-w-0 flex-col overflow-hidden">
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
        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 py-6 md:px-8 md:py-8">
          <div class="mx-auto grid max-w-[1160px] gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
            <section class="relative overflow-hidden rounded-[32px] border border-outline-variant/15 bg-[radial-gradient(circle_at_top_left,rgba(165,184,137,0.22),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(247,245,239,0.94)_100%)] p-8 shadow-[0_28px_70px_-44px_rgba(49,51,46,0.45)] md:p-10">
              <div class="absolute -right-16 top-[-38px] h-48 w-48 rounded-full bg-primary-container/35 blur-3xl"></div>
              <div class="relative max-w-[640px] space-y-6">
                <div class="inline-flex items-center gap-2 rounded-full bg-white/75 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.24em] text-primary shadow-sm">
                  ${icon("auto_awesome", "text-[16px]")}
                  Runtime-backed setup
                </div>
                <div class="space-y-3">
                  <h2 class="font-headline text-4xl font-bold tracking-tight md:text-5xl">Start a project without leaving the fold.</h2>
                  <p class="max-w-[560px] text-base leading-8 text-on-surface-variant md:text-lg">We only need the target and the intended outcome. MentorClaw will create the plan shell, bind the runtime, and keep later turns attached to the same memory and thread system.</p>
                </div>
                <div class="grid gap-3 sm:grid-cols-3">
                  <div class="rounded-2xl bg-white/80 p-4 shadow-sm">
                    <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">Step 1</p>
                    <p class="mt-2 text-sm font-semibold">Create the plan brief</p>
                  </div>
                  <div class="rounded-2xl bg-white/80 p-4 shadow-sm">
                    <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">Step 2</p>
                    <p class="mt-2 text-sm font-semibold">Open the first chat</p>
                  </div>
                  <div class="rounded-2xl bg-white/80 p-4 shadow-sm">
                    <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">Step 3</p>
                    <p class="mt-2 text-sm font-semibold">Persist memory and files</p>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-3 text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface-variant">
                  <span class="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 shadow-sm">${icon("verified_user", "text-[16px]")}Runtime Bound</span>
                  <span class="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 shadow-sm">${icon("folder_managed", "text-[16px]")}Local Files</span>
                  <span class="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 shadow-sm">${icon("history_edu", "text-[16px]")}Memory Synced</span>
                </div>
                <div class="rounded-2xl border border-outline-variant/10 bg-white/70 p-5 shadow-sm">
                  <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant">Current workspace</p>
                  <p class="mt-3 text-sm leading-7 text-on-surface-variant">${escapeHtml(planCount ? `You already have ${planCount} project${planCount === 1 ? "" : "s"} in this runtime. Creating a new one will immediately place it into the project view.` : "No project exists yet. The first one will become the active runtime plan.")}</p>
                </div>
              </div>
            </section>
            <section class="surface-container-lowest glass-panel rounded-[32px] border border-outline-variant/15 bg-surface-container-lowest p-8 shadow-[0_28px_70px_-44px_rgba(49,51,46,0.45)] md:p-9">
              <form id="create-plan-form" class="space-y-8">
                <div class="space-y-2">
                  <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant">Project brief</p>
                  <h3 class="font-headline text-3xl font-bold">Initialize Project</h3>
                  <p class="text-sm leading-7 text-on-surface-variant">Keep it short. We can refine the plan after the runtime is created.</p>
                </div>
                <div class="space-y-3">
                  <label class="block font-headline italic text-lg text-on-surface-variant px-1">What are you working on?</label>
                  <div class="paper-input rounded-2xl overflow-hidden">
                    <input class="w-full bg-transparent border-0 py-4 px-5 text-lg font-headline focus:ring-0 placeholder:text-outline-variant/40" name="planTitle" placeholder="e.g., The Modern Stoic's Guide" value="${escapeHtml(state.drafts.planTitle)}" />
                  </div>
                </div>
                <div class="space-y-3">
                  <label class="block font-headline italic text-lg text-on-surface-variant px-1">What are you trying to achieve?</label>
                  <div class="paper-input rounded-2xl overflow-hidden">
                    <textarea class="w-full bg-transparent border-0 px-5 py-4 text-base font-body leading-relaxed focus:ring-0 placeholder:text-outline-variant/40 resize-none" name="planOutcome" rows="5" placeholder="Describe the outcome you seek. This becomes the first runtime-backed plan brief.">${escapeHtml(state.drafts.planOutcome)}</textarea>
                  </div>
                </div>
                <div class="flex items-center justify-between gap-4 pt-2">
                  <button class="text-on-surface hover:text-primary transition-colors font-body text-sm font-medium flex items-center gap-2" type="button" data-action="set-view" data-view="dashboard">${icon("arrow_back", "text-lg")}Go back</button>
                  <button class="bg-gradient-to-r from-primary to-primary-dim text-on-primary px-8 py-4 rounded-2xl font-body font-bold text-sm shadow-sm hover:shadow-md active:opacity-90 transition-all flex items-center gap-3" type="submit">Initialize Project ${icon("auto_fix_high", "text-lg")}</button>
                </div>
              </form>
            </section>
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

function renderProjectThreadSwitcher(plan, thread) {
  if (!plan) {
    return `
      <section class="mb-5 rounded-[28px] border border-outline-variant/20 bg-surface-container-lowest px-6 py-5 shadow-[0_24px_60px_-40px_rgba(49,51,46,0.35)]">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="font-headline text-2xl font-bold">Conversations</h3>
            <p class="mt-1 text-sm text-on-surface-variant">Select a project first to see its own chat history.</p>
          </div>
          <button class="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm" data-action="set-view" data-view="new-project">${icon("add_comment", "text-[18px]")}New Chat</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="mb-5 rounded-[28px] border border-outline-variant/20 bg-surface-container-lowest px-6 py-5 shadow-[0_24px_60px_-40px_rgba(49,51,46,0.35)]">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 class="font-headline text-2xl font-bold">Conversations</h3>
          <p class="mt-1 text-sm text-on-surface-variant">${escapeHtml(`${plan.title} 共有 ${plan.threads.length} 个会话。当前只显示这个项目自己的历史。`)}</p>
        </div>
        <button class="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm" data-action="new-chat">${icon("add_comment", "text-[18px]")}New Chat</button>
      </div>
      <div class="mt-4 grid gap-3">
        ${
          plan.threads.length
            ? plan.threads
                .map(
                  (item) => `
                    <button class="w-full rounded-2xl border px-4 py-4 text-left transition-all ${
                      item.threadId === thread?.threadId
                        ? "border-primary/30 bg-primary/8 shadow-sm"
                        : "border-outline-variant/15 bg-surface-container-low hover:bg-surface-container"
                    }" data-action="select-thread" data-plan-id="${escapeHtml(plan.planId)}" data-thread-id="${escapeHtml(item.threadId)}">
                      <div class="flex items-start justify-between gap-4">
                        <div class="min-w-0">
                          <h4 class="truncate font-headline text-lg font-semibold">${escapeHtml(item.title)}</h4>
                          <p class="mt-1 text-sm text-on-surface-variant">${escapeHtml(compactText(item.currentQuestion || item.summary || "No summary yet.", 120))}</p>
                        </div>
                        <div class="shrink-0 text-right">
                          <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface-variant/55">${escapeHtml(formatDateShort(item.updatedAt))}</p>
                          <p class="mt-2 text-[11px] text-on-surface-variant">${escapeHtml(`${item.boundSessions.length} session${item.boundSessions.length === 1 ? "" : "s"}`)}</p>
                        </div>
                      </div>
                    </button>
                  `,
                )
                .join("")
            : '<div class="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">这个项目还没有会话。点击右上角的 New Chat 创建第一条。</div>'
        }
      </div>
      ${state.showCreateThread ? `<div class="mt-5 rounded-2xl border border-outline-variant/15 bg-surface-container-low px-5 py-5">${renderThreadForm()}</div>` : ""}
    </section>
  `;
}

function renderProjectMetaPanel(plan, thread, binding) {
  const replyModeHint =
    state.lastAssistantReplySource === "openclaw"
      ? "This chat is running through live OpenClaw turns."
      : "This chat is rendered from runtime state and recorded replies.";
  return `
    <section class="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-[0_16px_40px_-24px_rgba(49,51,46,0.24)]">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-on-surface-variant/60">Chat Context</p>
          <h3 class="mt-2 font-headline text-2xl font-bold">${escapeHtml(thread?.title || "Conversation")}</h3>
          <p class="mt-2 text-sm leading-7 text-on-surface-variant">${escapeHtml(thread ? `Inside ${plan?.title || "this plan"} and bound to ${binding?.sessionKey || "an unbound session"}.` : "Create or select a conversation first.")}</p>
        </div>
        <button class="inline-flex items-center gap-2 rounded-full border border-outline-variant/20 bg-white px-4 py-2 text-sm font-semibold text-on-background hover:bg-surface-container-low" data-action="new-chat">${icon("add_comment", "text-[18px]")}New Chat</button>
      </div>
      <div class="mt-5 grid gap-3 sm:grid-cols-2">
        <div class="rounded-xl bg-surface-container-low p-4">
          <p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-2">Session</p>
          <p class="text-sm font-semibold break-all">${escapeHtml(binding?.sessionKey || "unbound")}</p>
        </div>
        <div class="rounded-xl bg-surface-container-low p-4">
          <p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-2">Workflow</p>
          <p class="text-sm font-semibold">${escapeHtml(workflowLabel(binding?.lastWorkflow || thread?.status || "idle"))}</p>
        </div>
      </div>
      <div class="mt-4 rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">${escapeHtml(replyModeHint)}</div>
      <div class="mt-6">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h4 class="font-headline text-lg font-semibold text-on-surface/75">Recent History</h4>
          <span class="rounded-full bg-surface-container px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">${plan?.threads?.length || 0} sessions</span>
        </div>
        ${plan ? `<div class="max-h-[180px] overflow-y-auto custom-scrollbar pr-1">${renderProjectHistory(plan)}</div>` : '<div class="text-sm text-on-surface-variant">Select or create a project first.</div>'}
      </div>
    </section>
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
      text: "",
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
          <p class="mt-3 text-sm leading-7 text-on-surface-variant">The thread is already bound to the runtime. Send the first message below and OpenClaw will continue inside this plan context.</p>
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
                  <div class="chat-bubble chat-bubble-user rounded-[28px] rounded-br-lg bg-primary px-5 py-4 text-sm leading-7 text-on-primary shadow-[0_16px_32px_-20px_rgba(85,99,67,0.65)] ${message.pending ? "opacity-70" : ""}"><div class="markdown-body">${renderMessageBody(message.text)}</div></div>
                </div>
              </div>
            `;
          }

          const tone =
            message.tone === "error"
              ? "bg-error-container text-on-error-container"
              : "bg-surface-container-low text-on-surface";
          const title = message.role === "system" ? "Runtime" : "MentorClaw";
          if (message.role === "assistant" && message.pending) {
            return `
              <div class="flex justify-start">
                <div class="flex max-w-[88%] gap-3">
                  <div class="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-container text-primary">
                    ${icon("school", "text-[20px]")}
                  </div>
                  <div class="min-w-0">
                    <div class="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">
                      <span>${title}</span>
                      <span>${escapeHtml(formatDateTime(message.ts))}</span>
                      ${binding?.lastWorkflow ? `<span class="rounded-full bg-white px-2 py-1 text-primary">${escapeHtml(workflowLabel(binding.lastWorkflow))}</span>` : ""}
                      <span class="rounded-full bg-white px-2 py-1 text-on-surface-variant">${escapeHtml(formatElapsed(state.pendingTurnElapsedMs || 1000))}</span>
                    </div>
                    <div class="chat-bubble chat-bubble-pending rounded-[28px] rounded-bl-lg px-5 py-4 shadow-[0_16px_32px_-24px_rgba(49,51,46,0.35)]">
                      <div class="pending-dots" aria-label="Assistant is thinking">
                        <span class="pending-dot"></span>
                        <span class="pending-dot"></span>
                        <span class="pending-dot"></span>
                      </div>
                      <div class="pending-lines">
                        <span class="pending-line pending-line-wide"></span>
                        <span class="pending-line pending-line-mid"></span>
                        <span class="pending-line pending-line-short"></span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            `;
          }
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
                    ${message.role === "assistant" && state.lastAssistantReplySource === "openclaw" ? '<span class="rounded-full bg-white px-2 py-1 text-on-surface-variant">Live OpenClaw</span>' : ""}
                    ${message.pending ? '<span class="rounded-full bg-white px-2 py-1 text-primary">Thinking</span>' : ""}
                  </div>
                  <div class="chat-bubble ${message.role === "system" ? "chat-bubble-system" : "chat-bubble-assistant"} rounded-[28px] rounded-bl-lg px-5 py-4 text-sm leading-7 shadow-[0_16px_32px_-24px_rgba(49,51,46,0.35)] ${tone}"><div class="markdown-body">${renderMessageBody(message.text)}</div></div>
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
    <section class="project-conversation-shell overflow-hidden rounded-[28px] border border-outline-variant/20 bg-surface-container-lowest shadow-[0_32px_80px_-36px_rgba(49,51,46,0.35)]">
      <div id="chat-feed" class="chat-feed custom-scrollbar bg-[linear-gradient(180deg,rgba(251,249,245,1)_0%,rgba(245,244,238,0.72)_100%)] px-6 py-6 md:px-7 md:py-7">
        ${renderTranscript(thread, binding)}
      </div>

      <div class="border-t border-outline-variant/10 bg-white/90 px-6 py-5 backdrop-blur-sm md:px-7">
        <form id="user-turn-form" class="rounded-[24px] border border-outline-variant/20 bg-surface-container-low shadow-[0_16px_40px_-28px_rgba(49,51,46,0.35)] transition-all focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
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
  const railButtonLabel = state.showDebugRail ? "Hide Debug" : "Show Debug";
  return `
    <div class="flex h-screen bg-background text-on-background overflow-hidden">
      ${renderSidebar("project")}
      <main class="flex-1 flex flex-col min-w-0 relative h-screen">
        <header class="flex justify-between items-center px-5 py-4 w-full bg-background border-b border-surface-container-low md:px-8">
          <div class="flex flex-col">
            <h2 class="font-headline font-bold text-2xl text-primary leading-tight">${escapeHtml(plan?.title || "Project")}</h2>
            <p class="font-body text-[10px] text-on-surface-variant/70 tracking-wide uppercase">${escapeHtml(plan ? `Plan ${plan.planId}` : "Select a project")}</p>
          </div>
          <div class="flex items-center gap-6">
            <div class="flex items-center gap-4 border-l border-outline-variant/30 pl-6">
              <button class="inline-flex items-center gap-2 rounded-full bg-surface-container px-4 py-2 text-sm font-semibold text-on-surface-variant hover:text-primary transition-colors" data-action="toggle-debug-rail">
                ${icon(state.showDebugRail ? "right_panel_close" : "right_panel_open", "text-[18px]")}
                <span>${railButtonLabel}</span>
              </button>
              <button class="rounded-full bg-surface-container p-2 text-on-surface-variant hover:text-primary transition-colors" data-action="refresh">${icon("refresh")}</button>
              <div class="w-8 h-8 rounded-full bg-primary-container overflow-hidden ring-2 ring-surface-container flex items-center justify-center text-primary font-bold">${escapeHtml(learnerName().slice(0, 1))}</div>
            </div>
          </div>
        </header>
        <div class="project-main-scroll flex-1 min-h-0">
          <div class="project-content mx-auto max-w-[1380px] px-5 py-5 md:px-8 md:py-6">
            <div class="project-workspace-grid ${state.showDebugRail ? "" : "project-workspace-grid-collapsed"}">
              <div class="project-conversation-column">
                ${renderProjectThreadSwitcher(plan, thread)}
                ${renderProjectConversation(plan, thread, binding, placeholder)}
              </div>

              <aside class="project-right-rail custom-scrollbar ${state.showDebugRail ? "" : "hidden"}">
                <div class="space-y-4">
                  ${renderCollapsiblePanel("chat-context", "Chat Context", "Project, session, workflow, and recent history for the current conversation.", renderProjectMetaPanel(plan, thread, binding), {
                    count: plan ? `${plan.threads.length} sessions` : "",
                  })}
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

function schedulePreferences() {
  const preferences = state.snapshot?.education?.schedulePreferences || {};
  return {
    showTimetableInSchedule: preferences.showTimetableInSchedule !== false,
    scheduleDefaultView: preferences.scheduleDefaultView === "month" ? "month" : "week",
  };
}

function startOfMonth(referenceDate) {
  const start = new Date(referenceDate);
  start.setDate(1);
  start.setMonth(start.getMonth() + state.scheduleOffsetMonths);
  start.setHours(0, 0, 0, 0);
  return start;
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function scheduleDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfCalendarGrid(monthStart) {
  const start = new Date(monthStart);
  const day = start.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + delta);
  start.setHours(0, 0, 0, 0);
  return start;
}

function visibleCalendarWeekCount(monthStart) {
  const leadingDays = ((monthStart.getDay() + 6) % 7);
  return Math.ceil((leadingDays + daysInMonth(monthStart)) / 7);
}

function currentAcademicWeek(start, end) {
  const items = (state.snapshot?.education?.courseItems || []).filter((item) => item.type === "class");
  const startKey = scheduleDayKey(start);
  const matchByWeekStart = items.find((item) => item.metaJson?.weekStartDate === startKey && Number.isFinite(Number(item.metaJson?.weekSerial)));
  if (matchByWeekStart) {
    return Number(matchByWeekStart.metaJson.weekSerial);
  }
  const matchByRange = items.find((item) => {
    const value = item.manualStartAt || item.startAt;
    if (!value || !Number.isFinite(Number(item.metaJson?.weekSerial))) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date >= start && date <= end;
  });
  return matchByRange ? Number(matchByRange.metaJson.weekSerial) : null;
}

function currentScheduleWindow() {
  const preferences = schedulePreferences();
  if (preferences.scheduleDefaultView === "month") {
    const monthStart = startOfMonth(new Date());
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    monthEnd.setDate(0);
    monthEnd.setHours(23, 59, 59, 999);
    const gridStart = startOfCalendarGrid(monthStart);
    const visibleWeeks = visibleCalendarWeekCount(monthStart);
    return {
      mode: "month",
      start: monthStart,
      end: monthEnd,
      days: Array.from({ length: visibleWeeks * 7 }, (_, index) => shiftDays(gridStart, index)),
      title: `第${monthStart.getMonth() + 1}月`,
      label: `${monthStart.getFullYear()}年${monthStart.getMonth() + 1}月`,
      resetLabel: "本月",
    };
  }

  const start = startOfWeek(new Date());
  const end = shiftDays(start, 6);
  end.setHours(23, 59, 59, 999);
  const academicWeek = currentAcademicWeek(start, end);
  return {
    mode: "week",
    start,
    end,
    days: Array.from({ length: 7 }, (_, index) => shiftDays(start, index)),
    title: academicWeek ? `第${academicWeek}周` : "本周",
    label: `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`,
    resetLabel: "本周",
  };
}

const SCHEDULE_PERIOD_ROW_HEIGHT = 62;

function buildSchedulePeriodSlots() {
  const allSectionValues = (state.snapshot?.education?.courseItems || [])
    .filter((item) => item.type === "class")
    .flatMap((item) => {
      const beginSection = Number(item.metaJson?.beginSection);
      const endSection = Number(item.metaJson?.endSection);
      return Number.isFinite(beginSection) && Number.isFinite(endSection) ? [beginSection, endSection] : [];
    });
  const firstSection = 1;
  const lastSection = Math.max(allSectionValues.length ? Math.max(...allSectionValues) : 10, 10);
  return Array.from({ length: Math.max(lastSection - firstSection + 1, 1) }, (_, index) => {
    const section = firstSection + index;
    return {
      key: `section-${section}`,
      section,
      label: `${section}`,
    };
  });
}

function scheduleEntryRowIndex(entry, slots) {
  const beginSection = Number(entry.beginSection);
  if (Number.isFinite(beginSection)) {
    const matched = slots.findIndex((slot) => slot.section === beginSection);
    if (matched >= 0) return matched;
  }
  return 0;
}

function scheduleEntryRowSpan(entry) {
  const beginSection = Number(entry.beginSection);
  const endSection = Number(entry.endSection);
  if (Number.isFinite(beginSection) && Number.isFinite(endSection) && endSection >= beginSection) {
    return endSection - beginSection + 1;
  }
  return 2;
}

function scheduleBodyHeight(slots) {
  return Math.max(slots.length, 1) * SCHEDULE_PERIOD_ROW_HEIGHT;
}

function hashValue(value) {
  let hash = 0;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function scheduleCoursePalette(entry) {
  const palette = [
    { background: "#e7f0ff", border: "#5d87d5" },
    { background: "#e7f7ef", border: "#5ea37b" },
    { background: "#fde9e4", border: "#ce7f74" },
    { background: "#f1e8ff", border: "#8d6ac8" },
    { background: "#e8f4f9", border: "#6d97ae" },
    { background: "#fbead7", border: "#c18c4f" },
    { background: "#f8e5ee", border: "#bc6f91" },
    { background: "#edf3e4", border: "#869f58" },
  ];
  return palette[hashValue(entry.courseId || entry.title) % palette.length];
}

function scheduleCardClasses(entry) {
  if (entry.tone === "course") {
    return "text-on-surface";
  }
  return "bg-surface-container-low border-outline-variant/18 text-on-surface";
}

function simplifyTeacherLabel(value) {
  return String(value ?? "")
    .replace(/^\[[^\]]+\]\s*/g, "")
    .replace(/^\([^)]+\)\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderScheduleCardTitle(title, options = {}) {
  const { max = 36, lines = 2, className = "text-[14px] leading-[1.22]" } = options;
  const text = compactText(title, max);
  return `<strong class="${className} overflow-hidden" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${lines};overflow-wrap:anywhere;">${escapeHtml(text)}</strong>`;
}

function renderScheduleCardDetail(detail, max = 72, lines = 2) {
  if (!detail) return "";
  return `
    <p class="text-[11px] leading-[1.35] text-on-surface-variant overflow-hidden" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${lines};">${escapeHtml(compactText(detail, max))}</p>
  `;
}

function renderScheduleCardMeta(detail, max = 44) {
  if (!detail) return "";
  const text = String(detail ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return `<p class="truncate text-[11px] leading-[1.35] text-on-surface-variant">${escapeHtml(text)}</p>`;
}

function collectMentorclawSignalsForWindow(start, end) {
  const entries = [];
  const pushEntry = (title, detail, when, tone = "primary") => {
    if (!when) return;
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || date < start || date > end) return;
    entries.push({
      id: `${tone}-${title}-${date.toISOString()}`,
      title,
      detail,
      when: date,
      endWhen: null,
      tone,
      source: "mentorclaw",
      dayKey: scheduleDayKey(date),
    });
  };

  for (const plan of state.snapshot?.plans || []) {
    for (const task of plan.tasks || []) pushEntry(task.title, `${plan.title} · ${task.status}`, task.dueAt, task.status === "blocked" ? "tertiary" : "primary");
    for (const milestone of plan.milestones || []) pushEntry(milestone.title, `${plan.title} milestone`, milestone.dueAt, "secondary");
    for (const event of plan.events || []) pushEntry(event.type.replaceAll("_", " "), `${plan.title} · ${event.impact}`, event.ts, "secondary");
    for (const thread of plan.threads || []) {
      for (const event of thread.events || []) pushEntry(event.type.replaceAll("_", " "), `${thread.title} · ${event.impact}`, event.ts, "primary");
    }
  }
  for (const event of state.snapshot?.learnerEvents || []) pushEntry(event.type.replaceAll("_", " "), event.impact, event.ts, "tertiary");

  return entries;
}

function collectTimetableEntriesForWindow(start, end) {
  if (!schedulePreferences().showTimetableInSchedule) return [];
  const courseMap = new Map((state.snapshot?.education?.courses || []).map((course) => [course.id, course]));
  return (state.snapshot?.education?.courseItems || [])
    .filter((item) => item.type === "class" && !item.isHidden)
    .flatMap((item) => {
      const startValue = item.manualStartAt || item.startAt;
      if (!startValue) return [];
      const startDate = new Date(startValue);
      if (Number.isNaN(startDate.getTime()) || startDate < start || startDate > end) return [];
      const endDate = new Date(item.manualEndAt || item.endAt || startValue);
      const course = courseMap.get(item.courseId);
      const title = item.manualTitle || item.title || course?.title || "Untitled class";
      const teacher = item.teacher || course?.teacher || "";
      const location = item.manualLocation || item.location || "";
      const manualNote = item.manualNote || "";
      const beginSection = Number(item.metaJson?.beginSection);
      const endSection = Number(item.metaJson?.endSection);
      return [{
        id: item.id,
        courseId: item.courseId,
        title,
        detail: [location, simplifyTeacherLabel(teacher), manualNote].filter(Boolean).join(" · "),
        when: startDate,
        endWhen: Number.isNaN(endDate.getTime()) ? null : endDate,
        tone: "course",
        source: "course",
        dayKey: scheduleDayKey(startDate),
        displayColor: course?.displayColor || "",
        beginSection: Number.isFinite(beginSection) ? beginSection : null,
        endSection: Number.isFinite(endSection) ? endSection : null,
        periodKey: Number.isFinite(beginSection) && Number.isFinite(endSection) ? `${beginSection}-${endSection}` : "",
      }];
    });
}

function collectScheduleEntriesV2(start, end) {
  return [...collectMentorclawSignalsForWindow(start, end), ...collectTimetableEntriesForWindow(start, end)].sort((left, right) => left.when - right.when);
}

function collectCalendarGridEntries(start, end) {
  return collectTimetableEntriesForWindow(start, end).sort((left, right) => left.when - right.when);
}

function collectScheduleSignals(start, end) {
  return collectMentorclawSignalsForWindow(start, end).sort((left, right) => left.when - right.when);
}

function renderScheduleToolbarV2(window) {
  const preferences = schedulePreferences();
  const monthActive = preferences.scheduleDefaultView === "month";
  const timetableOn = preferences.showTimetableInSchedule;
  return `
    <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div class="space-y-1">
        <h2 class="font-headline text-4xl font-bold tracking-tight">${escapeHtml(window.title || "课程日程")}</h2>
        <p class="font-body text-on-surface-variant">${escapeHtml(window.label)}</p>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-3">
        <div class="flex items-center gap-2 bg-surface-container-low p-1.5 rounded-full">
          <button class="px-4 py-2 rounded-full text-sm font-semibold transition-all ${monthActive ? "text-on-surface-variant hover:bg-white/70" : "bg-white text-primary shadow-sm"}" data-action="schedule-view" data-view-mode="week">Week</button>
          <button class="px-4 py-2 rounded-full text-sm font-semibold transition-all ${monthActive ? "bg-white text-primary shadow-sm" : "text-on-surface-variant hover:bg-white/70"}" data-action="schedule-view" data-view-mode="month">Month</button>
        </div>
        <button class="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all ${timetableOn ? "border-primary/30 bg-primary/10 text-primary" : "border-outline-variant/30 bg-surface-container-low text-on-surface-variant"}" data-action="toggle-timetable">
          ${icon(timetableOn ? "visibility" : "visibility_off", "text-base")}
          <span>${timetableOn ? "Timetable on" : "Timetable off"}</span>
        </button>
        <div class="flex items-center gap-3 bg-surface-container-low p-1.5 rounded-full">
          <button class="p-2 hover:bg-white rounded-full transition-all flex items-center justify-center" data-action="schedule-prev">${icon("chevron_left", "text-sm")}</button>
          <button class="text-sm font-bold px-2" data-action="schedule-today">${escapeHtml(window.resetLabel || "Today")}</button>
          <button class="p-2 hover:bg-white rounded-full transition-all flex items-center justify-center" data-action="schedule-next">${icon("chevron_right", "text-sm")}</button>
        </div>
      </div>
    </div>
  `;
}

function renderWeekScheduleGridV2(window, entries) {
  const todayKey = scheduleDayKey(new Date());
  const slots = buildSchedulePeriodSlots();
  const bodyHeight = scheduleBodyHeight(slots);

  return `
    <div class="overflow-hidden rounded-xl border border-[#eadfcd] bg-[#fbf6ee] shadow-[0_32px_64px_-12px_rgba(49,51,46,0.04)]">
      <div class="overflow-x-auto overflow-y-visible custom-scrollbar">
        <div class="grid min-w-[1080px] grid-cols-[54px_repeat(7,minmax(148px,1fr))]">
          <div class="sticky top-0 left-0 z-30 border-b border-r border-[#eadfcd] bg-[#f5eee2]"></div>
          ${window.days
            .map(
              (day) => `
                <div class="sticky top-0 z-20 border-b border-l border-[#eadfcd] p-4 text-center ${scheduleDayKey(day) === todayKey ? "bg-[#efe3cf]" : "bg-[#f5eee2]"}">
                  <p class="text-[10px] font-bold uppercase tracking-widest ${scheduleDayKey(day) === todayKey ? "text-primary" : "text-on-surface-variant/60"}">${escapeHtml(day.toLocaleDateString("en-US", { weekday: "short" }))}</p>
                  <p class="mt-1 text-xl font-headline font-bold ${scheduleDayKey(day) === todayKey ? "text-primary" : ""}">${day.getDate()}</p>
                </div>
              `,
            )
            .join("")}
          <div class="sticky left-0 z-10 border-r border-[#eadfcd] bg-[#faf3e8]" style="height:${bodyHeight}px;">
            <div class="relative h-full">
              ${slots
                .map((slot, index) => {
                  const top = index * SCHEDULE_PERIOD_ROW_HEIGHT;
                  return `
                    <div class="absolute inset-x-0 flex h-[${SCHEDULE_PERIOD_ROW_HEIGHT}px] items-start justify-center px-1 pt-3 text-center" style="top:${top}px;">
                      <div>
                        <div class="text-[13px] font-bold tracking-tight text-on-surface/72">${escapeHtml(slot.label)}</div>
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </div>
          ${window.days
            .map(
              (day) => `
                <div
                  class="relative border-l border-[#eadfcd] ${scheduleDayKey(day) === todayKey ? "bg-[#f8f0e4]" : "bg-[#fcf8f2]"}"
                  style="height:${bodyHeight}px;"
                >
                  ${slots
                    .map((slot, index) => `<div class="absolute inset-x-0 border-t border-[#eadfcd]" style="top:${index * SCHEDULE_PERIOD_ROW_HEIGHT}px;"></div>`)
                    .join("")}
                  <div class="absolute inset-x-0 bottom-0 border-t border-[#eadfcd]"></div>
                  ${entries
                    .filter((entry) => entry.dayKey === scheduleDayKey(day))
                    .map((entry) => {
                      const rowIndex = scheduleEntryRowIndex(entry, slots);
                      const top = rowIndex * SCHEDULE_PERIOD_ROW_HEIGHT;
                      const rowSpan = scheduleEntryRowSpan(entry);
                      const height = rowSpan * SCHEDULE_PERIOD_ROW_HEIGHT;
                      const palette = scheduleCoursePalette(entry);
                      const cardStyle = `background:${palette.background}; border-color:${palette.border}33; border-left-color:${palette.border};`;
                      return `
                        <div class="absolute left-2 right-2 overflow-hidden rounded-xl border border-l-4 px-2.5 py-2 shadow-sm transition-transform hover:scale-[1.01] ${scheduleCardClasses(entry)}" style="top:${top + 4}px; height:${height - 8}px; ${cardStyle}">
                          <div class="flex h-full flex-col gap-1">
                            <span class="text-[9px] font-bold uppercase tracking-wide text-on-surface-variant">${escapeHtml(formatClock(entry.when))}${entry.endWhen ? ` - ${escapeHtml(formatClock(entry.endWhen))}` : ""}</span>
                            ${renderScheduleCardTitle(entry.title, { max: rowSpan > 2 ? 44 : 28, lines: rowSpan > 2 ? 2 : 1, className: rowSpan > 2 ? "text-[14px] leading-[1.15]" : "text-[13px] leading-[1.15]" })}
                            ${renderScheduleCardMeta(entry.detail, rowSpan > 2 ? 56 : 36)}
                          </div>
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
  `;
}

function renderMonthScheduleGridV2(window, entries) {
  const todayKey = scheduleDayKey(new Date());
  const currentMonth = window.start.getMonth();
  return `
    <div class="overflow-hidden rounded-xl border border-[#eadfcd] bg-[#fbf6ee] shadow-[0_32px_64px_-12px_rgba(49,51,46,0.04)]">
      <div class="grid grid-cols-7 border-b border-[#eadfcd] bg-[#f5eee2]">
        ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => `<div class="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/70">${label}</div>`).join("")}
      </div>
      <div class="grid grid-cols-7">
        ${window.days
          .map((day) => {
            const key = scheduleDayKey(day);
            const dayEntries = entries.filter((entry) => entry.dayKey === key);
            const visibleEntries = dayEntries.slice(0, 4);
            const extraCount = Math.max(0, dayEntries.length - visibleEntries.length);
            return `
              <div class="min-h-[148px] border-r border-b border-[#eadfcd] p-3 ${day.getMonth() === currentMonth ? "bg-[#fcf8f2]" : "bg-[#f7f0e6]"} ${key === todayKey ? "bg-[#f4ead9]" : ""}">
                <div class="flex items-center justify-between mb-3">
                  <span class="text-sm font-bold ${key === todayKey ? "text-primary" : "text-on-surface"}">${day.getDate()}</span>
                  ${key === todayKey ? '<span class="text-[10px] uppercase tracking-[0.16em] text-primary">Today</span>' : ""}
                </div>
                <div class="space-y-2">
                  ${visibleEntries
                    .map(
                      (entry) => {
                        const palette = scheduleCoursePalette(entry);
                        const cardStyle = `background:${palette.background}; border-color:${palette.border}33; border-left-color:${palette.border};`;
                        return `
                        <div class="rounded-lg border border-l-4 border-outline-variant/10 px-3 py-2" style="${cardStyle}">
                          <div class="flex items-center justify-between gap-2">
                            ${renderScheduleCardTitle(entry.title, { max: 26, lines: 2, className: "text-[12px] leading-[1.18]" })}
                            <span class="text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">${escapeHtml(formatClock(entry.when))}</span>
                          </div>
                          ${renderScheduleCardMeta(entry.detail, 28)}
                        </div>
                      `;
                      },
                    )
                    .join("")}
                  ${extraCount ? `<div class="text-[11px] font-medium text-on-surface-variant">+${extraCount} more</div>` : ""}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderSchedulePageV2() {
  const window = currentScheduleWindow();
  const rangeStart = window.mode === "month" ? window.days[0] : window.start;
  const rangeEnd = window.mode === "month" ? window.days[window.days.length - 1] : window.end;
  rangeEnd.setHours(23, 59, 59, 999);
  const calendarEntries = collectCalendarGridEntries(rangeStart, rangeEnd);
  const signalEntries = collectScheduleSignals(rangeStart, rangeEnd);
  return `
    <div class="bg-background text-on-surface antialiased flex min-h-screen">
      ${renderSidebar("schedule")}
      <main class="flex-1 flex flex-col h-screen overflow-hidden">
        <header class="sticky top-0 z-50 flex w-full items-center justify-end bg-background/80 px-8 py-2 backdrop-blur-md">
          <div class="flex items-center gap-4">
            <button class="text-on-surface-variant hover:text-primary transition-colors p-2 cursor-pointer" data-action="refresh">${icon("notifications")}</button>
            <div class="w-8 h-8 rounded-full overflow-hidden bg-surface-container border border-outline-variant/20 flex items-center justify-center text-primary font-bold">${escapeHtml(learnerName().slice(0, 1))}</div>
          </div>
        </header>
        <div class="flex-1 overflow-y-auto px-8 pb-12 custom-scrollbar">
          <div class="mx-auto mt-1 max-w-[1280px]">
            ${renderScheduleToolbarV2(window)}
            ${window.mode === "month" ? renderMonthScheduleGridV2(window, calendarEntries) : renderWeekScheduleGridV2(window, calendarEntries)}
            <div class="mt-8 grid gap-6 md:grid-cols-2">
              <section class="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 p-6">
                <h3 class="font-headline text-2xl font-bold">${window.mode === "month" ? "This Month's Signals" : "This Week's Signals"}</h3>
                <div class="mt-4 space-y-3">
                  ${signalEntries.length
                    ? signalEntries.slice(0, 5).map((entry) => `
                        <div class="rounded-xl bg-surface-container-low px-4 py-3">
                          <div class="flex items-center justify-between gap-3">
                            <strong class="text-sm">${escapeHtml(entry.title)}</strong>
                            <span class="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">${escapeHtml(formatDateShort(entry.when.toISOString()))}</span>
                          </div>
                          <p class="mt-1 text-sm text-on-surface-variant">${escapeHtml(compactText(entry.detail, 88))}</p>
                        </div>
                      `).join("")
                    : `<div class="rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">No mentor signals are currently scheduled for this ${window.mode}.</div>`}
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
  if (state.activeView === "schedule") return renderSchedulePageV2();
  if (state.activeView === "project") return renderProjectPage();
  return renderDashboardPage();
}

function render() {
  const viewChanged = lastRenderedView !== state.activeView;
  app.innerHTML = renderApp();
  lastRenderedView = state.activeView;
  if (viewChanged) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
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
    applyProjectSelection(planId);
    state.showCreateThread = false;
    state.activeView = "project";
    syncSelection();
    render();
    return;
  }
  if (action === "select-thread") {
    const planId = button.dataset.planId || state.selectedPlanId;
    const threadId = button.dataset.threadId || "";
    applyProjectSelection(planId, threadId);
    state.showCreateThread = false;
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
    applyProjectSelection(planId);
    state.activeView = "project";
    state.showCreateThread = true;
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
  if (action === "toggle-debug-rail") {
    state.showDebugRail = !state.showDebugRail;
    syncSelection();
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
  if (action === "schedule-view") {
    const view = button.dataset.viewMode;
    if (view !== "month" && view !== "week") return;
    submitJson("/api/schedule/preferences", { scheduleDefaultView: view }, async (snapshot) => {
      state.snapshot = snapshot;
      syncSelection();
      render();
      setFlash("info", `Schedule switched to ${view} view.`);
    });
    return;
  }
  if (action === "toggle-timetable") {
    const next = !schedulePreferences().showTimetableInSchedule;
    submitJson("/api/schedule/preferences", { showTimetableInSchedule: next }, async (snapshot) => {
      state.snapshot = snapshot;
      syncSelection();
      render();
      setFlash("info", next ? "Timetable is now visible in schedule." : "Timetable hidden from schedule.");
    });
    return;
  }
  if (action === "schedule-prev") {
    if (schedulePreferences().scheduleDefaultView === "month") {
      state.scheduleOffsetMonths -= 1;
    } else {
      state.scheduleOffsetWeeks -= 1;
    }
    syncSelection();
    render();
    return;
  }
  if (action === "schedule-next") {
    if (schedulePreferences().scheduleDefaultView === "month") {
      state.scheduleOffsetMonths += 1;
    } else {
      state.scheduleOffsetWeeks += 1;
    }
    syncSelection();
    render();
    return;
  }
  if (action === "schedule-today") {
    state.scheduleOffsetWeeks = 0;
    state.scheduleOffsetMonths = 0;
    syncSelection();
    render();
    return;
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
      const selectedThread = plan?.threads?.find((item) => item.threadId === state.selectedThreadId) || null;
      state.sessionKey = preferredSessionKeyForThread(selectedThread);
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
    state.drafts.userMessage = "";
    startPendingTurnTicker();
    render();
    const outcome = await submitJson("/api/turns", {
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
      state.lastAssistantReplySource = result.assistantReplySource || "";
      state.lastTurnTiming = result.timing || null;
      state.activeView = "project";
      syncSelection();
      render();
      const timing = turnTimingSummary(result.timing);
      setFlash("info", timing ? `Reply recorded · ${timing}` : "Reply recorded into the runtime.");
    });
    if (!outcome.ok) state.drafts.userMessage = message;
    stopPendingTurnTicker();
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
