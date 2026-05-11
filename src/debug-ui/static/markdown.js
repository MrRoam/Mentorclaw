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

function isBlank(line) {
  return !line.trim();
}

function isFenceStart(line) {
  return /^```/.test(line.trim());
}

function isHeading(line) {
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
  const header = lines[index];
  const separator = lines[index + 1];
  if (!header.includes("|")) return false;
  return isTableSeparator(separator);
}

function parseTable(lines, startIndex) {
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
    if (isBlank(current) || !current.includes("|")) break;
    rows.push(splitTableRow(current));
    index += 1;
  }

  const headerHtml = headerCells
    .map((cell, cellIndex) => {
      const align = alignments[cellIndex] ? ` style="text-align:${alignments[cellIndex]};"` : "";
      return `<th${align}>${renderInline(cell)}</th>`;
    })
    .join("");

  const bodyHtml = rows
    .map((row) => {
      const cells = headerCells.map((_, cellIndex) => {
        const align = alignments[cellIndex] ? ` style="text-align:${alignments[cellIndex]};"` : "";
        return `<td${align}>${renderInline(row[cellIndex] ?? "")}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return {
    html: `<table><thead><tr>${headerHtml}</tr></thead>${bodyHtml ? `<tbody>${bodyHtml}</tbody>` : ""}</table>`,
    nextIndex: index,
  };
}

function parseList(lines, startIndex) {
  const ordered = /^\s*\d+\.\s+/.test(lines[startIndex]);
  const tag = ordered ? "ol" : "ul";
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const current = lines[index];
    if (!isListItem(current)) break;
    const match = current.match(/^ {0,3}(?:[-+*]|\d+\.)\s+(.*)$/);
    if (!match) break;
    items.push(`<li>${renderInline(match[1])}</li>`);
    index += 1;
  }

  return {
    html: `<${tag}>${items.join("")}</${tag}>`,
    nextIndex: index,
  };
}

function parseFence(lines, startIndex) {
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

function parseParagraph(lines, startIndex) {
  const body = [];
  let index = startIndex;

  while (index < lines.length) {
    const current = lines[index];
    if (isBlank(current)) break;
    if (isFenceStart(current) || isHeading(current) || isHorizontalRule(current) || isListItem(current) || isBlockquote(current) || isTableStart(lines, index)) {
      break;
    }
    body.push(current.trimEnd());
    index += 1;
  }

  return {
    html: `<p>${renderInline(body.join("\n"))}</p>`,
    nextIndex: index,
  };
}

function stash(html, stashed) {
  const token = `\u0000${stashed.length}\u0000`;
  stashed.push(html);
  return token;
}

function unstash(text, stashed) {
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => stashed[Number(index)] ?? "");
}

function replacePattern(text, pattern, replacer) {
  let current = text;
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current.replace(pattern, replacer);
  }
  return current;
}

function renderInline(value) {
  const stashed = [];
  let html = String(value ?? "");

  html = html.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`, stashed));

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+(?:\?[^)\s]*)?(?:#[^)\s]*)?)\)/g, (_, label, href) => {
    const safe = safeHref(href);
    if (!safe) return escapeHtml(`[${label}](${href})`);
    return stash(`<a href="${escapeAttribute(safe)}" target="_blank" rel="noreferrer">${renderInline(label)}</a>`, stashed);
  });

  html = escapeHtml(html);
  html = replacePattern(html, /\*\*([^*][\s\S]*?)\*\*/g, (_, inner) => `<strong>${inner}</strong>`);
  html = replacePattern(html, /__([^_][\s\S]*?)__/g, (_, inner) => `<strong>${inner}</strong>`);
  html = replacePattern(html, /~~([^~][\s\S]*?)~~/g, (_, inner) => `<del>${inner}</del>`);
  html = replacePattern(html, /(^|[^\w])\*([^*\n]+)\*(?!\*)/g, (_, prefix, inner) => `${prefix}<em>${inner}</em>`);
  html = replacePattern(html, /(^|[^\w])_([^_\n]+)_(?!_)/g, (_, prefix, inner) => `${prefix}<em>${inner}</em>`);

  html = html.replace(/\n/g, "<br />");
  return unstash(html, stashed);
}

export function renderMarkdown(markdown) {
  const normalized = normalizeMarkdown(markdown).trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const blocks = [];

  for (let index = 0; index < lines.length;) {
    const current = lines[index];

    if (isBlank(current)) {
      index += 1;
      continue;
    }

    if (isFenceStart(current)) {
      const parsed = parseFence(lines, index);
      blocks.push(parsed.html);
      index = parsed.nextIndex;
      continue;
    }

    if (isHeading(current)) {
      const match = current.trim().match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        blocks.push(`<h${level}>${renderInline(match[2])}</h${level}>`);
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
      const parsed = parseTable(lines, index);
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
      const parsed = parseList(lines, index);
      blocks.push(parsed.html);
      index = parsed.nextIndex;
      continue;
    }

    const parsed = parseParagraph(lines, index);
    blocks.push(parsed.html);
    index = parsed.nextIndex;
  }

  return blocks.join("");
}
