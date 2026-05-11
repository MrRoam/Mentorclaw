import { createHash, randomUUID } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EducationRepo } from "../../../storage/education-repo.ts";

export interface BuaaBaseUrls {
  ssoBase: string;
  ucBase: string;
  byxtBase: string;
  yjapiBase: string;
  classroomBase: string;
}

export interface BuaaFetchResult {
  response: Response;
  bodyText: string;
  finalUrl: string;
}

export type FetchLike = typeof fetch;

export interface BuaaPasswordAuth {
  username?: string | null;
  password?: string | null;
}

export const defaultBuaaBaseUrls = (): BuaaBaseUrls => ({
  ssoBase: "https://sso.buaa.edu.cn",
  ucBase: "https://uc.buaa.edu.cn",
  byxtBase: "https://byxt.buaa.edu.cn",
  yjapiBase: "https://yjapi.msa.buaa.edu.cn",
  classroomBase: "https://classroom.msa.buaa.edu.cn",
});

export const resolveBuaaBaseUrls = (overrides?: Partial<BuaaBaseUrls> | null): BuaaBaseUrls => ({
  ...defaultBuaaBaseUrls(),
  ...(overrides ?? {}),
});

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  accept: "*/*",
};
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

const BUAA_NO_PROXY_HOSTS = [
  "buaa.edu.cn",
  ".buaa.edu.cn",
  "sso.buaa.edu.cn",
  "uc.buaa.edu.cn",
  "byxt.buaa.edu.cn",
  "yjapi.msa.buaa.edu.cn",
  "classroom.msa.buaa.edu.cn",
];

const appendNoProxyHosts = (key: "NO_PROXY" | "no_proxy"): void => {
  const existing = process.env[key]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  process.env[key] = Array.from(new Set([...existing, ...BUAA_NO_PROXY_HOSTS])).join(",");
};

const configureBuaaNetworkDefaults = (): void => {
  try {
    setDefaultResultOrder("ipv4first");
  } catch {}
  appendNoProxyHosts("NO_PROXY");
  appendNoProxyHosts("no_proxy");
};

configureBuaaNetworkDefaults();

const charsetFromContentType = (contentType: string | null): string => {
  const charset = contentType?.match(/charset=([^;\s]+)/i)?.[1]?.trim().toLowerCase();
  if (!charset) return "utf-8";
  if (charset === "gbk" || charset === "gb2312") return "gb18030";
  return charset;
};

const decodeQualityScore = (text: string): number => {
  const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
  const mojibakeCount = Array.from(text).filter((char) => char.charCodeAt(0) >= 0xE000).length;
  const readableChineseCount = Array.from(text).filter((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x4E00 && code <= 0x9FFF;
  }).length;
  return replacementCount * 20 + mojibakeCount * 2 - readableChineseCount;
};

const decodeResponseBody = async (response: Response): Promise<string> => {
  const bytes = await response.arrayBuffer();
  const charset = charsetFromContentType(response.headers.get("content-type"));
  const utf8Text = new TextDecoder("utf-8").decode(bytes);
  try {
    const declaredText = new TextDecoder(charset).decode(bytes);
    if (charset !== "utf-8" && decodeQualityScore(utf8Text) < decodeQualityScore(declaredText)) {
      return utf8Text;
    }
    return declaredText;
  } catch {
    return utf8Text;
  }
};

interface HtmlInputField {
  name: string;
  type: string;
  value: string;
  checked: boolean;
}

const extractHtmlAttribute = (tag: string, attribute: string): string => {
  const doubleQuoted = tag.match(new RegExp(`${attribute}\\s*=\\s*"([^"]*)"`, "i"))?.[1];
  if (typeof doubleQuoted === "string") {
    return doubleQuoted;
  }
  const singleQuoted = tag.match(new RegExp(`${attribute}\\s*=\\s*'([^']*)'`, "i"))?.[1];
  if (typeof singleQuoted === "string") {
    return singleQuoted;
  }
  const bare = tag.match(new RegExp(`${attribute}\\s*=\\s*([^\\s\"'=><]+)`, "i"))?.[1];
  return typeof bare === "string" ? bare : "";
};

