import type { HttpRequestRecord } from "./types";

export type CodeTarget = "fetch" | "httpie" | "python" | "csharp";

export const CODE_TARGETS: { id: CodeTarget; label: string }[] = [
  { id: "fetch", label: "fetch" },
  { id: "httpie", label: "HTTPie" },
  { id: "python", label: "Python" },
  { id: "csharp", label: "C#" },
];

export function assembledRequest(req: HttpRequestRecord): {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
} {
  let url = req.url;
  const headers: [string, string][] = [];
  const has = (name: string) =>
    headers.some(([key]) => key.toLowerCase() === name.toLowerCase()) ||
    req.headers.some(
      (h) => h.enabled && h.key.toLowerCase() === name.toLowerCase(),
    );
  for (const header of req.headers) {
    if (header.enabled && header.key.trim()) {
      headers.push([header.key, header.value]);
    }
  }
  if (req.auth.type === "bearer" && req.auth.token && !has("authorization")) {
    headers.push(["Authorization", `Bearer ${req.auth.token}`]);
  }
  if (req.auth.type === "basic" && req.auth.username && !has("authorization")) {
    headers.push([
      "Authorization",
      `Basic ${btoa(`${req.auth.username}:${req.auth.password}`)}`,
    ]);
  }
  if (req.auth.type === "oauth2" && (req.auth.accessToken || req.auth.token) && !has("authorization")) {
    headers.push([
      "Authorization",
      `Bearer ${req.auth.accessToken || req.auth.token}`,
    ]);
  }
  if (req.auth.type === "apikey") {
    const name = req.auth.keyName || "X-Api-Key";
    if (req.auth.apiKeyIn === "query") {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}${encodeURIComponent(name)}=${encodeURIComponent(req.auth.token)}`;
    } else if (req.auth.token && !has(name)) {
      headers.push([name, req.auth.token]);
    }
  }
  let body: string | null = null;
  if (req.body.type === "json" || req.body.type === "text") {
    body = req.body.content || null;
    if (req.body.type === "json" && body && !has("content-type")) {
      headers.push(["Content-Type", "application/json"]);
    }
  }
  if (req.body.type === "form") {
    body = req.body.form
      .filter((row) => row.enabled && row.key)
      .map(
        (row) =>
          `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value)}`,
      )
      .join("&");
    if (body && !has("content-type")) {
      headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
    }
  }
  return { method: req.method, url, headers, body };
}

export function generateCode(req: HttpRequestRecord, target: CodeTarget): string {
  const snap = assembledRequest(req);
  switch (target) {
    case "fetch":
      return toFetch(snap);
    case "httpie":
      return toHttpie(snap);
    case "python":
      return toPython(snap);
    case "csharp":
      return toCsharp(snap);
  }
}

function toFetch(s: ReturnType<typeof assembledRequest>): string {
  const init: string[] = [`method: "${s.method}"`];
  if (s.headers.length) {
    const entries = s.headers
      .map(([k, v]) => `    "${escapeJs(k)}": "${escapeJs(v)}"`)
      .join(",\n");
    init.push(`headers: {\n${entries}\n  }`);
  }
  if (s.body) {
    init.push(`body: ${JSON.stringify(s.body)}`);
  }
  return `const response = await fetch(${JSON.stringify(s.url)}, {\n  ${init.join(",\n  ")}\n});\nconst data = await response.text();\nconsole.log(response.status, data);`;
}

function toHttpie(s: ReturnType<typeof assembledRequest>): string {
  const parts = ["http", s.method, s.url];
  for (const [key, value] of s.headers) {
    parts.push(`${key}:${JSON.stringify(value)}`);
  }
  if (s.body) {
    parts.push(`<<< ${JSON.stringify(s.body)}`);
  }
  return parts.join(" \\\n  ");
}

function toPython(s: ReturnType<typeof assembledRequest>): string {
  const headers = s.headers
    .map(([k, v]) => `    "${escapePy(k)}": "${escapePy(v)}"`)
    .join(",\n");
  const lines = [
    "import requests",
    "",
    `url = "${escapePy(s.url)}"`,
    s.headers.length ? `headers = {\n${headers}\n}` : "headers = {}",
  ];
  if (s.body) {
    lines.push(`body = ${JSON.stringify(s.body)}`);
    lines.push(
      `response = requests.request("${s.method}", url, headers=headers, data=body)`,
    );
  } else {
    lines.push(
      `response = requests.request("${s.method}", url, headers=headers)`,
    );
  }
  lines.push("print(response.status_code)");
  lines.push("print(response.text)");
  return lines.join("\n");
}

function toCsharp(s: ReturnType<typeof assembledRequest>): string {
  const headerLines = s.headers
    .filter(([k]) => k.toLowerCase() !== "content-type")
    .map(
      ([k, v]) =>
        `client.DefaultRequestHeaders.TryAddWithoutValidation("${escapeCs(k)}", "${escapeCs(v)}");`,
    )
    .join("\n");
  const contentType =
    s.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ??
    "text/plain";
  const bodyBlock = s.body
    ? `var content = new StringContent(${JSON.stringify(s.body)}, System.Text.Encoding.UTF8, "${escapeCs(contentType)}");
var response = await client.SendAsync(new HttpRequestMessage(HttpMethod.${methodPascal(s.method)}, "${escapeCs(s.url)}") { Content = content });`
    : `var response = await client.SendAsync(new HttpRequestMessage(HttpMethod.${methodPascal(s.method)}, "${escapeCs(s.url)}"));`;
  return `using var client = new HttpClient();
${headerLines}
${bodyBlock}
var body = await response.Content.ReadAsStringAsync();
Console.WriteLine((int)response.StatusCode);
Console.WriteLine(body);`;
}

function methodPascal(method: string): string {
  const known: Record<string, string> = {
    GET: "Get",
    POST: "Post",
    PUT: "Put",
    DELETE: "Delete",
    PATCH: "Patch",
    HEAD: "Head",
    OPTIONS: "Options",
  };
  return known[method.toUpperCase()] ?? "Get";
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapePy(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeCs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
