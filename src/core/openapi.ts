import { parse as parseYaml } from "yaml";
import { emptyAuth } from "./types";
import type {
  ExportedFolder,
  ExportedRequest,
  ImportBundle,
} from "./collection-io";
import { normalizeExportedRequest } from "./collection-io";

type Json = Record<string, unknown>;

export function isOpenApiDocument(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const doc = data as Json;
  return typeof doc.openapi === "string" || typeof doc.swagger === "string";
}

export function parseDocumentText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return parseYaml(text);
  }
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function exampleBody(operation: Json): { type: "json" | "none"; content: string } {
  const body = operation.requestBody as Json | undefined;
  const content = (body?.content as Json | undefined) ?? {};
  const json = (content["application/json"] as Json | undefined) ?? {};
  const example =
    json.example ??
    (json.examples as Json | undefined)?.[
      Object.keys((json.examples as Json | undefined) ?? {})[0] ?? ""
    ];
  const value =
    example && typeof example === "object" && "value" in (example as Json)
      ? (example as Json).value
      : example;
  if (value == null) return { type: "none", content: "" };
  try {
    return { type: "json", content: JSON.stringify(value, null, 2) };
  } catch {
    return { type: "none", content: "" };
  }
}

function authFromSpec(doc: Json): ReturnType<typeof emptyAuth> {
  const components = (doc.components as Json | undefined) ?? {};
  const schemes = (components.securitySchemes as Json | undefined) ?? {};
  const first = Object.values(schemes)[0] as Json | undefined;
  if (!first) {
    const swaggerSecurity = (doc.securityDefinitions as Json | undefined) ?? {};
    const legacy = Object.values(swaggerSecurity)[0] as Json | undefined;
    if (!legacy) return emptyAuth();
    return authFromScheme(legacy);
  }
  return authFromScheme(first);
}

function authFromScheme(scheme: Json) {
  const type = str(scheme.type).toLowerCase();
  if (type === "apikey") {
    return {
      ...emptyAuth(),
      type: "apikey" as const,
      keyName: str(scheme.name, "X-Api-Key"),
      apiKeyIn: str(scheme.in) === "query" ? ("query" as const) : ("header" as const),
    };
  }
  if (type === "http" && str(scheme.scheme).toLowerCase() === "bearer") {
    return { ...emptyAuth(), type: "bearer" as const };
  }
  if (type === "oauth2") {
    const flows = (scheme.flows as Json | undefined) ?? {};
    const cc = (flows.clientCredentials as Json | undefined) ?? {};
    const ac =
      (flows.authorizationCode as Json | undefined) ??
      (scheme.authorizationCode as Json | undefined) ??
      {};
    const grant = Object.keys(cc).length
      ? ("client_credentials" as const)
      : ("authorization_code" as const);
    return {
      ...emptyAuth(),
      type: "oauth2" as const,
      grant,
      tokenUrl: str(cc.tokenUrl || ac.tokenUrl || scheme.tokenUrl),
      authorizeUrl: str(ac.authorizationUrl || scheme.authorizationUrl),
    };
  }
  return emptyAuth();
}

export function parseOpenApiCollection(data: unknown): ImportBundle {
  const doc = data as Json;
  const info = (doc.info as Json | undefined) ?? {};
  const collectionName = str(info.title, "OpenAPI");
  const servers = (doc.servers as Json[] | undefined) ?? [];
  const swaggerHost = str(doc.host);
  const swaggerBase = str(doc.basePath);
  const swaggerSchemes = (doc.schemes as string[] | undefined) ?? ["https"];
  const baseUrl = servers[0]
    ? str((servers[0] as Json).url, "https://api.example.com")
    : swaggerHost
      ? `${swaggerSchemes[0]}://${swaggerHost}${swaggerBase}`
      : "https://api.example.com";

  const paths = (doc.paths as Json | undefined) ?? {};
  const folders: ExportedFolder[] = [];
  const folderNames = new Set<string>();
  const requests: ExportedRequest[] = [];
  const methods = ["get", "post", "put", "patch", "delete", "head", "options"];
  const defaultAuth = authFromSpec(doc);

  for (const [path, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== "object") continue;
    const operations = ops as Json;
    for (const method of methods) {
      const operation = operations[method];
      if (!operation || typeof operation !== "object") continue;
      const op = operation as Json;
      const tags = (op.tags as string[] | undefined) ?? [];
      const tag = tags[0];
      if (tag && !folderNames.has(tag)) {
        folderNames.add(tag);
        folders.push({ name: tag, parentPath: null, sortOrder: folders.length });
      }
      const body = exampleBody(op);
      requests.push(
        normalizeExportedRequest(
          {
            name: str(op.summary || op.operationId, `${method.toUpperCase()} ${path}`),
            method: method.toUpperCase(),
            url: `{{baseUrl}}${path}`,
            body: body.type === "json" ? { type: "json", content: body.content, form: [] } : undefined,
            auth: defaultAuth,
            folderPath: tag ?? null,
          },
          requests.length,
        ),
      );
    }
  }

  return {
    collectionName,
    folders,
    requests,
    collectionVariables: [],
    environments: [
      {
        name: "OpenAPI",
        variables: [
          { key: "baseUrl", value: baseUrl.replace(/\/$/, ""), enabled: true },
        ],
        isActive: false,
      },
    ],
  };
}
