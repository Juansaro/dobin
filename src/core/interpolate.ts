export function interpolate(
  text: string,
  vars: Record<string, string>,
): string {
  return text.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, raw: string) => {
    const key = raw.trim();
    const dyn = dynamicValue(key);
    if (dyn != null) return dyn;
    return Object.prototype.hasOwnProperty.call(vars, key)
      ? vars[key]
      : `{{${key}}}`;
  });
}

function dynamicValue(key: string): string | undefined {
  switch (key) {
    case "$timestamp":
      return String(Math.floor(Date.now() / 1000));
    case "$isoTimestamp":
      return new Date().toISOString();
    case "$guid":
      return crypto.randomUUID();
    case "$nonce": {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    case "$randomInt":
      return String(Math.floor(Math.random() * 1_000_000));
    default:
      return undefined;
  }
}

type VarRow = {
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
};

export function mergeKvLayers(
  layers: VarRow[][],
  secrets: { name: string; value: string }[] = [],
): Record<string, string> {
  const vault = Object.fromEntries(secrets.map((s) => [s.name, s.value]));
  const out: Record<string, string> = {};
  for (const rows of layers) {
    for (const row of rows) {
      if (!row.enabled || !row.key.trim()) continue;
      const key = row.key.trim();
      out[key] = row.secret ? (vault[key] ?? row.value) : row.value;
    }
  }
  for (const [name, value] of Object.entries(vault)) {
    if (!(name in out)) out[name] = value;
  }
  return out;
}

export function resolveVars(opts: {
  global?: VarRow[];
  collection?: VarRow[];
  environment?: VarRow[];
  secrets?: { name: string; value: string }[];
}): Record<string, string> {
  return mergeKvLayers(
    [opts.global ?? [], opts.collection ?? [], opts.environment ?? []],
    opts.secrets ?? [],
  );
}

export function envVars(
  variables: VarRow[],
  secrets: { name: string; value: string }[] = [],
): Record<string, string> {
  return resolveVars({ environment: variables, secrets });
}