const parseHtmlInputFields = (html: string): HtmlInputField[] => {
  const fields: HtmlInputField[] = [];
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    const name = extractHtmlAttribute(tag, "name").trim();
    if (!name) continue;
    fields.push({
      name,
      type: extractHtmlAttribute(tag, "type").trim().toLowerCase() || "text",
      value: extractHtmlAttribute(tag, "value"),
      checked: /\bchecked(?:\s*=\s*(?:"checked"|'checked'|checked))?\b/i.test(tag),
    });
  }
  return fields;
};

const normalizeCookieName = (value: string): string => value.trim();

const parseSetCookieHeader = (header: string): { name: string; value: string } | null => {
  const firstChunk = header.split(";")[0] ?? "";
  const separator = firstChunk.indexOf("=");
  if (separator <= 0) return null;
  const name = normalizeCookieName(firstChunk.slice(0, separator));
  if (!name) return null;
  return {
    name,
    value: firstChunk.slice(separator + 1).trim(),
  };
};

const parseCookieHeader = (header: string): Array<{ name: string; value: string }> =>
  header
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const separator = segment.indexOf("=");
      if (separator <= 0) return null;
      return {
        name: normalizeCookieName(segment.slice(0, separator)),
        value: segment.slice(separator + 1).trim(),
      };
    })
    .filter((entry): entry is { name: string; value: string } => Boolean(entry?.name));

const readCookieValue = (header: string | null | undefined, name: string): string => {
  if (!header?.trim()) return "";
  const found = parseCookieHeader(header).find((entry) => entry.name === name);
  return found?.value ?? "";
};

class CookieJar {
  readonly cookies = new Map<string, string>();

  seed(header?: string | null): void {
    if (!header?.trim()) return;
    for (const cookie of parseCookieHeader(header)) {
      this.cookies.set(cookie.name, cookie.value);
    }
  }

  absorb(headers: Headers): void {
    const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const values = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [];
    for (const header of values) {
      const parsed = parseSetCookieHeader(header);
      if (!parsed) continue;
      this.cookies.set(parsed.name, parsed.value);
    }
  }

  toHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

export class BuaaSessionClient {
  private readonly jar = new CookieJar();
  private readonly fetchImpl: FetchLike;

  constructor(options?: {
    cookie?: string | null;
    fetchImpl?: FetchLike;
  }) {
    this.jar.seed(options?.cookie);
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  cookieHeader(): string {
    return this.jar.toHeader();
  }

  async get(url: string, init?: Omit<RequestInit, "method">): Promise<BuaaFetchResult> {
    return this.request(url, { ...init, method: "GET" });
  }

  async postForm(
    url: string,
    body: URLSearchParams | Record<string, string>,
    init?: Omit<RequestInit, "method" | "body">,
  ): Promise<BuaaFetchResult> {
    const form = body instanceof URLSearchParams ? body : new URLSearchParams(body);
    return this.request(url, {
      ...init,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        ...(init?.headers ?? {}),
      },
      body: form.toString(),
    });
  }

  async postJson(
    url: string,
    body: unknown,
    init?: Omit<RequestInit, "method" | "body">,
  ): Promise<BuaaFetchResult> {
    return this.request(url, {
      ...init,
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        ...(init?.headers ?? {}),
      },
      body: JSON.stringify(body),
    });
  }

  async request(url: string, init?: RequestInit): Promise<BuaaFetchResult> {
    let currentUrl = url;
    let requestInit: RequestInit = { ...init };
    for (let redirectCount = 0; redirectCount < 10; redirectCount += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
      const headers = new Headers({
        ...DEFAULT_HEADERS,
        ...(requestInit.headers ?? {}),
      });
      const cookieHeader = this.jar.toHeader();
      if (cookieHeader && !headers.has("cookie")) {
        headers.set("cookie", cookieHeader);
      }
      let response: Response;
      let bodyText: string;
      try {
        response = await this.fetchImpl(currentUrl, {
          ...requestInit,
          headers,
          redirect: "manual",
          signal: requestInit.signal ?? controller.signal,
        });
        this.jar.absorb(response.headers);
        bodyText = await decodeResponseBody(response);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error(`BUAA request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS / 1000}s: ${currentUrl}`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return { response, bodyText, finalUrl: currentUrl };
        }
        currentUrl = new URL(location, currentUrl).toString();
        const method = (requestInit.method ?? "GET").toUpperCase();
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
          requestInit = {
            ...requestInit,
            method: "GET",
            body: undefined,
          };
        }
        continue;
      }

      return { response, bodyText, finalUrl: currentUrl };
    }

