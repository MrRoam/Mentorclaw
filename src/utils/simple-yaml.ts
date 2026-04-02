const parseScalar = (raw: string): unknown => {
  const value = raw.trim();
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value.replace(/^"|"$/g, "");
};

export const parseStructured = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.every((line) => line.trim().startsWith("- "))) {
    return lines.map((line) => parseScalar(line.trim().slice(2)));
  }

  const record: Record<string, unknown> = {};
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    record[key.trim()] = parseScalar(value);
  }
  return record;
};

export const stringifyStructured = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
