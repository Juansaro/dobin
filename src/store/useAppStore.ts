import { create } from "zustand";
import { api, isTauri } from "@/core/bridge";
import { interpolate, resolveVars } from "@/core/interpolate";
import { runAssertions } from "@/core/assertions";
import type {
  AssertionResult,
  Collection,
  CookieRecord,
  Environment,
  EnvCompareResult,
  Folder,
  GitSyncResult,
  HistoryEntry,
  HttpRequestRecord,
  HttpSendResult,
  KvRow,
  OauthTokens,
  ResponseSnapshot,
  Secret,
  AppSettings,
  View,
  WebhookEvent,
  WebhookStatus,
  Workspace,
} from "@/core/types";
import {
  createFolder as makeFolder,
  createRequest,
  emptyAuth,
  hydrateRequest,
  METHODS,
  PERSONAL_WORKSPACE_ID,
  type HttpMethod,
} from "@/core/types";
import { toast } from "sonner";
import { entitlementsFor, normalizePlan, Features, type PlanId } from "@/core/entitlements";
import { requestFromWebhook } from "@/core/replay";
import {
  buildImportedFolders,
  collectionFileName,
  downloadJson,
  serializeCollection,
  toSavedEnvironment,
  toSavedRequest,
  uniqueCollectionName,
} from "@/core/collection-io";
import { parseImportedCollection } from "@/core/parse-collection";

interface AppState {
  ready: boolean;
  error: string | null;
  view: View;
  sidebarCollapsed: boolean;
  workspace: Workspace | null;
  collections: Collection[];
  folders: Folder[];
  requests: HttpRequestRecord[];
  environments: Environment[];
  secrets: Secret[];
  cookies: CookieRecord[];
  history: HistoryEntry[];
  webhookEvents: WebhookEvent[];
  webhookStatus: WebhookStatus;
  plan: PlanId;
  gitFolder: string;
  lastSnapshot: ResponseSnapshot | null;
  compare: EnvCompareResult | null;
  activeRequestId: string | null;
  draft: HttpRequestRecord | null;
  dirty: boolean;
  sending: boolean;
  sendKind: "idle" | "single" | "compare";
  sendId: string | null;
  response: HttpSendResult | null;
  assertionResults: AssertionResult[];
  timeoutMs: number;
  followRedirects: boolean;
  acceptInvalidCerts: boolean;
  bootstrap: () => Promise<void>;
  setView: (view: View) => void;
  toggleSidebar: () => void;
  selectRequest: (id: string) => void;
  patchDraft: (patch: Partial<HttpRequestRecord>) => void;
  saveDraft: () => Promise<void>;
  createCollection: (name: string) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  saveCollectionVariables: (id: string, variables: KvRow[]) => Promise<void>;
  saveWorkspaceVariables: (variables: KvRow[]) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  createRequest: (collectionId: string, folderId?: string | null) => Promise<void>;
  createFolder: (collectionId: string, parentId?: string | null, name?: string) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  saveSecret: (secret: Secret) => Promise<void>;
  deleteSecret: (name: string) => Promise<void>;
  loadCookies: () => Promise<void>;
  upsertCookie: (cookie: CookieRecord) => Promise<void>;
  deleteCookie: (id: string) => Promise<void>;
  clearCookies: () => Promise<void>;
  obtainToken: () => Promise<void>;
  duplicateRequest: () => Promise<void>;
  deleteRequest: (id: string) => Promise<void>;
  saveEnvironment: (env: Environment) => Promise<void>;
  deleteEnvironment: (id: string) => Promise<void>;
  setActiveEnvironment: (id: string) => Promise<void>;
  send: () => Promise<void>;
  cancel: () => Promise<void>;
  applyImported: (patch: Partial<HttpRequestRecord>) => void;
  loadHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
  replayHistory: (entry: HistoryEntry) => void;
  startWebhook: (port: number) => Promise<void>;
  stopWebhook: () => Promise<void>;
  startTunnel: () => Promise<void>;
  stopTunnel: () => Promise<void>;
  loadWebhooks: () => Promise<void>;
  clearWebhooks: () => Promise<void>;
  prependWebhook: (event: WebhookEvent) => void;
  replayWebhook: (
    event: WebhookEvent,
    opts: { collectionId: string; url: string; createNew: boolean; sendNow: boolean },
  ) => Promise<void>;
  setPlan: (plan: PlanId) => Promise<void>;
  linkGitFolder: () => Promise<GitSyncResult>;
  unlinkGitFolder: () => Promise<void>;
  syncGitNow: () => Promise<GitSyncResult>;
  pollGit: () => Promise<void>;
  compareEnvironments: (envAId: string, envBId: string) => Promise<void>;
  clearCompare: () => void;
  exportCollection: (id: string) => void;
  importCollectionJson: (text: string) => Promise<string>;
}

