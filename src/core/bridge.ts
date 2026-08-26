import { invoke } from "@tauri-apps/api/core";
import type {
  Collection,
  CookieRecord,
  Environment,
  Folder,
  GitSyncResult,
  HistoryEntry,
  HttpRequestRecord,
  HttpSendPayload,
  HttpSendResult,
  ResponseSnapshot,
  Secret,
  AppSettings,
  WebhookEvent,
  WebhookStatus,
  Workspace,
} from "./types";
import { emptyAuth, emptyTimings, PERSONAL_WORKSPACE_ID } from "./types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type Memory = {
  workspace: Workspace;
  collections: Collection[];
  folders: Folder[];
  requests: HttpRequestRecord[];
  environments: Environment[];
  secrets: Secret[];
  cookies: CookieRecord[];
  history: HistoryEntry[];
  webhooks: WebhookEvent[];
  webhookStatus: WebhookStatus;
};

function seedMemory(): Memory {
  const ts = new Date().toISOString();
  const collectionId = crypto.randomUUID();
  const envId = crypto.randomUUID();
  return {
    workspace: {
      id: PERSONAL_WORKSPACE_ID,
      name: "Personal",
      kind: "personal",
      updatedAt: ts,
      variables: [],
    },
    collections: [
      {
        id: collectionId,
        workspaceId: PERSONAL_WORKSPACE_ID,
        name: "Ejemplos",
        updatedAt: ts,
        variables: [],
      },
    ],
    folders: [],
    requests: [
      {
        id: crypto.randomUUID(),
        workspaceId: PERSONAL_WORKSPACE_ID,
        collectionId,
        folderId: null,
        name: "Listar todo",
        method: "GET",
        url: "{{baseUrl}}/todos/1",
        headers: [],
        query: [],
        body: { type: "none", content: "", form: [] },
        auth: emptyAuth(),
        preRequest: [],
        tests: [],
        sortOrder: 0,
        updatedAt: ts,
      },
      {
        id: crypto.randomUUID(),
        workspaceId: PERSONAL_WORKSPACE_ID,
        collectionId,
        folderId: null,
        name: "Crear post",
        method: "POST",
        url: "{{baseUrl}}/posts",
        headers: [
          {
            id: crypto.randomUUID(),
            key: "Content-Type",
            value: "application/json",
            enabled: true,
          },
        ],
        query: [],
        body: {
          type: "json",
          content:
            '{\n  "title": "openDobin",\n  "body": "Hola desde el cliente HTTP",\n  "userId": 1\n}',
          form: [],
        },
        auth: emptyAuth(),
        preRequest: [],
        tests: [],
        sortOrder: 1,
        updatedAt: ts,
      },
    ],
    environments: [
      {
        id: envId,
        workspaceId: PERSONAL_WORKSPACE_ID,
        name: "Dev",
        variables: [
          {
            id: crypto.randomUUID(),
            key: "baseUrl",
            value: "https://jsonplaceholder.typicode.com",
            enabled: true,
          },
        ],
        isActive: true,
        updatedAt: ts,
      },
    ],
    secrets: [],
    cookies: [],
    history: [],
    webhooks: [],
    webhookStatus: { running: false, port: 0, url: "", publicUrl: "", tunnelRunning: false, tunnelError: "" },
  };
}

const memory = seedMemory();
let memoryPlan: AppSettings["plan"] = "local";
let memoryGitFolder = "";
const memorySnapshots = new Map<string, ResponseSnapshot>();

