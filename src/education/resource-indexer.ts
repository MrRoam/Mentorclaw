import { execFile } from "node:child_process";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CourseResourceRecord } from "../schemas/education.ts";
import { EducationRepo } from "../storage/education-repo.ts";
import { tokenizeMessage } from "./project-resource-service.ts";

const execFileAsync = promisify(execFile);

export interface TimestampIndexSegment {
  kind: "timestamp";
  startSec: number;
  endSec: number;
  text: string;
  keywords: string[];
}

export interface PageIndexSegment {
  kind: "page";
  page: number;
  text: string;
  keywords: string[];
}

export type ResourceIndexSegment = TimestampIndexSegment | PageIndexSegment;

export interface ResourceIndexRecord {
  resourceId: string;
  courseId: string;
  projectId: string | null;
  linkedItemId: string | null;
  resourceType: string;
  sourcePathOrUrl: string;
  sourceFingerprint: string;
  version: number;
  updatedAt: string;
  segments: ResourceIndexSegment[];
}

const RESOURCE_INDEX_VERSION = 3;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const stripHtml = (value: string): string =>
  collapseWhitespace(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
  );

const compactSnippet = (value: string, maxLength: number = 800): string => {
  const text = collapseWhitespace(value);
  return text.length <= maxLength ? text : text.slice(0, maxLength);
};

const fileFingerprint = async (filePath: string): Promise<string> => {
  const info = await stat(filePath);
  return `${info.size}:${Math.floor(info.mtimeMs)}`;
};

const normalizeImageUrls = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];

const parseSlideTimeSecFromUrl = (value: string): number | null => {
  const candidate = value.split("?")[0]?.split("/").pop()?.trim() ?? "";
  const match = candidate.match(/^(\d+)\.(?:jpg|jpeg|png|webp)$/i);
  if (!match) return null;
  const milliseconds = Number(match[1]);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  return milliseconds / 1000;
};

const collapseOcrLines = (value: string): string => collapseWhitespace(value.replace(/\r?\n/g, " "));

const buildImageUrlSegments = async (imageUrls: string[]): Promise<PageIndexSegment[]> => {
  if (!imageUrls.length) return [];

  const pythonScript = `
import json
import sys
import requests
import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR

ocr = RapidOCR()
results = []

for raw in sys.argv[1:]:
    url = raw.strip()
    if not url:
        results.append("")
        continue
    try:
        if url.startswith("http://") or url.startswith("https://"):
            response = requests.get(url, timeout=20)
            response.raise_for_status()
            image = cv2.imdecode(np.frombuffer(response.content, dtype=np.uint8), cv2.IMREAD_COLOR)
            ocr_result, _ = ocr(image)
        else:
            ocr_result, _ = ocr(url)
        if not ocr_result:
            results.append("")
            continue
        text = " ".join([str(line[1]) for line in ocr_result if len(line) > 1 and str(line[1]).strip()])
        results.append(text.strip())
    except Exception:
        results.append("")

print(json.dumps(results, ensure_ascii=False))
`;

  const { stdout } = await execFileAsync("python", ["-c", pythonScript, ...imageUrls], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as string[];
  return parsed
    .map((text, index) => ({
      kind: "page" as const,
      page: index + 1,
      text: compactSnippet(collapseOcrLines(text)),
    }))
    .filter((segment) => Boolean(segment.text))
    .map((segment) => ({
      ...segment,
      keywords: tokenizeMessage(segment.text).slice(0, 32),
    }));
};

const parseSrtTimestamp = (value: string): number => {
  const match = value.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
};

const parseSrtSegments = (raw: string): TimestampIndexSegment[] => {
  const blocks = raw.split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean);
  const segments: TimestampIndexSegment[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timingLine = lines.find((line) => line.includes("-->"));
    if (!timingLine) continue;
    const [startRaw, endRaw] = timingLine.split("-->").map((part) => part.trim());
    const textLines = lines.slice(lines.indexOf(timingLine) + 1);
    const text = compactSnippet(textLines.join(" "));
    if (!text) continue;
    segments.push({
      kind: "timestamp",
      startSec: parseSrtTimestamp(startRaw),
      endSec: parseSrtTimestamp(endRaw),
      text,
      keywords: tokenizeMessage(text).slice(0, 32),
    });
  }
  return segments;
};