    throw new Error(`Too many redirects while requesting ${url}`);
  }
}

export const decodeJson = <T>(bodyText: string, label: string): T => {
  try {
    return JSON.parse(bodyText) as T;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.`);
  }
};

export const ensureOk = (result: BuaaFetchResult, label: string): void => {
  if (!result.response.ok) {
    const safeUrl = result.finalUrl
      ? ` at ${result.finalUrl.replace(/([?&](?:ticket|password|captcha)=)[^&]+/gi, "$1[redacted]")}`
      : "";
    const bodyHint = result.bodyText
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    throw new Error(`${label} failed with HTTP ${result.response.status}${safeUrl}${bodyHint ? `: ${bodyHint}` : ""}.`);
  }
};

const extractSsoExecution = (html: string): string =>
  html.match(/name=["']execution["'][^>]*value=["']([^"']+)["']/i)?.[1]?.trim() ?? "";

const detectSsoCaptcha = (html: string): boolean =>
  /config\.captcha\s*=\s*\{/i.test(html) || /captchaId=/i.test(html);

const extractSsoTipText = (html: string): string | null =>
  html.match(/<div class=["']tip-text["']>([^<]+)<\/div>/i)?.[1]?.trim() ?? null;

const ensureSsoLoginSucceeded = (html: string): void => {
  const failure = extractSsoTipText(html);
  if (failure) {
    throw new Error(`BUAA SSO login failed: ${failure}`);
  }
  if (/name=["']execution["']/i.test(html)) {
    throw new Error("BUAA SSO login failed: credentials were rejected or the login flow was not completed.");
  }
};

const buildSsoLoginForm = (html: string, auth: BuaaPasswordAuth): Record<string, string> => {
  const fields = parseHtmlInputFields(html);
  const form: Record<string, string> = {};

  for (const field of fields) {
    if (field.name === "username" || field.name === "password") {
      continue;
    }
    if (field.type === "submit" || field.type === "button" || field.type === "image") {
      continue;
    }
    if (field.type === "checkbox") {
      if (field.checked) {
        form[field.name] = field.value || "on";
      }
      continue;
    }
    if (field.type === "hidden" || field.value.trim()) {
      form[field.name] = field.value;
    }
  }

  form.username = auth.username?.trim() || "";
  form.password = auth.password?.trim() || "";

  if (!("submit" in form)) {
    const submitValue = fields.find((field) => field.name === "submit")?.value || "LOGIN";
    form.submit = submitValue;
  }
  if (!("type" in form)) {
    form.type = "username_password";
  }
  if (!("_eventId" in form)) {
    form._eventId = "submit";
  }

  return form;
};

export const loginBuaaSsoWithPassword = async (
  client: BuaaSessionClient,
  auth: BuaaPasswordAuth,
  baseUrls: BuaaBaseUrls,
  label = "BUAA SSO",
  loginUrl = `${baseUrls.ssoBase}/login`,
): Promise<void> => {
  if (!auth.username?.trim() || !auth.password?.trim()) {
    throw new Error(`${label} login requires username and password.`);
  }

  const loginPage = await client.get(loginUrl);
  ensureOk(loginPage, `${label} login page`);
  const execution = extractSsoExecution(loginPage.bodyText);
  if (!execution) {
    throw new Error(`${label} login page did not contain an execution token.`);
  }
  if (detectSsoCaptcha(loginPage.bodyText)) {
    throw new Error(`${label} currently requires CAPTCHA. Please complete one browser login first.`);
  }

  const loginForm = buildSsoLoginForm(loginPage.bodyText, auth);
  loginForm.execution = execution;
  const submit = await client.postForm(loginPage.finalUrl || loginUrl, loginForm);
  ensureOk(submit, `${label} login`);
  ensureSsoLoginSucceeded(submit.bodyText);
};

export const sanitizeFileSegment = (value: string, fallback: string): string => {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return sanitized || fallback;
};

export const normalizeCourseHint = (title: string, teacher?: string | null): string =>
  [title.trim().toLowerCase(), (teacher ?? "").trim().toLowerCase()].filter(Boolean).join("|");

export const normalizeTeacherLabel = (raw: string | null | undefined): string => {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  return value
    .replace(/\u7b2c?\s*\d+(?:-\d+)?\s*\u5468/g, " ")
    .replace(/[\u5355\u53cc\u5168]\s*\u5468/g, " ")
    .replace(/(^|[\s,，、;；])\u5468[\u5355\u53cc\u5168]?(?=$|[\s,，、;；\[])/g, " ")
    .replace(/(^|[\s,，、;；])[\u5355\u53cc\u5168](?=$|[\s,，、;；\[])/g, " ")
    .replace(/\[\s*(?:\u4e3b\u8bb2|\u7406\u8bba|\u5b9e\u8df5|\u5b9e\u9a8c)\s*\]/g, " ")
    .replace(/\b\u4e3b\u8bb2\b/g, " ")
    .replace(/\b\d+(?:-\d+)?\s*(?:week|weeks)?\b/gi, " ")
    .replace(/[(){}<>]/g, " ")
    .replace(/[;|/\\]+/g, " ")
    .replace(/^[\s,，、;；]+|[\s,，、;；]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const normalizeDateOnly = (dateText: string | null | undefined): string | null => {
  const raw = String(dateText ?? "").trim();
  if (!raw) return null;
  const exactMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (exactMatch) {
    return exactMatch[1];
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString().slice(0, 10);
};

export const addDays = (dateText: string, days: number): string | null => {
  const normalizedDate = normalizeDateOnly(dateText);
  if (!normalizedDate) return null;
  const [year, month, day] = normalizedDate.split("-").map((part) => Number(part));
  const value = new Date(Date.UTC(year, Math.max(month - 1, 0), day + days));
  return value.toISOString().slice(0, 10);
};

export const combineShanghaiDateTime = (dateText: string | null | undefined, timeText: string | null | undefined): string | null => {
  const normalizedTime = String(timeText ?? "").trim();
  if (!dateText || !normalizedTime) return null;
  const time = /^\d{2}:\d{2}$/.test(normalizedTime) ? `${normalizedTime}:00` : normalizedTime;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) return null;
  return `${dateText}T${time}+08:00`;
};

export const normalizeDateTime = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1e12 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }

  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw)).toISOString();
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000).toISOString();
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return new Date(raw).toISOString();
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    const normalized = raw.replace(" ", "T");
    return new Date(`${normalized}${normalized.length === 16 ? ":00" : ""}+08:00`).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00+08:00`).toISOString();
  }
  return null;
};

