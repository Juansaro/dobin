export const PERSONAL_WORKSPACE_ID = "personal-local";

export type WorkspaceKind = "personal" | "team";

export type View = "request" | "webhooks" | "history" | "settings" | "plans";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type BodyType = "none" | "json" | "text" | "form";
export type AuthType = "none" | "bearer" | "basic" | "apikey" | "oauth2";

export interface KvRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
}

export type PreStepKind = "set" | "timestamp" | "nonce";
export type PreStepScope = "global" | "collection" | "environment";
export type AssertionKind = "status" | "header" | "jsonpath";
export type AssertionOp = "eq" | "inRange" | "exists" | "contains";
export type BodyEncoding = "utf8" | "base64";

export interface PreStep {
  id: string;
  kind: PreStepKind;
  enabled: boolean;
  scope: PreStepScope;
  key: string;
  value: string;
  format: string;
}

export interface Assertion {
  id: string;
  kind: AssertionKind;
  op: AssertionOp;
  enabled: boolean;
  headerName: string;
  expected: string;
  min: number;
  max: number;
  path: string;
}

export interface AssertionResult {
  id: string;
  passed: boolean;
  message: string;
}

export interface Timings {
  dnsMs: number | null;
  tcpMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  totalMs: number;
}

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  updatedAt: string;
  variables: KvRow[];
}

export interface Collection {
  id: string;
  workspaceId: string;
  name: string;
  updatedAt: string;
  variables: KvRow[];
}

export interface Folder {
  id: string;
  workspaceId: string;
  collectionId: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  updatedAt: string;
}

export interface RequestBody {
  type: BodyType;
  content: string;
  form: KvRow[];
}

export interface AuthSpec {
  type: AuthType;
  token: string;
  username: string;
  password: string;
  apiKeyIn: "header" | "query";
  keyName: string;
  grant: "client_credentials" | "authorization_code";
  tokenUrl: string;
  authorizeUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface HttpRequestRecord {
  id: string;
  workspaceId: string;
  collectionId: string;
  folderId: string | null;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KvRow[];
  query: KvRow[];
  body: RequestBody;
  auth: AuthSpec;
  preRequest: PreStep[];
  tests: Assertion[];
  sortOrder: number;
  updatedAt: string;
}

export interface Environment {
  id: string;
  workspaceId: string;
  name: string;
  variables: KvRow[];
  isActive: boolean;
  updatedAt: string;
}

export interface Secret {
  id: string;
  workspaceId: string;
  name: string;
  value: string;
  updatedAt: string;
}

export interface CookieRecord {
  id: string;
  workspaceId: string;
  domain: string;
  path: string;
  name: string;
  value: string;
  expiresAt: string | null;
  secure: boolean;
  httpOnly: boolean;
}

export interface HistoryEntry {
  id: string;
  workspaceId: string;
  requestId: string | null;
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  at: string;
}

export interface WebhookEvent {
  id: string;
  workspaceId: string;
  method: string;
  path: string;
  query: string;
  headers: [string, string][];
  body: string;
  at: string;
}

export interface HttpSendPayload {
  id: string;
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
  timeoutMs: number;
  followRedirects: boolean;
  acceptInvalidCerts: boolean;
  auth: AuthSpec;
  workspaceId: string;
  requestId?: string;
}

export interface HttpSendResult {
  ok: boolean;
  cancelled: boolean;
  error: string | null;
  status: number | null;
  statusText: string | null;
  headers: [string, string][];
  body: string;
  truncated: boolean;
  durationMs: number;
  contentType: string | null;
  bodyEncoding: BodyEncoding;
  timings: Timings;
}

export interface WebhookStatus {
  running: boolean;
  port: number;
  url: string;
}

export interface OauthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export const METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

export function emptyKv(): KvRow {
  return {
    id: crypto.randomUUID(),
    key: "",
    value: "",
    enabled: true,
    secret: false,
  };
}

export function emptyAuth(): AuthSpec {
  return {
    type: "none",
    token: "",
    username: "",
    password: "",
    apiKeyIn: "header",
    keyName: "",
    grant: "client_credentials",
    tokenUrl: "",
    authorizeUrl: "",
    clientId: "",
    clientSecret: "",
    scopes: "",
    accessToken: "",
    refreshToken: "",
    expiresAt: "",
  };
}

export function emptyBody(): RequestBody {
  return { type: "none", content: "", form: [] };
}

export function emptyTimings(totalMs = 0): Timings {
  return {
    dnsMs: null,
    tcpMs: null,
    tlsMs: null,
    ttfbMs: null,
    totalMs,
  };
}

export function emptyPreStep(kind: PreStepKind = "set"): PreStep {
  return {
    id: crypto.randomUUID(),
    kind,
    enabled: true,
    scope: "environment",
    key: "",
    value: "",
    format: kind === "timestamp" ? "iso" : kind === "nonce" ? "hex" : "",
  };
}

export function emptyAssertion(kind: AssertionKind = "status"): Assertion {
  return {
    id: crypto.randomUUID(),
    kind,
    op: kind === "status" ? "eq" : "exists",
    enabled: true,
    headerName: "",
    expected: kind === "status" ? "200" : "",
    min: 200,
    max: 299,
    path: "$",
  };
}

export function hydrateRequest(request: HttpRequestRecord): HttpRequestRecord {
  return {
    ...request,
    auth: { ...emptyAuth(), ...request.auth },
    preRequest: request.preRequest ?? [],
    tests: request.tests ?? [],
  };
}

export function createRequest(
  workspaceId: string,
  collectionId: string,
  folderId: string | null = null,
): HttpRequestRecord {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    collectionId,
    folderId,
    name: "Nuevo request",
    method: "GET",
    url: "{{baseUrl}}",
    headers: [],
    query: [],
    body: emptyBody(),
    auth: emptyAuth(),
    preRequest: [],
    tests: [],
    sortOrder: Date.now(),
    updatedAt: new Date().toISOString(),
  };
}

export function createFolder(
  collectionId: string,
  parentId: string | null,
  name = "Nueva carpeta",
): Folder {
  return {
    id: crypto.randomUUID(),
    workspaceId: PERSONAL_WORKSPACE_ID,
    collectionId,
    parentId,
    name,
    sortOrder: Date.now(),
    updatedAt: new Date().toISOString(),
  };
}