function hydrateVars(rows: KvRow[] | undefined, secrets: Secret[]): KvRow[] {
  const vault = Object.fromEntries(secrets.map((s) => [s.name, s.value]));
  return (rows ?? []).map((row) =>
    row.secret && vault[row.key] != null ? { ...row, value: vault[row.key] } : row,
  );
}

function persistVars(rows: KvRow[]): KvRow[] {
  return rows.map((row) => (row.secret ? { ...row, value: "" } : row));
}

function hydrateEnvs(environments: Environment[], secrets: Secret[]): Environment[] {
  return environments.map((env) => ({
    ...env,
    variables: hydrateVars(env.variables, secrets),
  }));
}

function persistEnv(env: Environment): Environment {
  return { ...env, variables: persistVars(env.variables) };
}

function hydrateWorkspace(workspace: Workspace, secrets: Secret[]): Workspace {
  return { ...workspace, variables: hydrateVars(workspace.variables, secrets) };
}

function hydrateCollections(collections: Collection[], secrets: Secret[]): Collection[] {
  return collections.map((collection) => ({
    ...collection,
    variables: hydrateVars(collection.variables, secrets),
  }));
}

async function persistSecretRows(rows: KvRow[]) {
  for (const row of rows) {
    if (row.secret && row.key.trim()) {
      await api("secret_set", {
        secret: {
          id: crypto.randomUUID(),
          workspaceId: PERSONAL_WORKSPACE_ID,
          name: row.key.trim(),
          value: row.value,
          updatedAt: new Date().toISOString(),
        },
      });
    }
  }
}

function upsertVar<T extends { variables: KvRow[]; updatedAt?: string }>(
  obj: T,
  key: string,
  value: string,
): T {
  const rows = [...(obj.variables ?? [])];
  const idx = rows.findIndex((row) => row.key === key);
  if (idx >= 0) {
    rows[idx] = { ...rows[idx], value, enabled: true };
  } else {
    rows.push({
      id: crypto.randomUUID(),
      key,
      value,
      enabled: true,
      secret: false,
    });
  }
  return { ...obj, variables: rows, updatedAt: new Date().toISOString() };
}

function varsForEnvironment(
  state: {
    workspace: Workspace | null;
    collections: Collection[];
    environments: Environment[];
    secrets: Secret[];
    draft: HttpRequestRecord | null;
  },
  envId?: string,
): Record<string, string> {
  const env = envId
    ? state.environments.find((item) => item.id === envId)
    : (state.environments.find((item) => item.isActive) ?? state.environments[0]);
  const collection = state.draft
    ? state.collections.find((item) => item.id === state.draft?.collectionId)
    : undefined;
  return resolveVars({
    global: state.workspace?.variables,
    collection: collection?.variables,
    environment: env?.variables,
    secrets: state.secrets,
  });
}

function currentVars(state: {
  workspace: Workspace | null;
  collections: Collection[];
  environments: Environment[];
  secrets: Secret[];
  draft: HttpRequestRecord | null;
}): Record<string, string> {
  return varsForEnvironment(state);
}

function enabledPairs(rows: KvRow[], vars: Record<string, string>): [string, string][] {
  return rows
    .filter((row) => row.enabled && row.key.trim())
    .map((row) => [
      interpolate(row.key, vars),
      interpolate(row.value, vars),
    ]);
}

function buildUrl(raw: string, query: KvRow[], vars: Record<string, string>): string {
  const interpolated = interpolate(raw, vars);
  const enabled = query.filter((q) => q.enabled && q.key.trim());
  if (!enabled.length) return interpolated;
  try {
    const url = new URL(interpolated);
    url.search = "";
    for (const row of enabled) {
      url.searchParams.append(
        interpolate(row.key, vars),
        interpolate(row.value, vars),
      );
    }
    return url.toString();
  } catch {
    return interpolated;
  }
}

function buildBody(
  draft: HttpRequestRecord,
  vars: Record<string, string>,
): { body?: string; extraHeaders: [string, string][] } {
  if (draft.body.type === "none") return { extraHeaders: [] };
  if (draft.body.type === "json") {
    return {
      body: interpolate(draft.body.content, vars),
      extraHeaders: [["Content-Type", "application/json"]],
    };
  }
  if (draft.body.type === "text") {
    return { body: interpolate(draft.body.content, vars), extraHeaders: [] };
  }
  const encoded = draft.body.form
    .filter((row) => row.enabled && row.key)
    .map(
      (row) =>
        `${encodeURIComponent(interpolate(row.key, vars))}=${encodeURIComponent(interpolate(row.value, vars))}`,
    )
    .join("&");
  return {
    body: encoded,
    extraHeaders: [["Content-Type", "application/x-www-form-urlencoded"]],
  };
}

function interpolateAuth(draft: HttpRequestRecord, vars: Record<string, string>) {
  return {
    ...emptyAuth(),
    ...draft.auth,
    token: interpolate(draft.auth.token, vars),
    username: interpolate(draft.auth.username, vars),
    password: interpolate(draft.auth.password, vars),
    keyName: interpolate(draft.auth.keyName, vars),
    clientId: interpolate(draft.auth.clientId, vars),
    clientSecret: interpolate(draft.auth.clientSecret, vars),
    accessToken: interpolate(draft.auth.accessToken, vars),
    refreshToken: interpolate(draft.auth.refreshToken, vars),
    tokenUrl: interpolate(draft.auth.tokenUrl, vars),
    authorizeUrl: interpolate(draft.auth.authorizeUrl, vars),
  };
}

