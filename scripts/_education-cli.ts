export interface ParsedCliArgs {
  values: Record<string, string[]>;
  positionals: string[];
}

export const parseCliArgs = (argv: string[]): ParsedCliArgs => {
  const values: Record<string, string[]> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const keyValue = token.slice(2);
    const separator = keyValue.indexOf("=");
    const key = separator >= 0 ? keyValue.slice(0, separator) : keyValue;
    const inlineValue = separator >= 0 ? keyValue.slice(separator + 1) : null;
    const nextToken = separator >= 0 ? null : argv[index + 1];
    const value = inlineValue ?? (nextToken && !nextToken.startsWith("--") ? nextToken : "true");
    if (inlineValue == null && nextToken && !nextToken.startsWith("--")) {
      index += 1;
    }
    values[key] = [...(values[key] ?? []), value];
  }

  return { values, positionals };
};

export const firstArg = (parsed: ParsedCliArgs, key: string): string | null => parsed.values[key]?.[0] ?? null;

export const manyArgs = (parsed: ParsedCliArgs, key: string): string[] => parsed.values[key] ?? [];
