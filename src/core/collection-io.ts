import type {
  AuthSpec,
  BodyType,
  Collection,
  Environment,
  Folder,
  HttpMethod,
  HttpRequestRecord,
  KvRow,
  PreStep,
  Assertion,
  RequestBody,
} from "./types";
import { emptyAuth, METHODS } from "./types";

export const COLLECTION_FORMAT = "opendobin.collection";
export const COLLECTION_VERSION = 3;

export interface ExportedKv {
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
}

export interface ExportedFolder {
  name: string;
  parentPath: string | null;
  sortOrder: number;
}

export interface ExportedRequest {
  name: string;
  method: HttpMethod;
  url: string;
  headers: ExportedKv[];
  query: ExportedKv[];
  body: {
    type: BodyType;
    content: string;
    form: ExportedKv[];
  };
  auth: AuthSpec;
  sortOrder: number;
  folderPath: string | null;
  preRequest?: PreStep[];
  tests?: Assertion[];
}

export interface ExportedEnvironment {
  name: string;
  variables: ExportedKv[];
  isActive: boolean;
}

export interface OpenDobinCollectionFile {
  format: typeof COLLECTION_FORMAT;
  version: number;
  exportedAt: string;
  collection: {
    name: string;
    folders?: ExportedFolder[];
    variables?: ExportedKv[];
    requests: ExportedRequest[];
  };
  environments: ExportedEnvironment[];
}

export interface ImportBundle {
  collectionName: string;
  folders: ExportedFolder[];
  requests: ExportedRequest[];
  environments: ExportedEnvironment[];
  collectionVariables: ExportedKv[];
}

function stripKv(rows: KvRow[], redactSecrets: boolean): ExportedKv[] {
  return rows.map(({ key, value, enabled, secret }) => ({
    key,
    value: redactSecrets && secret ? "" : value,
    enabled,
    secret: Boolean(secret),
  }));
}

function hydrateKv(rows: ExportedKv[] | undefined): KvRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    id: crypto.randomUUID(),
    key: String(row.key ?? ""),
    value: row.secret ? "" : String(row.value ?? ""),
    enabled: row.enabled !== false,
    secret: Boolean(row.secret),
  }));
}

function asMethod(value: unknown): HttpMethod {
  const method = String(value ?? "GET").toUpperCase();
  return (METHODS as string[]).includes(method)
    ? (method as HttpMethod)
    : "GET";
}

export function folderPath(
  folderId: string | null,
  folders: Folder[],
): string | null {
  if (!folderId) return null;
  const parts: string[] = [];
  let current = folders.find((f) => f.id === folderId) ?? null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId
      ? (folders.find((f) => f.id === current?.parentId) ?? null)
      : null;
  }
  return parts.length ? parts.join("/") : null;
}

function redactAuth(auth: AuthSpec): AuthSpec {
  return {
    ...emptyAuth(),
    ...auth,
    token: "",
    password: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
    expiresAt: "",
  };
}