export const extractJwtTokenFromCookieString = (cookie: string | null | undefined): string => {
  const rawTokenCookie = readCookieValue(cookie, "_token");
  if (rawTokenCookie) {
    const decodedTokenCookie = decodeURIComponent(rawTokenCookie);
    const serializedMatch = decodedTokenCookie.match(/{i:\d+;s:\d+:"_token";i:\d+;s:\d+:"(.+?)";}/);
    if (serializedMatch?.[1]?.trim()) {
      return serializedMatch[1].trim();
    }
    if (decodedTokenCookie.trim()) {
      return decodedTokenCookie.trim();
    }
  }

  const jwtUserCookie = readCookieValue(cookie, "JWTUser");
  if (jwtUserCookie) {
    const decodedJwtUser = decodeURIComponent(jwtUserCookie);
    const match = decodedJwtUser.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
    if (match) {
      return match[0];
    }
  }

  const decoded = decodeURIComponent(cookie ?? "");
  const match = decoded.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
  return match ? match[0] : "";
};

const decodeJwtPayload = (jwt: string): Record<string, unknown> | null => {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const extractJwtAccountFromCookieString = (cookie: string | null | undefined): string => {
  const jwt = extractJwtTokenFromCookieString(cookie);
  const payload = decodeJwtPayload(jwt);
  if (typeof payload?.account === "string" && payload.account.trim()) {
    return payload.account.trim();
  }

  const decoded = decodeURIComponent(cookie ?? "");
  const match = decoded.match(/(?:^|;\s*)"?JWTUser"?=([^;]+)/);
  if (!match) return "";
  try {
    const parsed = JSON.parse(match[1].replace(/^"|"$/g, ""));
    return typeof parsed?.account === "string" ? parsed.account.trim() : "";
  } catch {
    return "";
  }
};

export const inferCurrentAcademicTerm = (now: Date = new Date()): string => {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 2 && month <= 7) return `${year} Spring`;
  if (month >= 8) return `${year} Fall`;
  return `${year - 1} Fall`;
};