async function memoryInvoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  switch (cmd) {
    case "workspace_get":
      return memory.workspace as T;
    case "workspace_save": {
      memory.workspace = args.workspace as Workspace;
      return undefined as T;
    }
    case "collection_list":
      return memory.collections as T;
    case "collection_save": {
      const collection = args.collection as Collection;
      const idx = memory.collections.findIndex((c) => c.id === collection.id);
      if (idx >= 0) memory.collections[idx] = collection;
      else memory.collections.push(collection);
      return undefined as T;
    }
    case "collection_delete": {
      const id = args.id as string;
      memory.collections = memory.collections.filter((c) => c.id !== id);
      memory.requests = memory.requests.filter((r) => r.collectionId !== id);
      memory.folders = memory.folders.filter((f) => f.collectionId !== id);
      return undefined as T;
    }
    case "folder_list":
      return memory.folders as T;
    case "folder_save": {
      const folder = args.folder as Folder;
      const idx = memory.folders.findIndex((f) => f.id === folder.id);
      if (idx >= 0) memory.folders[idx] = folder;
      else memory.folders.push(folder);
      return undefined as T;
    }
    case "folder_delete": {
      const id = args.id as string;
      const folder = memory.folders.find((f) => f.id === id);
      const parent = folder?.parentId ?? null;
      memory.requests = memory.requests.map((r) =>
        r.folderId === id ? { ...r, folderId: parent } : r,
      );
      memory.folders = memory.folders
        .map((f) => (f.parentId === id ? { ...f, parentId: parent } : f))
        .filter((f) => f.id !== id);
      return undefined as T;
    }
    case "request_list":
      return memory.requests as T;
    case "request_get":
      return memory.requests.find((r) => r.id === args.id) as T;
    case "request_save": {
      const request = args.request as HttpRequestRecord;
      const idx = memory.requests.findIndex((r) => r.id === request.id);
      if (idx >= 0) memory.requests[idx] = request;
      else memory.requests.push(request);
      return undefined as T;
    }
    case "request_delete": {
      memory.requests = memory.requests.filter((r) => r.id !== args.id);
      return undefined as T;
    }
    case "environment_list":
      return memory.environments as T;
    case "environment_save": {
      const environment = args.environment as Environment;
      const idx = memory.environments.findIndex((e) => e.id === environment.id);
      if (idx >= 0) memory.environments[idx] = environment;
      else memory.environments.push(environment);
      return undefined as T;
    }
    case "environment_delete": {
      memory.environments = memory.environments.filter((e) => e.id !== args.id);
      return undefined as T;
    }
    case "environment_set_active": {
      memory.environments = memory.environments.map((e) => ({
        ...e,
        isActive: e.id === args.id,
      }));
      return undefined as T;
    }
    case "secret_list":
      return memory.secrets as T;
    case "secret_set": {
      const secret = args.secret as Secret;
      const idx = memory.secrets.findIndex((s) => s.name === secret.name);
      if (idx >= 0) memory.secrets[idx] = { ...secret, id: memory.secrets[idx].id };
      else memory.secrets.push(secret);
      return undefined as T;
    }
    case "secret_delete": {
      memory.secrets = memory.secrets.filter((s) => s.name !== args.name);
      return undefined as T;
    }
    case "cookie_list":
      return memory.cookies as T;
    case "cookie_upsert": {
      const cookie = args.cookie as CookieRecord;
      const idx = memory.cookies.findIndex(
        (c) =>
          c.domain === cookie.domain &&
          c.path === cookie.path &&
          c.name === cookie.name,
      );
      if (idx >= 0) memory.cookies[idx] = { ...cookie, id: memory.cookies[idx].id };
      else memory.cookies.push(cookie);
      return undefined as T;
    }
    case "cookie_delete": {
      memory.cookies = memory.cookies.filter((c) => c.id !== args.id);
      return undefined as T;
    }
    case "cookie_clear":
      memory.cookies = [];
      return undefined as T;
    case "history_list":
      return memory.history as T;
    case "history_clear":
      memory.history = [];
      return undefined as T;
    case "http_send":
      return browserSend(args.payload as HttpSendPayload) as T;
    case "http_cancel": {
      const id = String(args.id ?? "");
      cancelledSends.add(id);
      browserCancels.get(id)?.abort();
      return undefined as T;
    }
    case "oauth_authorize":
    case "oauth_client_credentials":
      throw new Error("OAuth solo está disponible en la app de escritorio.");
    case "webhook_status":
      return memory.webhookStatus as T;
    case "webhook_start":
      throw new Error(
        "El inbox de webhooks solo está disponible en la app de escritorio.",
      );
    case "webhook_stop":
      memory.webhookStatus = {
        running: false,
        port: 0,
        url: "",
        publicUrl: "",
        tunnelRunning: false,
        tunnelError: "",
      };
      return memory.webhookStatus as T;
    case "webhook_tunnel_start":
      throw new Error("El túnel público solo está disponible en la app de escritorio.");
    case "webhook_tunnel_stop":
      memory.webhookStatus = {
        ...memory.webhookStatus,
        publicUrl: "",
        tunnelRunning: false,
        tunnelError: "",
      };
      return memory.webhookStatus as T;
    case "webhook_events":
      return memory.webhooks as T;
    case "webhook_clear":
      memory.webhooks = [];
      return undefined as T;
    case "settings_get":
      return { plan: memoryPlan, gitFolder: memoryGitFolder } as T;
    case "settings_save": {
      const settings = args.settings as AppSettings;
      memoryPlan = settings.plan === "pro" ? "pro" : "local";
      memoryGitFolder = settings.gitFolder ?? memoryGitFolder;
      return { plan: memoryPlan, gitFolder: memoryGitFolder } as T;
    }
    case "snapshot_get":
      return (memorySnapshots.get(args.id as string) ?? null) as T;
    case "snapshot_put": {
      const snap = args.snapshot as ResponseSnapshot;
      memorySnapshots.set(snap.requestId, snap);
      return undefined as T;
    }
    case "git_folder_pick":
      return null as T;
    case "git_folder_link":
      throw new Error("La carpeta Git solo se vincula en la app de escritorio.");
    case "git_folder_unlink":
      memoryGitFolder = "";
      return { plan: memoryPlan, gitFolder: "" } as T;
    case "git_sync_now":
    case "git_sync_poll":
      return {
        folder: memoryGitFolder,
        imported: false,
        exported: false,
        changed: false,
        message: "",
      } as GitSyncResult as T;
    default:
      throw new Error(`Comando no soportado en preview: ${cmd}`);
  }
}