export function serializeCollection(
  collection: Collection,
  requests: HttpRequestRecord[],
  folders: Folder[],
  environments: Environment[],
): OpenDobinCollectionFile {
  const colFolders = folders.filter((f) => f.collectionId === collection.id);
  return {
    format: COLLECTION_FORMAT,
    version: COLLECTION_VERSION,
    exportedAt: new Date().toISOString(),
    collection: {
      name: collection.name,
      folders: colFolders.map((folder) => ({
        name: folder.name,
        parentPath: folderPath(folder.parentId, colFolders),
        sortOrder: folder.sortOrder,
      })),
      variables: stripKv(collection.variables ?? [], true),
      requests: requests
        .filter((request) => request.collectionId === collection.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((request) => ({
          name: request.name,
          method: request.method,
          url: request.url,
          headers: stripKv(request.headers, true),
          query: stripKv(request.query, true),
          body: {
            type: request.body.type,
            content: request.body.content,
            form: stripKv(request.body.form, true),
          },
          auth: redactAuth(request.auth),
          sortOrder: request.sortOrder,
          folderPath: folderPath(request.folderId, colFolders),
          preRequest: request.preRequest ?? [],
          tests: request.tests ?? [],
        })),
    },
    environments: environments.map((env) => ({
      name: env.name,
      variables: stripKv(env.variables, true),
      isActive: false,
    })),
  };
}

export function parseNativeCollection(data: unknown): ImportBundle {
  const file = data as Partial<OpenDobinCollectionFile>;
  const name = file.collection?.name?.trim();
  if (file.version != null && file.version > COLLECTION_VERSION) {
    throw new Error(`Versión de colección no soportada: ${file.version}`);
  }
  if (!name) {
    throw new Error("El JSON de openDobin no tiene nombre de colección.");
  }
  const requests = (file.collection?.requests ?? []).map((request, index) =>
    normalizeExportedRequest(request, index),
  );
  const environments = (file.environments ?? [])
    .filter((env) => env?.name?.trim())
    .map((env) => ({
      name: env.name.trim(),
      variables: env.variables ?? [],
      isActive: false,
    }));
  return {
    collectionName: name,
    folders: file.collection?.folders ?? [],
    requests,
    environments,
    collectionVariables: file.collection?.variables ?? [],
  };
}

export function normalizeExportedRequest(
  request: {
    name?: string;
    method?: string;
    url?: string;
    headers?: ExportedKv[];
    query?: ExportedKv[];
    body?: Partial<ExportedRequest["body"]>;
    auth?: Partial<AuthSpec>;
    sortOrder?: number;
    folderPath?: string | null;
    preRequest?: PreStep[];
    tests?: Assertion[];
  },
  index: number,
): ExportedRequest {
  const bodyType: BodyType =
    request.body?.type === "json" ||
    request.body?.type === "text" ||
    request.body?.type === "form"
      ? request.body.type
      : "none";
  const authType = (
    ["none", "bearer", "basic", "apikey", "oauth2"] as AuthSpec["type"][]
  ).includes(request.auth?.type as AuthSpec["type"])
    ? (request.auth?.type as AuthSpec["type"])
    : "none";
  return {
    name: request.name?.trim() || `Request ${index + 1}`,
    method: asMethod(request.method),
    url: request.url ?? "",
    headers: request.headers ?? [],
    query: request.query ?? [],
    body: {
      type: bodyType,
      content: request.body?.content ?? "",
      form: request.body?.form ?? [],
    },
    auth: { ...emptyAuth(), ...request.auth, type: authType },
    sortOrder: Number.isFinite(request.sortOrder)
      ? Number(request.sortOrder)
      : index,
    folderPath: request.folderPath ?? null,
    preRequest: request.preRequest ?? [],
    tests: request.tests ?? [],
  };
}

export function uniqueCollectionName(
  desired: string,
  existing: string[],
): string {
  const names = new Set(existing.map((name) => name.toLowerCase()));
  if (!names.has(desired.toLowerCase())) return desired;
  const imported = `${desired} (importada)`;
  if (!names.has(imported.toLowerCase())) return imported;
  let n = 2;
  while (names.has(`${desired} (${n})`.toLowerCase())) n += 1;
  return `${desired} (${n})`;
}

export function toSavedRequest(
  exported: ExportedRequest,
  workspaceId: string,
  collectionId: string,
  folderId: string | null,
): HttpRequestRecord {
  const body: RequestBody = {
    type: exported.body.type,
    content: exported.body.content,
    form: hydrateKv(exported.body.form),
  };
  return {
    id: crypto.randomUUID(),
    workspaceId,
    collectionId,
    folderId,
    name: exported.name,
    method: exported.method,
    url: exported.url,
    headers: hydrateKv(exported.headers),
    query: hydrateKv(exported.query),
    body,
    auth: { ...emptyAuth(), ...exported.auth },
    preRequest: exported.preRequest ?? [],
    tests: exported.tests ?? [],
    sortOrder: exported.sortOrder,
    updatedAt: new Date().toISOString(),
  };
}

export function toSavedEnvironment(
  exported: ExportedEnvironment,
  workspaceId: string,
): Environment {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    name: exported.name,
    variables: hydrateKv(exported.variables),
    isActive: false,
    updatedAt: new Date().toISOString(),
  };
}

export function buildImportedFolders(
  exported: ExportedFolder[],
  collectionId: string,
  workspaceId: string,
): { folders: Folder[]; pathToId: Map<string, string> } {
  const pathToId = new Map<string, string>();
  const sorted = [...exported].sort(
    (a, b) =>
      (a.parentPath ? a.parentPath.split("/").length : 0) -
      (b.parentPath ? b.parentPath.split("/").length : 0),
  );
  const folders: Folder[] = [];
  for (const item of sorted) {
    const path = item.parentPath ? `${item.parentPath}/${item.name}` : item.name;
    if (pathToId.has(path)) continue;
    const folder: Folder = {
      id: crypto.randomUUID(),
      workspaceId,
      collectionId,
      parentId: item.parentPath ? (pathToId.get(item.parentPath) ?? null) : null,
      name: item.name,
      sortOrder: item.sortOrder,
      updatedAt: new Date().toISOString(),
    };
    pathToId.set(path, folder.id);
    folders.push(folder);
  }
  return { folders, pathToId };
}

export function collectionFileName(name: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "") || "coleccion";
  return `${slug}.opendobin.json`;
}

export function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function pickCollectionFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.yaml,.yml,application/json,text/yaml";
    input.addEventListener("cancel", () => resolve(null));
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then(resolve);
    };
    input.click();
  });
}

export const pickJsonFile = pickCollectionFile;