export const md5Hex = (text: string): string => createHash("md5").update(text).digest("hex");

export const createSignedMsaVideoUrl = (
  rawUrl: string,
  user: {
    id?: string | number | null;
    tenant_id?: string | number | null;
    phone?: string | number | null;
  },
): string => {
  if (!user.id || !user.tenant_id || !user.phone) {
    throw new Error("MSA user info is incomplete, cannot sign the video URL.");
  }

  const target = new URL(rawUrl, "https://classroom.msa.buaa.edu.cn");
  target.searchParams.set("clientUUID", randomUUID());
  const epoch = Math.floor(Date.now() / 1000);
  const reversedPhone = String(user.phone).split("").reverse().join("");
  const signature = md5Hex(`${target.pathname}${user.id}${user.tenant_id}${reversedPhone}${epoch}`);
  target.searchParams.set("t", `${user.id}-${epoch}-${signature}`);
  return target.toString();
};

export const buildPptPrintHtml = (input: {
  title: string;
  generatedAt: string;
  slides: Array<{ imageUrl: string; index: number; timeText?: string | null }>;
}): string => {
  const title = escapeHtml(input.title);
  const generatedAt = escapeHtml(input.generatedAt);
  const slidesMarkup = input.slides
    .map(
      (slide) => `
        <section class="slide-card">
          <img class="ppt-image" src="${escapeHtml(slide.imageUrl)}" alt="Slide ${slide.index}">
          <div class="slide-meta">
            <span>Slide ${slide.index}</span>
            <span>${escapeHtml(slide.timeText || "")}</span>
          </div>
        </section>
      `,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>${title} - Slide Print</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px;
        background: #eef3fb;
        color: #0f172a;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .doc-header {
        max-width: 1024px;
        margin: 0 auto 20px;
        padding: 20px 22px;
        border-radius: 18px;
        background: white;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08);
      }
      .doc-header h1 { margin: 0 0 8px; font-size: 28px; }
      .doc-header p { margin: 6px 0 0; color: #475569; font-size: 14px; }
      .slide-card {
        width: min(1024px, 100%);
        margin: 0 auto 24px;
        overflow: hidden;
        border-radius: 18px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: white;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
      }
      .ppt-image {
        display: block;
        width: 100%;
        background: white;
      }
      .slide-meta {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 16px;
        color: #475569;
        font-size: 13px;
        border-top: 1px solid rgba(148, 163, 184, 0.22);
      }
      @media print {
        @page { margin: 1cm; }
        body { background: white; padding: 0; }
        .doc-header {
          padding: 0 0 12px;
          border-radius: 0;
          box-shadow: none;
          border-bottom: 2px solid #334155;
        }
        .slide-card {
          width: 100%;
          margin: 0;
          border-radius: 0;
          box-shadow: none;
          page-break-after: always;
          border: 1px solid #94a3b8;
        }
        .ppt-image {
          max-width: 100%;
          max-height: 82vh;
          width: auto;
          margin: 0 auto;
        }
      }
    </style>
  </head>
  <body>
    <header class="doc-header">
      <h1>${title}</h1>
      <p>Generated at ${generatedAt}</p>
      <p>Use the browser print dialog to save this page as PDF if needed.</p>
    </header>
    ${slidesMarkup || '<div class="doc-header"><p>No slides were captured.</p></div>'}
  </body>
</html>
`;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const relativeRuntimePath = (repo: EducationRepo, absolutePath: string): string =>
  path.relative(repo.runtimeRoot, absolutePath) || absolutePath;

export const writeRuntimeAsset = async (
  repo: EducationRepo,
  segments: string[],
  content: string,
): Promise<{ absolutePath: string; relativePath: string }> => {
  const absolutePath = path.join(repo.educationDir, "assets", ...segments);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  return {
    absolutePath,
    relativePath: relativeRuntimePath(repo, absolutePath),
  };
};

