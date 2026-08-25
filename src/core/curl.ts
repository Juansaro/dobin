import type {
  AuthSpec,
  HttpMethod,
  HttpRequestRecord,
  KvRow,
} from "./types";
import { emptyAuth, emptyKv } from "./types";

function splitArgs(input: string): string[] {
  const normalized = input
    .replace(/\\\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === " ") {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

function headerRow(raw: string): KvRow {
  const idx = raw.indexOf(":");
  if (idx === -1) {
    return { ...emptyKv(), key: raw.trim(), value: "" };
  }
  return {
    ...emptyKv(),
    key: raw.slice(0, idx).trim(),
    value: raw.slice(idx + 1).trim(),
  };
}

export function parseCurl(input: string): Partial<HttpRequestRecord> | null {
  const trimmed = input.trim();
  if (!trimmed.toLowerCase().startsWith("curl")) return null;
  const args = splitArgs(trimmed).slice(1);
  let method: HttpMethod = "GET";
  let url = "";
  const headers: KvRow[] = [];
  let body = "";
  let auth: AuthSpec = emptyAuth();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = () => args[++i] ?? "";
    if (arg === "-X" || arg === "--request") {
      method = (next().toUpperCase() as HttpMethod) || "GET";
    } else if (arg === "-H" || arg === "--header") {
      headers.push(headerRow(next()));
    } else if (
      arg === "-d" ||
      arg === "--data" ||
      arg === "--data-raw" ||
      arg === "--data-binary" ||
      arg === "--data-ascii"
    ) {
      body = next();
      if (method === "GET") method = "POST";
    } else if (arg === "-u" || arg === "--user") {
      const cred = next();
      const [username, ...rest] = cred.split(":");
      auth = {
        ...emptyAuth(),
        type: "basic",
        username: username ?? "",
        password: rest.join(":"),
      };
    } else if (arg === "-A" || arg === "--user-agent") {
      headers.push({ ...emptyKv(), key: "User-Agent", value: next() });
    } else if (arg === "--url") {
      url = next();
    } else if (arg === "-I" || arg === "--head") {
      method = "HEAD";
    } else if (!arg.startsWith("-") && !url) {
      url = arg;
    }
  }

  const authHeader = headers.find(
    (h) => h.key.toLowerCase() === "authorization",
  );
  if (authHeader?.value.toLowerCase().startsWith("bearer ")) {
    auth = {
      ...emptyAuth(),
      type: "bearer",
      token: authHeader.value.slice(7).trim(),
    };
  }

  const contentType = headers.find(
    (h) => h.key.toLowerCase() === "content-type",
  )?.value;
  const bodyType =
    !body
      ? "none"
      : contentType?.includes("application/json") || body.trim().startsWith("{")
        ? "json"
        : contentType?.includes("application/x-www-form-urlencoded")
          ? "form"
          : "text";

  const form: KvRow[] =
    bodyType === "form"
      ? body.split("&").filter(Boolean).map((part) => {
          const [k, v] = part.split("=");
          return {
            ...emptyKv(),
            key: decodeURIComponent(k ?? ""),
            value: decodeURIComponent((v ?? "").replace(/\+/g, " ")),
          };
        })
      : [];

  return {
    method,
    url,
    headers,
    query: [],
    body: {
      type: bodyType,
      content: bodyType === "form" ? "" : body,
      form,
    },
    auth,
  };
}

export function toCurl(req: HttpRequestRecord): string {
  const parts = [`curl -X ${req.method}`];
  parts.push(`'${req.url}'`);
  for (const header of req.headers) {
    if (!header.enabled || !header.key.trim()) continue;
    parts.push(`-H '${header.key}: ${header.value}'`);
  }
  if (req.auth.type === "bearer" && req.auth.token) {
    const hasAuth = req.headers.some(
      (h) => h.enabled && h.key.toLowerCase() === "authorization",
    );
    if (!hasAuth) {
      parts.push(`-H 'Authorization: Bearer ${req.auth.token}'`);
    }
  }
  if (req.auth.type === "apikey" && (req.auth.token || req.auth.keyName)) {
    const name = req.auth.keyName || "X-Api-Key";
    if (req.auth.apiKeyIn === "query") {
      const sep = req.url.includes("?") ? "&" : "?";
      parts[1] = `'${req.url}${sep}${encodeURIComponent(name)}=${encodeURIComponent(req.auth.token)}'`;
    } else {
      parts.push(`-H '${name}: ${req.auth.token}'`);
    }
  }
  if (req.auth.type === "oauth2" && (req.auth.accessToken || req.auth.token)) {
    parts.push(
      `-H 'Authorization: Bearer ${req.auth.accessToken || req.auth.token}'`,
    );
  }
  if (req.body.type === "json" || req.body.type === "text") {
    if (req.body.content) {
      parts.push(`--data-raw '${req.body.content.replace(/'/g, `'\\''`)}'`);
    }
  }
  if (req.body.type === "form") {
    const encoded = req.body.form
      .filter((r) => r.enabled && r.key)
      .map(
        (r) =>
          `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`,
      )
      .join("&");
    if (encoded) parts.push(`--data '${encoded}'`);
  }
  return parts.join(" \\\n  ");
}