const splitHtmlIntoPages = (raw: string): string[] => {
  const sectionMatches = Array.from(raw.matchAll(/<(section|article)\b[^>]*>[\s\S]*?<\/\1>/gi)).map((match) => match[0]);
  if (sectionMatches.length > 1) return sectionMatches;

  const slideMatches = Array.from(
    raw.matchAll(/<div\b[^>]*(?:class=["'][^"']*slide[^"']*["']|data-slide(?:-number)?=["'][^"']+["'])[^>]*>[\s\S]*?<\/div>/gi),
  ).map((match) => match[0]);
  if (slideMatches.length > 1) return slideMatches;

  return [raw];
};

const parseHtmlSegments = (raw: string): PageIndexSegment[] =>
  splitHtmlIntoPages(raw)
    .map((pageHtml, index) => ({
      kind: "page" as const,
      page: index + 1,
      text: compactSnippet(stripHtml(pageHtml)),
    }))
    .filter((segment) => Boolean(segment.text))
    .map((segment) => ({
      ...segment,
      keywords: tokenizeMessage(segment.text).slice(0, 32),
    }));

const isDegenerateHtmlSegment = (segment: PageIndexSegment): boolean => {
  const text = collapseWhitespace(segment.text).toLowerCase();
  return /^slide\s+\d+$/.test(text) || /^page\s+\d+$/.test(text) || text.length <= 12;
};

const parseHtmlOrImageSegments = async (resource: CourseResourceRecord, raw: string): Promise<PageIndexSegment[]> => {
  const htmlSegments = parseHtmlSegments(raw);
  const imageUrls = normalizeImageUrls(resource.metaJson.imageUrls);
  const shouldPreferHtml =
    htmlSegments.length > 0 &&
    (!imageUrls.length || htmlSegments.some((segment) => !isDegenerateHtmlSegment(segment)));
  if (shouldPreferHtml) {
    return htmlSegments;
  }

  if (!imageUrls.length) {
    return [];
  }

  const ocrSegments = await buildImageUrlSegments(imageUrls);
  if (ocrSegments.length) {
    return ocrSegments;
  }

  return imageUrls
    .map((imageUrl, index) => ({
      kind: "page" as const,
      page: index + 1,
      text: compactSnippet(`Slide image ${index + 1}${parseSlideTimeSecFromUrl(imageUrl) !== null ? ` at ${parseSlideTimeSecFromUrl(imageUrl)}s` : ""}`),
    }))
    .map((segment) => ({
      ...segment,
      keywords: tokenizeMessage(segment.text).slice(0, 32),
    }));
};

const parseTextSegments = (raw: string): PageIndexSegment[] => {
  const pages = raw.split(/\f/).map((page) => compactSnippet(page)).filter(Boolean);
  const source = pages.length ? pages : [compactSnippet(raw)].filter(Boolean);
  return source.map((text, index) => ({
    kind: "page",
    page: index + 1,
    text,
    keywords: tokenizeMessage(text).slice(0, 32),
  }));
};

const extractPdfPages = async (filePath: string): Promise<string[]> => {
  const pythonScript = `
import json
import sys

pages = []
path = sys.argv[1]

try:
    from pypdf import PdfReader
    reader = PdfReader(path)
    pages = [(page.extract_text() or "").strip() for page in reader.pages]
except Exception:
    import fitz
    doc = fitz.open(path)
    pages = [page.get_text("text").strip() for page in doc]

print(json.dumps(pages, ensure_ascii=False))
`;

  const { stdout } = await execFileAsync("python", ["-c", pythonScript, filePath], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as string[];
  return parsed.map((page) => collapseWhitespace(page)).filter(Boolean);
};

const extractPptxSlides = async (filePath: string): Promise<string[]> => {
  const pythonScript = `
import json
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

path = sys.argv[1]
slides = []

def slide_sort_key(name):
    match = re.search(r"slide(\\d+)\\.xml$", name)
    return int(match.group(1)) if match else 0

with zipfile.ZipFile(path, "r") as archive:
    slide_names = sorted(
        [
            name
            for name in archive.namelist()
            if name.startswith("ppt/slides/slide") and name.endswith(".xml") and ".rels/" not in name
        ],
        key=slide_sort_key,
    )
    for slide_name in slide_names:
        try:
            raw = archive.read(slide_name)
            root = ET.fromstring(raw)
            texts = []
            for node in root.iter():
                if node.tag.endswith("}t") and node.text:
                    texts.append(node.text.strip())
            slides.append(" ".join([part for part in texts if part]).strip())
        except Exception:
            slides.append("")

print(json.dumps(slides, ensure_ascii=False))
`;

  const { stdout } = await execFileAsync("python", ["-c", pythonScript, filePath], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as string[];
  return parsed.map((slide) => collapseWhitespace(slide)).filter(Boolean);
};

const resolveLocalPath = (repo: EducationRepo, localPath: string | null): string | null => {
  if (!localPath?.trim()) return null;
  if (path.isAbsolute(localPath)) return localPath;
  return path.join(repo.runtimeRoot, localPath);
};

const updatedAtNow = (): string => new Date().toISOString();

export class ResourceIndexer {
  private readonly educationRepo: EducationRepo;

  constructor(educationRepo: EducationRepo) {
    this.educationRepo = educationRepo;
  }

  async readResourceIndex(resourceId: string): Promise<ResourceIndexRecord | null> {
    const indexPath = this.educationRepo.resourceIndexPath(resourceId);
    try {
      const raw = await readFile(indexPath, "utf8");
      return JSON.parse(raw) as ResourceIndexRecord;
    } catch {
      return null;
    }
  }

  async ensureIndexed(resource: CourseResourceRecord): Promise<ResourceIndexRecord | null> {
    await this.educationRepo.ensureScaffold();
    const resolvedPath = resolveLocalPath(this.educationRepo, resource.localPath);
    if (!resolvedPath) {
      return null;
    }

    try {
      await access(resolvedPath);
    } catch {
      return null;
    }

    const sourceFingerprint = await fileFingerprint(resolvedPath);
    const existing = await this.readResourceIndex(resource.id);
    if (existing?.sourceFingerprint === sourceFingerprint && existing.version === RESOURCE_INDEX_VERSION) {
      return existing;
    }

    const segments = await this.extractSegments(resource, resolvedPath);
    const record: ResourceIndexRecord = {
      resourceId: resource.id,
      courseId: resource.courseId,
      projectId: typeof resource.metaJson.projectId === "string" ? resource.metaJson.projectId : null,
      linkedItemId: resource.linkedItemId,
      resourceType: resource.resourceType,
      sourcePathOrUrl: resolvedPath || resource.url,
      sourceFingerprint,
      version: RESOURCE_INDEX_VERSION,
      updatedAt: updatedAtNow(),
      segments,
    };

    if (
      (resource.resourceType === "ppt" || resource.resourceType === "pptx") &&
      !Array.isArray(resource.metaJson.slideTimeline)
    ) {
      const imageUrls = normalizeImageUrls(resource.metaJson.imageUrls);
      if (imageUrls.length) {
        resource.metaJson.slideTimeline = imageUrls
          .map((imageUrl, index) => {
            const timeSec = parseSlideTimeSecFromUrl(imageUrl);
            if (timeSec === null) return null;
            return {
              page: index + 1,
              timeSec,
              timeText: `${Math.floor(timeSec / 60)}:${Math.floor(timeSec % 60)
                .toString()
                .padStart(2, "0")}`,
            };
          })
          .filter((entry): entry is { page: number; timeSec: number; timeText: string } => Boolean(entry));
      }
    }

    await writeFile(this.educationRepo.resourceIndexPath(resource.id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return record;
  }

  private async extractSegments(resource: CourseResourceRecord, filePath: string): Promise<ResourceIndexSegment[]> {
    const extension = path.extname(filePath).toLowerCase();
    if (resource.resourceType === "subtitle" || extension === ".srt") {
      return parseSrtSegments(await readFile(filePath, "utf8"));
    }

    if (resource.resourceType === "pdf" || extension === ".pdf") {
      const pages = await extractPdfPages(filePath);
      return pages.map((text, index) => ({
        kind: "page",
        page: index + 1,
        text: compactSnippet(text),
        keywords: tokenizeMessage(text).slice(0, 32),
      }));
    }

    if (resource.resourceType === "pptx" || extension === ".pptx") {
      const slides = await extractPptxSlides(filePath);
      return slides.map((text, index) => ({
        kind: "page",
        page: index + 1,
        text: compactSnippet(text),
        keywords: tokenizeMessage(text).slice(0, 32),
      }));
    }

    if (resource.resourceType === "notes" || extension === ".txt" || extension === ".md") {
      return parseTextSegments(await readFile(filePath, "utf8"));
    }

    if (resource.resourceType === "ppt" || resource.resourceType === "pptx" || extension === ".html" || extension === ".htm") {
      const raw = await readFile(filePath, "utf8");
      if (extension === ".html" || extension === ".htm" || raw.includes("<html")) {
        return parseHtmlOrImageSegments(resource, raw);
      }
      return parseTextSegments(raw);
    }

    return [];
  }
}
