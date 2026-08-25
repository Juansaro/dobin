import { AnimatePresence, motion } from "motion/react";
import {
  bodyBytes,
  filenameFromDisposition,
  hexDump,
  prettyBody,
  statusTone,
} from "@/lib/utils";
import type { AssertionResult, HttpSendResult, ResponseSnapshot, Timings } from "@/core/types";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { DiffView } from "./DiffView";

type Tab = "pretty" | "raw" | "hex" | "headers" | "timings" | "diff";

export function ResponsePanel({
  result,
  sending,
  assertionResults,
  previousSnapshot,
  label,
}: {
  result: HttpSendResult | null;
  sending: boolean;
  assertionResults: AssertionResult[];
  previousSnapshot?: ResponseSnapshot | null;
  label?: string;
}) {
  const [tab, setTab] = useState<Tab>("pretty");
  const bytes = useMemo(
    () => (result ? bodyBytes(result.body, result.bodyEncoding ?? "utf8") : null),
    [result],
  );
  const textBody = useMemo(() => {
    if (!result || !bytes) return "";
    if (result.bodyEncoding === "base64") {
      try {
        return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      } catch {
        return result.body;
      }
    }
    return result.body;
  }, [result, bytes]);
  const contentType = result?.contentType ?? "";
  const isImage = contentType.startsWith("image/") && bytes;
  const imageUrl = useMemo(() => {
    if (!isImage || !bytes || !result) return null;
    const blob = new Blob([bytes], { type: contentType });
    return URL.createObjectURL(blob);
  }, [isImage, bytes, result, contentType]);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  function download() {
    if (!result || !bytes) return;
    const blob = new Blob([bytes], {
      type: contentType || "application/octet-stream",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filenameFromDisposition(result.headers);
    a.click();
    URL.revokeObjectURL(href);
  }

  const passed = assertionResults.filter((item) => item.passed).length;

  return (
    <section className="flex min-h-[220px] flex-1 flex-col border-t border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className="text-muted">{label ?? "Respuesta"}</span>
          {result?.status ? (
            <span className={statusTone(result.status)}>
              {result.status} {result.statusText}
            </span>
          ) : null}
          {result ? (
            <span className="text-muted">{result.durationMs} ms</span>
          ) : null}
          {result?.truncated ? (
            <span className="text-accent">truncado</span>
          ) : null}
          {assertionResults.length ? (
            <span className={passed === assertionResults.length ? "text-ok" : "text-danger"}>
              {passed}/{assertionResults.length} tests
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {(["pretty", "raw", "hex", "headers", "timings", "diff"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-md px-2 py-1 text-xs capitalize ${
                tab === id ? "bg-panel-2 text-foreground" : "text-muted"
              }`}
            >
              {id === "diff" ? "Diff" : id}
            </button>
          ))}
          {result ? (
            <Button size="sm" variant="ghost" onClick={download}>
              Descargar
            </Button>
          ) : null}
        </div>
      </div>
      {assertionResults.length ? (
        <div className="flex flex-wrap gap-2 border-b border-line px-3 py-1.5 text-[11px]">
          {assertionResults.map((item) => (
            <span
              key={item.id}
              className={item.passed ? "text-ok" : "text-danger"}
            >
              {item.passed ? "OK" : "FAIL"} · {item.message}
            </span>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-3" data-selectable>
        <AnimatePresence mode="wait">
          {sending ? (
            <motion.p
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-sm text-muted"
            >
              Enviando…
            </motion.p>
          ) : result ? (
            <motion.div
              key="body"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              {result.error && !result.ok ? (
                <p className="text-sm text-danger">{result.error}</p>
              ) : tab === "headers" ? (
                <pre className="font-mono text-[12px] leading-5">
                  {result.headers.map(([k, v]) => `${k}: ${v}`).join("\n") ||
                    "Sin headers"}
                </pre>
              ) : tab === "timings" ? (
                <TimingsView timings={result.timings} />
              ) : tab === "diff" ? (
                <DiffView
                  left={previousSnapshot?.body ?? null}
                  right={textBody}
                  leftEncoding={previousSnapshot?.encoding}
                  rightEncoding={result.bodyEncoding}
                  leftType={previousSnapshot?.contentType}
                  rightType={result.contentType}
                />
              ) : tab === "hex" ? (
                <pre className="font-mono text-[12px] leading-5">
                  {bytes ? hexDump(bytes) : ""}
                </pre>
              ) : tab === "raw" ? (
                <pre className="font-mono text-[12px] leading-5">{textBody}</pre>
              ) : (
                <div className="space-y-3">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt="Respuesta"
                      className="max-h-64 max-w-full rounded-md border border-line"
                    />
                  ) : null}
                  <pre className="font-mono text-[12px] leading-5">
                    {prettyBody(textBody)}
                  </pre>
                </div>
              )}
            </motion.div>
          ) : (
            <p className="text-sm text-muted">La respuesta aparecerá aquí</p>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function TimingsView({ timings }: { timings?: Timings | null }) {
  if (!timings) {
    return <p className="text-sm text-muted">Sin timings</p>;
  }
  const rows: [string, number | null][] = [
    ["DNS", timings.dnsMs],
    ["TCP", timings.tcpMs],
    ["TLS", timings.tlsMs],
    ["TTFB", timings.ttfbMs],
    ["Total", timings.totalMs],
  ];
  return (
    <div className="grid max-w-sm grid-cols-2 gap-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 rounded-md bg-panel-2 px-3 py-2">
          <span className="text-muted">{label}</span>
          <span className="font-mono">{value == null ? "—" : `${value} ms`}</span>
        </div>
      ))}
    </div>
  );
}