function assembledSend(
  draft: HttpRequestRecord,
  vars: Record<string, string>,
  timeoutMs: number,
  followRedirects: boolean,
  acceptInvalidCerts: boolean,
) {
  const url = buildUrl(draft.url, draft.query, vars);
  const { body, extraHeaders } = buildBody(draft, vars);
  const headers = enabledPairs(draft.headers, vars);
  for (const [key, value] of extraHeaders) {
    const exists = headers.some(([k]) => k.toLowerCase() === key.toLowerCase());
    if (!exists) headers.push([key, value]);
  }
  return {
    method: draft.method,
    url,
    headers,
    body,
    timeoutMs,
    followRedirects,
    acceptInvalidCerts,
    auth: interpolateAuth(draft, vars),
    workspaceId: draft.workspaceId,
    requestId: draft.id,
  };
}

async function reloadLists() {
  const [workspace, collections, folders, requests, environments, secrets] =
    await Promise.all([
      api<Workspace>("workspace_get"),
      api<Collection[]>("collection_list"),
      api<Folder[]>("folder_list"),
      api<HttpRequestRecord[]>("request_list"),
      api<Environment[]>("environment_list"),
      api<Secret[]>("secret_list"),
    ]);
  return { workspace, collections, folders, requests, environments, secrets };
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  error: null,
  view: "request",
  sidebarCollapsed: false,
  workspace: null,
  collections: [],
  folders: [],
  requests: [],
  environments: [],
  secrets: [],
  cookies: [],
  history: [],
  webhookEvents: [],
  webhookStatus: {
    running: false,
    port: 0,
    url: "",
    publicUrl: "",
    tunnelRunning: false,
    tunnelError: "",
  },
  plan: "local",
  gitFolder: "",
  lastSnapshot: null,
  compare: null,
  activeRequestId: null,
  draft: null,
  dirty: false,
  sending: false,
  sendKind: "idle",
  sendId: null,
  response: null,
  assertionResults: [],
  timeoutMs: 30000,
  followRedirects: true,
  acceptInvalidCerts: false,

  bootstrap: async () => {
    try {
      const [workspace, collections, folders, requests, environments, secrets, cookies, history, webhookEvents, webhookStatus, settings] =
        await Promise.all([
          api<Workspace>("workspace_get"),
          api<Collection[]>("collection_list"),
          api<Folder[]>("folder_list"),
          api<HttpRequestRecord[]>("request_list"),
          api<Environment[]>("environment_list"),
          api<Secret[]>("secret_list"),
          api<CookieRecord[]>("cookie_list"),
          api<HistoryEntry[]>("history_list"),
          api<WebhookEvent[]>("webhook_events"),
          api<WebhookStatus>("webhook_status"),
          api<AppSettings>("settings_get"),
        ]);
      const hydrated = hydrateEnvs(environments, secrets);
      const first = requests[0] ?? null;
      const lastSnapshot = first
        ? await api<ResponseSnapshot | null>("snapshot_get", { id: first.id })
        : null;
      set({
        workspace: hydrateWorkspace(
          { ...workspace, variables: workspace.variables ?? [] },
          secrets,
        ),
        collections: hydrateCollections(
          collections.map((item) => ({ ...item, variables: item.variables ?? [] })),
          secrets,
        ),
        folders,
        requests,
        environments: hydrated,
        secrets,
        cookies,
        history,
        webhookEvents,
        webhookStatus,
        plan: normalizePlan(settings.plan),
        gitFolder: settings.gitFolder ?? "",
        lastSnapshot,
        compare: null,
        activeRequestId: first?.id ?? null,
        draft: first ? hydrateRequest(structuredClone(first)) : null,
        ready: true,
        error: null,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
        ready: true,
      });
    }
  },

  setView: (view) => set({ view }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  selectRequest: (id) => {
    const request = get().requests.find((r) => r.id === id);
    if (!request) return;
    set({
      activeRequestId: id,
      draft: hydrateRequest(structuredClone(request)),
      dirty: false,
      view: "request",
      response: null,
      assertionResults: [],
      compare: null,
      lastSnapshot: null,
    });
    void api<ResponseSnapshot | null>("snapshot_get", { id }).then(
      (lastSnapshot) => set({ lastSnapshot }),
    );
  },

  patchDraft: (patch) => {
    const draft = get().draft;
    if (!draft) return;
    set({
      draft: { ...draft, ...patch, updatedAt: new Date().toISOString() },
      dirty: true,
    });
  },

  saveDraft: async () => {
    const draft = get().draft;
    if (!draft) return;
    await api("request_save", { request: draft });
    const requests = await api<HttpRequestRecord[]>("request_list");
    set({ requests, dirty: false, activeRequestId: draft.id });
  },

  createCollection: async (name) => {
    const collection: Collection = {
      id: crypto.randomUUID(),
      workspaceId: PERSONAL_WORKSPACE_ID,
      name,
      updatedAt: new Date().toISOString(),
      variables: [],
    };
    await api("collection_save", { collection });
    const collections = await api<Collection[]>("collection_list");
    set({ collections: hydrateCollections(collections, get().secrets) });
    await get().createRequest(collection.id);
  },

  renameCollection: async (id, name) => {
    const current = get().collections.find((c) => c.id === id);
    if (!current) return;
    await api("collection_save", {
      collection: { ...current, name, updatedAt: new Date().toISOString() },
    });
    set({ collections: await api<Collection[]>("collection_list") });
  },

  saveCollectionVariables: async (id, variables) => {
    const current = get().collections.find((c) => c.id === id);
    if (!current) return;
    await persistSecretRows(variables);
    await api("collection_save", {
      collection: {
        ...current,
        variables: persistVars(variables),
        updatedAt: new Date().toISOString(),
      },
    });
    const [collections, secrets] = await Promise.all([
      api<Collection[]>("collection_list"),
      api<Secret[]>("secret_list"),
    ]);
    set({ collections: hydrateCollections(collections, secrets), secrets });
  },

  saveWorkspaceVariables: async (variables) => {
    const workspace = get().workspace;
    if (!workspace) return;
    await persistSecretRows(variables);
    const next = {
      ...workspace,
      variables: persistVars(variables),
      updatedAt: new Date().toISOString(),
    };
    await api("workspace_save", { workspace: next });
    const [saved, secrets] = await Promise.all([
      api<Workspace>("workspace_get"),
      api<Secret[]>("secret_list"),
    ]);
    set({ workspace: hydrateWorkspace(saved, secrets), secrets });
  },

  deleteCollection: async (id) => {
    await api("collection_delete", { id });
    const [collections, requests, folders] = await Promise.all([
      api<Collection[]>("collection_list"),
      api<HttpRequestRecord[]>("request_list"),
      api<Folder[]>("folder_list"),
    ]);
    const next = requests[0] ?? null;
    set({
      collections,
      requests,
      folders,
      activeRequestId: next?.id ?? null,
      draft: next ? hydrateRequest(structuredClone(next)) : null,
      dirty: false,
    });
  },

  createRequest: async (collectionId, folderId = null) => {
    const request = createRequest(PERSONAL_WORKSPACE_ID, collectionId, folderId);
    await api("request_save", { request });
    const requests = await api<HttpRequestRecord[]>("request_list");
    set({
      requests,
      activeRequestId: request.id,
      draft: request,
      dirty: false,
      view: "request",
      response: null,
      lastSnapshot: null,
      compare: null,
    });
  },

  createFolder: async (collectionId, parentId = null, name) => {
    const folder = makeFolder(collectionId, parentId, name ?? "Nueva carpeta");
    await api("folder_save", { folder });
    set({ folders: await api<Folder[]>("folder_list") });
  },

  renameFolder: async (id, name) => {
    const current = get().folders.find((f) => f.id === id);
    if (!current) return;
    await api("folder_save", {
      folder: { ...current, name, updatedAt: new Date().toISOString() },
    });
    set({ folders: await api<Folder[]>("folder_list") });
  },

  deleteFolder: async (id) => {
    await api("folder_delete", { id });
    const [folders, requests] = await Promise.all([
      api<Folder[]>("folder_list"),
      api<HttpRequestRecord[]>("request_list"),
    ]);
    set({ folders, requests });
  },

  duplicateRequest: async () => {
    const draft = get().draft;
    if (!draft) return;
    const copy: HttpRequestRecord = {
      ...structuredClone(draft),
      id: crypto.randomUUID(),
      name: `${draft.name} copia`,
      updatedAt: new Date().toISOString(),
    };
    await api("request_save", { request: copy });
    const requests = await api<HttpRequestRecord[]>("request_list");
    set({
      requests,
      activeRequestId: copy.id,
      draft: copy,
      dirty: false,
    });
  },

  deleteRequest: async (id) => {
    await api("request_delete", { id });
    const requests = await api<HttpRequestRecord[]>("request_list");
    const next = requests[0] ?? null;
    set({
      requests,
      activeRequestId: next?.id ?? null,
      draft: next ? hydrateRequest(structuredClone(next)) : null,
      dirty: false,
    });
  },

  saveEnvironment: async (env) => {
    for (const row of env.variables) {
      if (row.secret && row.key.trim()) {
        await api("secret_set", {
          secret: {
            id: crypto.randomUUID(),
            workspaceId: PERSONAL_WORKSPACE_ID,
            name: row.key.trim(),
            value: row.value,
            updatedAt: new Date().toISOString(),
          },
        });
      }
    }
    await api("environment_save", { environment: persistEnv(env) });
    const [environments, secrets] = await Promise.all([
      api<Environment[]>("environment_list"),
      api<Secret[]>("secret_list"),
    ]);
    set({ environments: hydrateEnvs(environments, secrets), secrets });
  },

  deleteEnvironment: async (id) => {
    await api("environment_delete", { id });
    const environments = await api<Environment[]>("environment_list");
    set({ environments: hydrateEnvs(environments, get().secrets) });
  },

  setActiveEnvironment: async (id) => {
    await api("environment_set_active", { id });
    const environments = await api<Environment[]>("environment_list");
    set({ environments: hydrateEnvs(environments, get().secrets) });
  },

  send: async () => {
    const state = get();
    const draft = state.draft;
    if (!draft || state.sending) return;

    let workspace = state.workspace;
    let collections = state.collections;
    let environments = state.environments;
    for (const step of draft.preRequest ?? []) {
      if (!step.enabled || !step.key.trim()) continue;
      const vars = currentVars({
        workspace,
        collections,
        environments,
        secrets: get().secrets,
        draft,
      });
      let value = "";
      if (step.kind === "set") {
        value = interpolate(step.value, vars);
      } else if (step.kind === "timestamp") {
        value =
          step.format === "epoch"
            ? String(Math.floor(Date.now() / 1000))
            : new Date().toISOString();
      } else {
        value =
          step.format === "uuid"
            ? crypto.randomUUID()
            : interpolate("{{$nonce}}", vars);
      }
      if (step.scope === "global" && workspace) {
        workspace = upsertVar(workspace, step.key.trim(), value);
      } else if (step.scope === "collection") {
        collections = collections.map((item) =>
          item.id === draft.collectionId
            ? upsertVar(item, step.key.trim(), value)
            : item,
        );
      } else {
        const activeId =
          environments.find((item) => item.isActive)?.id ?? environments[0]?.id;
        environments = environments.map((item) =>
          item.id === activeId ? upsertVar(item, step.key.trim(), value) : item,
        );
      }
    }
    if (workspace && workspace !== state.workspace) {
      await persistSecretRows(workspace.variables);
      await api("workspace_save", {
        workspace: { ...workspace, variables: persistVars(workspace.variables) },
      });
    }
    for (const collection of collections) {
      const prev = state.collections.find((item) => item.id === collection.id);
      if (prev && prev !== collection) {
        await persistSecretRows(collection.variables);
        await api("collection_save", {
          collection: {
            ...collection,
            variables: persistVars(collection.variables),
          },
        });
      }
    }
    for (const env of environments) {
      const prev = state.environments.find((item) => item.id === env.id);
      if (prev && prev !== env) {
        await persistSecretRows(env.variables);
        await api("environment_save", { environment: persistEnv(env) });
      }
    }
    const secrets = await api<Secret[]>("secret_list");
    const [nextWorkspace, nextCollections, nextEnvironments] = await Promise.all([
      api<Workspace>("workspace_get"),
      api<Collection[]>("collection_list"),
      api<Environment[]>("environment_list"),
    ]);
    workspace = hydrateWorkspace(nextWorkspace, secrets);
    collections = hydrateCollections(nextCollections, secrets);
    environments = hydrateEnvs(nextEnvironments, secrets);
    set({ workspace, collections, environments, secrets });

    const vars = currentVars(get());
    const payload = assembledSend(
      draft,
      vars,
      get().timeoutMs,
      get().followRedirects,
      get().acceptInvalidCerts,
    );
    const sendId = crypto.randomUUID();
    set({
      sending: true,
      sendKind: "single",
      sendId,
      response: null,
      assertionResults: [],
      compare: null,
    });
    const previous = await api<ResponseSnapshot | null>("snapshot_get", {
      id: draft.id,
    });
    const result = await api<HttpSendResult>("http_send", {
      payload: { ...payload, id: sendId },
    });
    if (result.status === 200 && !result.truncated) {
      await api("snapshot_put", {
        snapshot: {
          requestId: draft.id,
          status: 200,
          headers: result.headers,
          body: result.body,
          encoding: result.bodyEncoding,
          contentType: result.contentType,
          at: new Date().toISOString(),
        },
      });
    }
    const assertionResults = runAssertions(draft.tests ?? [], result, vars);
    const [history, cookies, requests] = await Promise.all([
      api<HistoryEntry[]>("history_list"),
      api<CookieRecord[]>("cookie_list"),
      api<HttpRequestRecord[]>("request_list"),
    ]);
    const updated = requests.find((item) => item.id === draft.id);
    const current = get().draft;
    set({
      sending: false,
      sendKind: "idle",
      sendId: null,
      response: result,
      lastSnapshot: previous,
      assertionResults,
      history,
      cookies,
      requests,
      draft:
        current && updated && current.id === updated.id
          ? {
              ...current,
              auth: {
                ...emptyAuth(),
                ...current.auth,
                accessToken: updated.auth.accessToken || current.auth.accessToken,
                refreshToken: updated.auth.refreshToken || current.auth.refreshToken,
                expiresAt: updated.auth.expiresAt || current.auth.expiresAt,
              },
            }
          : current,
    });
  },

  cancel: async () => {
    const sendId = get().sendId;
    if (sendId) await api("http_cancel", { id: sendId });
  },

  applyImported: (patch) => {
    const draft = get().draft;
    if (!draft) return;
    set({
      draft: {
        ...draft,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
      dirty: true,
    });
  },

  loadHistory: async () => {
    set({ history: await api<HistoryEntry[]>("history_list") });
  },

  clearHistory: async () => {
    await api("history_clear");
    set({ history: [] });
  },

  replayHistory: (entry) => {
    const match = entry.requestId
      ? get().requests.find((r) => r.id === entry.requestId)
      : undefined;
    if (match) {
      get().selectRequest(match.id);
    } else if (!get().draft) {
      return;
    } else {
      set({ view: "request" });
    }
    const draft = get().draft;
    if (!draft) return;
    const method = METHODS.includes(entry.method as HttpMethod)
      ? (entry.method as HttpMethod)
      : draft.method;
    if (draft.method === method && draft.url === entry.url) return;
    get().patchDraft({ method, url: entry.url });
    toast.message("URL de esa ejecución", {
      description: "No está guardada. Pulsa Guardar si quieres conservarla.",
    });
  },

  startWebhook: async (port) => {
    const webhookStatus = await api<WebhookStatus>("webhook_start", { port });
    set({ webhookStatus });
  },

  stopWebhook: async () => {
    const webhookStatus = await api<WebhookStatus>("webhook_stop");
    set({ webhookStatus });
  },

  startTunnel: async () => {
    if (!entitlementsFor(get().plan).can(Features.WebhooksPublicTunnel)) {
      throw new Error("El túnel público es una función Pro.");
    }
    const webhookStatus = await api<WebhookStatus>("webhook_tunnel_start");
    set({ webhookStatus });
  },

  stopTunnel: async () => {
    const webhookStatus = await api<WebhookStatus>("webhook_tunnel_stop");
    set({ webhookStatus });
  },

  loadWebhooks: async () => {
    const [webhookEvents, webhookStatus] = await Promise.all([
      api<WebhookEvent[]>("webhook_events"),
      api<WebhookStatus>("webhook_status"),
    ]);
    set({ webhookEvents, webhookStatus });
  },

  clearWebhooks: async () => {
    await api("webhook_clear");
    set({ webhookEvents: [] });
  },

  prependWebhook: (event) => {
    set((state) => ({
      webhookEvents: [event, ...state.webhookEvents.filter((e) => e.id !== event.id)].slice(0, 200),
    }));
  },

  replayWebhook: async (event, opts) => {
    const built = requestFromWebhook(
      event,
      PERSONAL_WORKSPACE_ID,
      opts.collectionId,
      opts.url,
    );
    if (opts.createNew) {
      await api("request_save", { request: built });
      const requests = await api<HttpRequestRecord[]>("request_list");
      set({
        requests,
        activeRequestId: built.id,
        draft: built,
        dirty: false,
        view: "request",
        response: null,
        lastSnapshot: null,
        compare: null,
      });
    } else {
      const draft = get().draft;
      if (!draft) {
        await api("request_save", { request: built });
        const requests = await api<HttpRequestRecord[]>("request_list");
        set({
          requests,
          activeRequestId: built.id,
          draft: built,
          dirty: false,
          view: "request",
        });
      } else {
        set({
          draft: {
            ...draft,
            method: built.method,
            url: built.url,
            headers: built.headers,
            body: built.body,
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
          view: "request",
        });
      }
    }
    if (opts.sendNow) {
      await get().send();
    }
  },

  setPlan: async (plan) => {
    const next = normalizePlan(plan);
    const settings = await api<AppSettings>("settings_save", {
      settings: { plan: next, gitFolder: get().gitFolder },
    });
    const webhookStatus = await api<WebhookStatus>("webhook_status");
    set({ plan: normalizePlan(settings.plan), webhookStatus });
  },

  linkGitFolder: async () => {
    const picked = await api<string | null>("git_folder_pick");
    if (!picked) {
      return {
        folder: get().gitFolder,
        imported: false,
        exported: false,
        changed: false,
        message: "",
      };
    }
    const result = await api<GitSyncResult>("git_folder_link", { folder: picked });
    const lists = await reloadLists();
    const secrets = lists.secrets;
    set({
      gitFolder: result.folder,
      workspace: hydrateWorkspace(lists.workspace, secrets),
      collections: hydrateCollections(lists.collections, secrets),
      folders: lists.folders,
      requests: lists.requests,
      environments: hydrateEnvs(lists.environments, secrets),
      secrets,
    });
    return result;
  },

  unlinkGitFolder: async () => {
    const settings = await api<AppSettings>("git_folder_unlink");
    set({ gitFolder: settings.gitFolder ?? "" });
  },

  syncGitNow: async () => {
    return api<GitSyncResult>("git_sync_now");
  },

  pollGit: async () => {
    if (!get().gitFolder) return;
    const result = await api<GitSyncResult>("git_sync_poll");
    if (!result.changed) return;
    const lists = await reloadLists();
    const secrets = lists.secrets;
    const dirty = get().dirty;
    const activeId = get().activeRequestId;
    const updated = lists.requests.find((item) => item.id === activeId);
    set({
      workspace: hydrateWorkspace(lists.workspace, secrets),
      collections: hydrateCollections(lists.collections, secrets),
      folders: lists.folders,
      requests: lists.requests,
      environments: hydrateEnvs(lists.environments, secrets),
      secrets,
      draft:
        dirty || !updated
          ? get().draft
          : hydrateRequest(structuredClone(updated)),
    });
    const { toast } = await import("sonner");
    toast.message(result.message || "Carpeta Git actualizada");
  },

  compareEnvironments: async (envAId, envBId) => {
    const draft = get().draft;
    if (!draft || get().sending) return;
    const activeId =
      get().environments.find((item) => item.isActive)?.id ?? get().environments[0]?.id;
    const varsA = varsForEnvironment(get(), envAId);
    const varsB = varsForEnvironment(get(), envBId);
    const sendIdA = crypto.randomUUID();
    set({ sending: true, sendKind: "compare", sendId: sendIdA, compare: null });
    try {
      const resultA = await api<HttpSendResult>("http_send", {
        payload: {
          ...assembledSend(
            draft,
            varsA,
            get().timeoutMs,
            get().followRedirects,
            get().acceptInvalidCerts,
          ),
          id: sendIdA,
        },
      });
      if (resultA.cancelled) {
        set({ sending: false, sendKind: "idle", sendId: null });
        return;
      }
      const sendIdB = crypto.randomUUID();
      set({ sendId: sendIdB });
      const resultB = await api<HttpSendResult>("http_send", {
        payload: {
          ...assembledSend(
            draft,
            varsB,
            get().timeoutMs,
            get().followRedirects,
            get().acceptInvalidCerts,
          ),
          id: sendIdB,
        },
      });
      if (resultB.cancelled) {
        set({ sending: false, sendKind: "idle", sendId: null });
        return;
      }
      if (activeId === envAId && resultA.status === 200 && !resultA.truncated) {
        await api("snapshot_put", {
          snapshot: {
            requestId: draft.id,
            status: 200,
            headers: resultA.headers,
            body: resultA.body,
            encoding: resultA.bodyEncoding,
            contentType: resultA.contentType,
            at: new Date().toISOString(),
          },
        });
      } else if (activeId === envBId && resultB.status === 200 && !resultB.truncated) {
        await api("snapshot_put", {
          snapshot: {
            requestId: draft.id,
            status: 200,
            headers: resultB.headers,
            body: resultB.body,
            encoding: resultB.bodyEncoding,
            contentType: resultB.contentType,
            at: new Date().toISOString(),
          },
        });
      }
      const history = await api<HistoryEntry[]>("history_list");
      set({
        sending: false,
        sendKind: "idle",
        sendId: null,
        history,
        compare: {
          envAId,
          envBId,
          resultA,
          resultB,
          assertionsA: runAssertions(draft.tests ?? [], resultA, varsA),
          assertionsB: runAssertions(draft.tests ?? [], resultB, varsB),
        },
      });
    } catch (error) {
      set({ sending: false, sendKind: "idle", sendId: null });
      throw error;
    }
  },

  clearCompare: () => {
    const current = get().compare;
    if (!current) {
      set({ compare: null });
      return;
    }
    const activeId =
      get().environments.find((item) => item.isActive)?.id ?? get().environments[0]?.id;
    const useB = activeId === current.envBId;
    set({
      compare: null,
      response: useB ? current.resultB : current.resultA,
      assertionResults: useB ? current.assertionsB : current.assertionsA,
    });
  },

  exportCollection: (id) => {
    const { collections, requests, folders, environments } = get();
    const collection = collections.find((item) => item.id === id);
    if (!collection) return;
    const file = serializeCollection(collection, requests, folders, environments);
    downloadJson(
      collectionFileName(collection.name),
      JSON.stringify(file, null, 2),
    );
  },

  importCollectionJson: async (text) => {
    const bundle = parseImportedCollection(text);
    const { collections, environments } = get();
    const name = uniqueCollectionName(
      bundle.collectionName,
      collections.map((item) => item.name),
    );
    const collection: Collection = {
      id: crypto.randomUUID(),
      workspaceId: PERSONAL_WORKSPACE_ID,
      name,
      updatedAt: new Date().toISOString(),
      variables: (bundle.collectionVariables ?? []).map((row) => ({
        id: crypto.randomUUID(),
        key: row.key ?? "",
        value: row.secret ? "" : String(row.value ?? ""),
        enabled: row.enabled !== false,
        secret: Boolean(row.secret),
      })),
    };
    await api("collection_save", { collection });
    await persistSecretRows(collection.variables);
    const { folders: importedFolders, pathToId } = buildImportedFolders(
      bundle.folders,
      collection.id,
      PERSONAL_WORKSPACE_ID,
    );
    for (const folder of importedFolders) {
      await api("folder_save", { folder });
    }
    const savedRequests = bundle.requests.map((request) =>
      toSavedRequest(
        request,
        PERSONAL_WORKSPACE_ID,
        collection.id,
        request.folderPath ? (pathToId.get(request.folderPath) ?? null) : null,
      ),
    );
    for (const request of savedRequests) {
      await api("request_save", { request });
    }
    const existingEnvNames = new Set(
      environments.map((env) => env.name.toLowerCase()),
    );
    const secretNames = new Set(get().secrets.map((item) => item.name));
    for (const env of bundle.environments) {
      if (existingEnvNames.has(env.name.toLowerCase())) continue;
      existingEnvNames.add(env.name.toLowerCase());
      await api("environment_save", {
        environment: toSavedEnvironment(env, PERSONAL_WORKSPACE_ID),
      });
      for (const row of env.variables ?? []) {
        const key = row.key?.trim();
        if (!row.secret || !key || secretNames.has(key)) continue;
        secretNames.add(key);
        await api("secret_set", {
          secret: {
            id: crypto.randomUUID(),
            workspaceId: PERSONAL_WORKSPACE_ID,
            name: key,
            value: "",
            updatedAt: new Date().toISOString(),
          },
        });
      }
    }
    const [nextCollections, nextFolders, nextRequests, nextEnvironments, nextSecrets] =
      await Promise.all([
      api<Collection[]>("collection_list"),
      api<Folder[]>("folder_list"),
      api<HttpRequestRecord[]>("request_list"),
      api<Environment[]>("environment_list"),
      api<Secret[]>("secret_list"),
    ]);
    const first = savedRequests[0] ?? null;
    set({
      collections: hydrateCollections(nextCollections, nextSecrets),
      folders: nextFolders,
      requests: nextRequests,
      environments: hydrateEnvs(nextEnvironments, nextSecrets),
      secrets: nextSecrets,
      activeRequestId: first?.id ?? get().activeRequestId,
      draft: first ? hydrateRequest(structuredClone(first)) : get().draft,
      dirty: false,
      view: "request",
    });
    return name;
  },

  saveSecret: async (secret) => {
    await api("secret_set", { secret });
    const secrets = await api<Secret[]>("secret_list");
    set({
      secrets,
      environments: hydrateEnvs(get().environments, secrets),
    });
  },

  deleteSecret: async (name) => {
    await api("secret_delete", { name });
    const secrets = await api<Secret[]>("secret_list");
    set({
      secrets,
      environments: get().environments.map((env) => ({
        ...env,
        variables: env.variables.map((row) =>
          row.secret && row.key === name ? { ...row, value: "" } : row,
        ),
      })),
    });
  },

  loadCookies: async () => {
    set({ cookies: await api<CookieRecord[]>("cookie_list") });
  },

  upsertCookie: async (cookie) => {
    await api("cookie_upsert", { cookie });
    set({ cookies: await api<CookieRecord[]>("cookie_list") });
  },

  deleteCookie: async (id) => {
    await api("cookie_delete", { id });
    set({ cookies: await api<CookieRecord[]>("cookie_list") });
  },

  clearCookies: async () => {
    await api("cookie_clear");
    set({ cookies: [] });
  },

  obtainToken: async () => {
    const draft = get().draft;
    if (!draft || draft.auth.type !== "oauth2") return;
    const vars = currentVars(get());
    const grant =
      draft.auth.grant === "authorization_code"
        ? "authorization_code"
        : "client_credentials";
    const params = {
      grant,
      tokenUrl: interpolate(draft.auth.tokenUrl, vars),
      authorizeUrl: interpolate(draft.auth.authorizeUrl, vars),
      clientId: interpolate(draft.auth.clientId, vars),
      clientSecret: interpolate(draft.auth.clientSecret, vars),
      scopes: interpolate(draft.auth.scopes, vars),
    };
    const cmd =
      grant === "authorization_code"
        ? "oauth_authorize"
        : "oauth_client_credentials";
    const tokens = await api<OauthTokens>(cmd, { params });
    const next = {
      ...draft,
      auth: {
        ...draft.auth,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || draft.auth.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    };
    await api("request_save", { request: next });
    if (tokens.accessToken) {
      await api("secret_set", {
        secret: {
          id: crypto.randomUUID(),
          workspaceId: PERSONAL_WORKSPACE_ID,
          name: `OAuth · ${draft.name}`,
          value: tokens.accessToken,
          updatedAt: new Date().toISOString(),
        },
      });
    }
    set({
      draft: next,
      dirty: false,
      requests: await api<HttpRequestRecord[]>("request_list"),
      secrets: await api<Secret[]>("secret_list"),
    });
  },
}));

export { isTauri };
