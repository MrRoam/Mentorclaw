import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LearnerState } from "../src/schemas/models.ts";

const execFileAsync = promisify(execFile);

const learnerState: LearnerState = {
  version: 1,
  updated_at: null,
  language: "zh-CN",
  timezone: "Asia/Shanghai",
  active_plan_count: 0,
  active_plan_ids: [],
  current_focus: null,
  risk_flags: [],
  capability_signals: [],
};

export const createRuntimeFixture = async (): Promise<string> => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "mentorclaw-runtime-"));
  const workspaceRoot = path.join(runtimeRoot, "workspace");

  await mkdir(path.join(workspaceRoot, "agent", "learner"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "projects"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "crons"), { recursive: true });
  await mkdir(path.join(workspaceRoot, ".openclaw"), { recursive: true });

  await Promise.all([
    writeFile(path.join(workspaceRoot, "AGENTS.md"), "# AGENTS\n", "utf8"),
    writeFile(path.join(workspaceRoot, "SOUL.md"), "# SOUL\n", "utf8"),
    writeFile(path.join(workspaceRoot, "TOOLS.md"), "# TOOLS\n", "utf8"),
    writeFile(path.join(workspaceRoot, "MEMORY.md"), "# Durable Learner Memory\n\n- Learner prefers concise Chinese explanations.\n", "utf8"),
    writeFile(path.join(workspaceRoot, "agent", "learner", "PROFILE.md"), "# Profile\n", "utf8"),
    writeFile(path.join(workspaceRoot, "agent", "learner", "PREFERENCES.md"), "# Preferences\n", "utf8"),
    writeFile(path.join(workspaceRoot, "agent", "learner", "GLOBAL_GOALS.md"), "# Goals\n", "utf8"),
    writeFile(path.join(workspaceRoot, "agent", "learner", "GLOBAL_MISCONCEPTIONS.yaml"), "[]\n", "utf8"),
    writeFile(
      path.join(workspaceRoot, "agent", "learner", "LEARNER_STATE.yaml"),
      `version: 1
updated_at: null
language: zh-CN
timezone: Asia/Shanghai
active_plan_count: 0
active_plan_ids: []
current_focus: null
risk_flags: []
capability_signals: []
`,
      "utf8",
    ),
    writeFile(path.join(workspaceRoot, "agent", "learner", "EVENTS.jsonl"), "", "utf8"),
    writeFile(path.join(workspaceRoot, "projects", "README.md"), "# Projects\n", "utf8"),
    writeFile(path.join(workspaceRoot, "crons", "README.md"), "# Crons\n", "utf8"),
  ]);

  return runtimeRoot;
};

export { learnerState };

export const withTestServer = async <T>(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> => {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
};

export const createPdfFixture = async (runtimeRoot: string, fileName: string, pages: string[]): Promise<string> => {
  const filePath = path.join(runtimeRoot, fileName);
  const script = `
import fitz
import sys

target = sys.argv[1]
pages = sys.argv[2:]
doc = fitz.open()
for text in pages:
    page = doc.new_page()
    page.insert_text((72, 72), text)
doc.save(target)
`;

  await execFileAsync("python", ["-c", script, filePath, ...pages], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return filePath;
};

export const createPptxFixture = async (runtimeRoot: string, fileName: string, slides: string[]): Promise<string> => {
  const filePath = path.join(runtimeRoot, fileName);
  const script = `
import sys
import zipfile

target = sys.argv[1]
slides = sys.argv[2:]

content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  {slide_overrides}
</Types>
"""

rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>
"""

presentation = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    {slide_ids}
  </p:sldIdLst>
</p:presentation>
"""

presentation_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {slide_relationships}
</Relationships>
"""

slide_template = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:t>{text}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>
"""

def xml_escape(value):
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )

with zipfile.ZipFile(target, "w") as archive:
    slide_overrides = []
    slide_ids = []
    slide_relationships = []
    for index, text in enumerate(slides, start=1):
        slide_overrides.append(
            f'<Override PartName="/ppt/slides/slide{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        )
        slide_ids.append(f'<p:sldId id="{255 + index}" r:id="rId{index}"/>')
        slide_relationships.append(
            f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{index}.xml"/>'
        )
        archive.writestr(f"ppt/slides/slide{index}.xml", slide_template.format(text=xml_escape(text)))

    archive.writestr("[Content_Types].xml", content_types.format(slide_overrides="\\n  ".join(slide_overrides)))
    archive.writestr("_rels/.rels", rels)
    archive.writestr("ppt/presentation.xml", presentation.format(slide_ids="\\n    ".join(slide_ids)))
    archive.writestr("ppt/_rels/presentation.xml.rels", presentation_rels.format(slide_relationships="\\n  ".join(slide_relationships)))
`;

  await execFileAsync("python", ["-c", script, filePath, ...slides], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return filePath;
};

export const createImageFixture = async (runtimeRoot: string, fileName: string, text: string): Promise<string> => {
  const filePath = path.join(runtimeRoot, fileName);
  const script = `
import cv2
import numpy as np
import sys

target = sys.argv[1]
text = sys.argv[2]
image = np.full((900, 1800, 3), 255, dtype=np.uint8)
font = cv2.FONT_HERSHEY_SIMPLEX
y = 220
for line in text.split("\\n"):
    cv2.putText(image, line, (80, y), font, 2.6, (0, 0, 0), 5, cv2.LINE_AA)
    y += 140
cv2.imwrite(target, image)
`;

  await execFileAsync("python", ["-c", script, filePath, text], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return filePath;
};
