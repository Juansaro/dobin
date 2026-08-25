import { create } from "zustand";
import { api, isTauri } from "@/core/bridge";
import { interpolate, resolveVars } from "@/core/interpolate";
import { runAssertions } from "@/core/assertions";
import type {
  AssertionResult,
  Collection,
  CookieRecord,
  Environment,
  Folder,
  HistoryEntry,
  HttpRequestRecord,
  HttpSendResult,
  KvRow,
  OauthTokens,
  Secret,
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
  PERSONAL_WORKSPACE_ID,
} from "@/core/types";
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
  activeRequestId: string | null;
  draft: HttpRequestRecord | null;
  dirty: boolean;
  sending: boolean;
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
  loadWebhooks: () => Promise<void>;
  clearWebhooks: () => Promise<void>;
  prependWebhook: (event: WebhookEvent) => void;
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

function currentVars(state: {
  workspace: Workspace | null;
  collections: Collection[];
  environments: Environment[];
  secrets: Secret[];
  draft: HttpRequestRecord | null;
}): Record<string, string> {
  const env =
    state.environments.find((item) => item.isActive) ?? state.environments[0];
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
  webhookStatus: { running: false, port: 0, url: "" },
  activeRequestId: null,
  draft: null,
  dirty: false,
  sending: false,
  sendId: null,
  response: null,
  assertionResults: [],
  timeoutMs: 30000,
  followRedirects: true,
  acceptInvalidCerts: false,

  bootstrap: async () => {
    try {
      const [workspace, collections, folders, requests, environments, secrets, cookies, history, webhookEvents, webhookStatus] =
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
        ]);
      const hydrated = hydrateEnvs(environments, secrets);
      const first = requests[0] ?? null;
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
    });
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
    const url = buildUrl(draft.url, draft.query, vars);
    const { body, extraHeaders } = buildBody(draft, vars);
    const headers = enabledPairs(draft.headers, vars);
    for (const [key, value] of extraHeaders) {
      const exists = headers.some(
        ([k]) => k.toLowerCase() === key.toLowerCase(),
      );
      if (!exists) headers.push([key, value]);
    }
    const auth = {
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
    const sendId = crypto.randomUUID();
    set({ sending: true, sendId, response: null, assertionResults: [] });
    const result = await api<HttpSendResult>("http_send", {
      payload: {
        id: sendId,
        method: draft.method,
        url,
        headers,
        body,
        timeoutMs: get().timeoutMs,
        followRedirects: get().followRedirects,
        acceptInvalidCerts: get().acceptInvalidCerts,
        auth,
        workspaceId: draft.workspaceId,
        requestId: draft.id,
      },
    });
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
      sendId: null,
      response: result,
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
      return;
    }
    const draft = get().draft;
    if (!draft) return;
    set({
      draft: {
        ...draft,
        method: entry.method as HttpRequestRecord["method"],
        url: entry.url,
      },
      dirty: true,
      view: "request",
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
