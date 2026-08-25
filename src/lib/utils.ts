import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function prettyBody(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    const xml = prettyXml(trimmed);
    return xml ?? raw;
  }
}

export function prettyXml(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("<")) return null;
  try {
    const doc = new DOMParser().parseFromString(trimmed, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return null;
    const serialized = new XMLSerializer().serializeToString(doc);
    return indentXml(serialized);
  } catch {
    return null;
  }
}

function indentXml(xml: string): string {
  let pad = 0;
  return xml
    .replace(/(>)(<)(\/*)/g, "$1\n$2$3")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("</")) pad = Math.max(pad - 1, 0);
      const out = `${"  ".repeat(pad)}${trimmed}`;
      if (
        trimmed.startsWith("<") &&
        !trimmed.startsWith("</") &&
        !trimmed.startsWith("<?") &&
        !trimmed.startsWith("<!") &&
        !trimmed.endsWith("/>") &&
        !trimmed.includes("</")
      ) {
        pad += 1;
      }
      return out;
    })
    .join("\n");
}

export function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const slice = bytes.subarray(i, Math.min(i + 16, bytes.length));
    const hex = [...slice]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(47);
    const ascii = [...slice]
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`${i.toString(16).padStart(8, "0")}  ${hex}  ${ascii}`);
  }
  return lines.join("\n") || "(vacío)";
}

export function bodyBytes(body: string, encoding: string): Uint8Array {
  if (encoding === "base64") {
    try {
      const bin = atob(body);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return new TextEncoder().encode(body);
    }
  }
  return new TextEncoder().encode(body);
}

export function filenameFromDisposition(
  headers: [string, string][],
  fallback = "response.bin",
): string {
  const raw = headers.find(([k]) => k.toLowerCase() === "content-disposition")?.[1];
  const match = raw?.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
  return match?.[1]?.trim().replace(/"/g, "") || fallback;
}

export function statusTone(status: number | null): string {
  if (!status) return "text-muted";
  if (status >= 200 && status < 300) return "text-ok";
  if (status >= 300 && status < 400) return "text-accent";
  return "text-danger";
}

export function methodTone(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-ok";
    case "POST":
      return "text-accent";
    case "PUT":
      return "text-sky-400";
    case "PATCH":
      return "text-violet-400";
    case "DELETE":
      return "text-danger";
    default:
      return "text-muted";
  }
}
