import {
  COLLECTION_FORMAT,
  parseNativeCollection,
  type ImportBundle,
} from "./collection-io";
import { isOpenApiDocument, parseDocumentText, parseOpenApiCollection } from "./openapi";
import { isPostmanCollection, parsePostmanCollection } from "./postman";

export function parseImportedCollection(text: string): ImportBundle {
  const data = parseDocumentText(text);
  if (
    data !== null &&
    typeof data === "object" &&
    (data as { format?: string }).format === COLLECTION_FORMAT
  ) {
    return parseNativeCollection(data);
  }
  if (isPostmanCollection(data)) {
    return parsePostmanCollection(data);
  }
  if (isOpenApiDocument(data)) {
    return parseOpenApiCollection(data);
  }
  throw new Error("No es una colección openDobin, Postman v2.1 ni OpenAPI/Swagger.");
}