function cookieHeaderFor(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || "/";
  const secure = parsed.protocol === "https:";
  const pairs = memory.cookies
    .filter((cookie) => {
      if (cookie.secure && !secure) return false;
      const domain = cookie.domain.replace(/^\./, "").toLowerCase();
      if (!(host === domain || host.endsWith(`.${domain}`))) return false;
      if (cookie.path !== "/" && !path.startsWith(cookie.path)) return false;
      return true;
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`);
  return pairs.length ? pairs.join("; ") : null;
}

function storeSetCookies(url: string, headers: [string, string][]) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  for (const [name, value] of headers) {
    if (name.toLowerCase() !== "set-cookie") continue;
    const nv = value.split(";")[0] ?? "";
    const eq = nv.indexOf("=");
    if (eq <= 0) continue;
    const cookie: CookieRecord = {
      id: crypto.randomUUID(),
      workspaceId: PERSONAL_WORKSPACE_ID,
      domain: parsed.hostname,
      path: "/",
      name: nv.slice(0, eq).trim(),
      value: nv.slice(eq + 1).trim(),
      expiresAt: null,
      secure: /;\s*secure/i.test(value),
      httpOnly: /;\s*httponly/i.test(value),
    };
    const idx = memory.cookies.findIndex(
      (c) =>
        c.domain === cookie.domain &&
        c.path === cookie.path &&
        c.name === cookie.name,
    );
    if (idx >= 0) memory.cookies[idx] = { ...cookie, id: memory.cookies[idx].id };
    else memory.cookies.push(cookie);
  }
}

const browserCancels = new Map<string, AbortController>();
const cancelledSends = new Set<string>();

async function browserSend(payload: HttpSendPayload): Promise<HttpSendResult> {
  const started = performance.now();
  let url = payload.url;
  const headers = new Headers();
  for (const [key, value] of payload.headers) {
    if (key.trim()) headers.set(key, value);
  }
  const cookie = cookieHeaderFor(url);
  if (cookie && !headers.has("Cookie")) headers.set("Cookie", cookie);
  const auth = { ...emptyAuth(), ...payload.auth };
  if (auth.type === "bearer" && auth.token) {
    headers.set("Authorization", `Bearer ${auth.token}`);
  }
  if (auth.type === "basic" && auth.username) {
    headers.set(
      "Authorization",
      `Basic ${btoa(`${auth.username}:${auth.password}`)}`,
    );
  }
  if (auth.type === "apikey") {
    const name = auth.keyName || "X-Api-Key";
    const value = auth.token || auth.password;
    if (auth.apiKeyIn === "query") {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    } else if (value) {
      headers.set(name, value);
    }
  }
  if (auth.type === "oauth2") {
    const token = auth.accessToken || auth.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const controller = new AbortController();
  browserCancels.set(payload.id, controller);
  const timer = window.setTimeout(() => controller.abort(), payload.timeoutMs);
  try {
    const res = await fetch(url, {
      method: payload.method,
      headers,
      body: payload.body,
      redirect: payload.followRedirects ? "follow" : "manual",
      signal: controller.signal,
    });
    const body = await res.text();
    const durationMs = Math.round(performance.now() - started);
    const resultHeaders = [...res.headers.entries()] as [string, string][];
    storeSetCookies(url, resultHeaders);
    memory.history.unshift({
      id: crypto.randomUUID(),
      workspaceId: payload.workspaceId,
      requestId: payload.requestId ?? null,
      method: payload.method,
      url: payload.url,
      status: res.status,
      durationMs,
      at: new Date().toISOString(),
    });
    memory.history = memory.history.slice(0, 200);
    return {
      ok: true,
      cancelled: false,
      error: null,
      status: res.status,
      statusText: res.statusText,
      headers: resultHeaders,
      body,
      truncated: false,
      durationMs,
      contentType: res.headers.get("content-type"),
      bodyEncoding: "utf8",
      timings: { ...emptyTimings(durationMs), totalMs: durationMs },
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const cancelled = cancelledSends.has(payload.id);
    return {
      ok: false,
      cancelled,
      error: cancelled
        ? "Cancelado"
        : error instanceof Error
          ? error.message
          : String(error),
      status: null,
      statusText: null,
      headers: [],
      body: "",
      truncated: false,
      durationMs,
      contentType: null,
      bodyEncoding: "utf8",
      timings: emptyTimings(durationMs),
    };
  } finally {
    window.clearTimeout(timer);
    browserCancels.delete(payload.id);
    cancelledSends.delete(payload.id);
  }
}

export async function api<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isTauri()) {
    return invoke<T>(cmd, args);
  }
  return memoryInvoke<T>(cmd, args ?? {});
}
