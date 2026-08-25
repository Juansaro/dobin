import type { AuthSpec, BodyType } from "./types";
import { emptyAuth } from "./types";
import type {
  ExportedFolder,
  ExportedKv,
  ExportedRequest,
  ImportBundle,
} from "./collection-io";
import { normalizeExportedRequest } from "./collection-io";

interface PostmanKv {
  key?: string;
  value?: string;
  disabled?: boolean;
}

interface PostmanAuth {
  type?: string;
  bearer?: PostmanKv[];
  basic?: PostmanKv[];
  apikey?: PostmanKv[];
}

interface PostmanBody {
  mode?: string;
  raw?: string;
  options?: { raw?: { language?: string } };
  urlencoded?: PostmanKv[];
}

interface PostmanUrl {
  raw?: string;
  query?: PostmanKv[];
}

interface PostmanRequest {
  method?: string;
  header?: PostmanKv[];
  url?: string | PostmanUrl;
  body?: PostmanBody;
  auth?: PostmanAuth;
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest | string;
}

interface PostmanCollection {
  info?: { name?: string; schema?: string };
  item?: PostmanItem[];
  variable?: PostmanKv[];
}

export function isPostmanCollection(data: unknown): boolean {
  const schema = String(
    (data as PostmanCollection)?.info?.schema ?? "",
  ).toLowerCase();
  return (
    schema.includes("getpostman.com") ||
    schema.includes("postman.com") ||
    schema.includes("collection/v2")
  );
}

function kvList(rows: PostmanKv[] | undefined): ExportedKv[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row.key)
    .map((row) => ({
      key: String(row.key),
      value: String(row.value ?? ""),
      enabled: row.disabled !== true,
    }));
}

function authFrom(postman: PostmanAuth | undefined): AuthSpec {
  const type = postman?.type?.toLowerCase();
  if (type === "bearer") {
    const token =
      postman?.bearer?.find((row) => row.key === "token")?.value ??
      postman?.bearer?.[0]?.value ??
      "";
    return { ...emptyAuth(), type: "bearer", token };
  }
  if (type === "basic") {
    const username =
      postman?.basic?.find((row) => row.key === "username")?.value ?? "";
    const password =
      postman?.basic?.find((row) => row.key === "password")?.value ?? "";
    return { ...emptyAuth(), type: "basic", username, password };
  }
  if (type === "apikey") {
    const keyName =
      postman?.apikey?.find((row) => row.key === "key")?.value ?? "X-Api-Key";
    const value =
      postman?.apikey?.find((row) => row.key === "value")?.value ?? "";
    const loc =
      postman?.apikey?.find((row) => row.key === "in")?.value === "query"
        ? "query"
        : "header";
    return {
      ...emptyAuth(),
      type: "apikey",
      keyName,
      token: value,
      apiKeyIn: loc,
    };
  }
  return emptyAuth();
}

function bodyFrom(postman: PostmanBody | undefined): {
  type: BodyType;
  content: string;
  form: ExportedKv[];
} {
  if (!postman?.mode || postman.mode === "none") {
    return { type: "none", content: "", form: [] };
  }
  if (postman.mode === "urlencoded") {
    return { type: "form", content: "", form: kvList(postman.urlencoded) };
  }
  if (postman.mode === "raw") {
    const language = postman.options?.raw?.language?.toLowerCase();
    const content = postman.raw ?? "";
    const isJson =
      language === "json" ||
      content.trim().startsWith("{") ||
      content.trim().startsWith("[");
    return { type: isJson ? "json" : "text", content, form: [] };
  }
  return { type: "none", content: "", form: [] };
}

function urlFrom(url: string | PostmanUrl | undefined): {
  url: string;
  query: ExportedKv[];
} {
  if (!url) return { url: "", query: [] };
  if (typeof url === "string") return { url, query: [] };
  return { url: url.raw ?? "", query: kvList(url.query) };
}

function walkItems(
  items: PostmanItem[] | undefined,
  folderPath: string | null,
  folders: ExportedFolder[],
  requests: ExportedRequest[],
) {
  if (!items) return;
  for (const item of items) {
    const name = item.name?.trim() || "Request";
    if (item.item) {
      const path = folderPath ? `${folderPath}/${name}` : name;
      folders.push({
        name,
        parentPath: folderPath,
        sortOrder: folders.length,
      });
      walkItems(item.item, path, folders, requests);
      continue;
    }
    const raw = item.request;
    const base = {
      name,
      folderPath,
    };
    if (!raw || typeof raw === "string") {
      requests.push(
        normalizeExportedRequest(
          {
            ...base,
            method: "GET",
            url: typeof raw === "string" ? raw : "",
          },
          requests.length,
        ),
      );
      continue;
    }
    const { url, query } = urlFrom(raw.url);
    requests.push(
      normalizeExportedRequest(
        {
          ...base,
          method: raw.method,
          url,
          headers: kvList(raw.header),
          query,
          body: bodyFrom(raw.body),
          auth: authFrom(raw.auth),
        },
        requests.length,
      ),
    );
  }
}

export function parsePostmanCollection(data: unknown): ImportBundle {
  const collection = data as PostmanCollection;
  const collectionName = collection.info?.name?.trim();
  if (!collectionName) {
    throw new Error("La colección Postman no tiene nombre.");
  }
  const folders: ExportedFolder[] = [];
  const requests: ExportedRequest[] = [];
  walkItems(collection.item, null, folders, requests);
  const variables = kvList(collection.variable);
  return { collectionName, folders, requests, environments: [], collectionVariables: variables };
}
