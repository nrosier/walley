/**
 * Parser for the test env file (.env.test), which uses `KEY: value` lines, not `KEY=value`.
 * Pure. It never logs and the values never leave the returned map.
 */
export function parseEnvFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/u.exec(line);
    const key = match?.[1];
    const raw = match?.[2];
    if (key === undefined || raw === undefined) continue;
    let value = raw.trim();
    const first = value.charAt(0);
    if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

/** Names (not values) of the keys that are missing or empty. */
export function missingKeys(env: ReadonlyMap<string, string>, required: readonly string[]): string[] {
  return required.filter((key) => (env.get(key) ?? '') === '');
}
