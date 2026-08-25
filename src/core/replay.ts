import type { BodyType, HttpMethod, HttpRequestRecord, KvRow, WebhookEvent } from "./types";
import { METHODS, emptyAuth, emptyBody } from "./types";

const HOP_BY_HOP = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "cf-ray",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-visitor",
  "cdn-loop",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
]);

export function replayUrl(path: string, query: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const q = query.trim();
  return q ? `{{baseUrl}}${cleanPath}?${q}` : `{{baseUrl}}${cleanPath}`;
}

export function replayHeaders(headers: [string, string][]): KvRow[] {
  return headers
    .filter(([key]) => !HOP_BY_HOP.has(key.toLowerCase()))
    .map(([key, value]) => ({
      id: crypto.randomUUID(),
      key,
      value,
      enabled: true,
      secret: false,
    }));
}

export function replayMethod(method: string): HttpMethod {
  const upper = method.toUpperCase();
  return (METHODS as string[]).includes(upper) ? (upper as HttpMethod) : "POST";
}

export function replayBodyType(body: string, headers: [string, string][]): BodyType {
  if (!body.trim()) return "none";
  const ct =
    headers.find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "";
  if (ct.includes("application/json") || looksJson(body)) return "json";
  if (ct.includes("application/x-www-form-urlencoded")) return "form";
  return "text";
}

function looksJson(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function requestFromWebhook(
  event: WebhookEvent,
  workspaceId: string,
  collectionId: string,
  url = replayUrl(event.path, event.query),
): HttpRequestRecord {
  const type = replayBodyType(event.body, event.headers);
  return {
    id: crypto.randomUUID(),
    workspaceId,
    collectionId,
    folderId: null,
    name: `${event.method} ${event.path}`,
    method: replayMethod(event.method),
    url,
    headers: replayHeaders(event.headers),
    query: [],
    body:
      type === "none"
        ? emptyBody()
        : {
            type,
            content: event.body,
            form: [],
          },
    auth: emptyAuth(),
    preRequest: [],
    tests: [],
    sortOrder: Date.now(),
    updatedAt: new Date().toISOString(),
  };
}
