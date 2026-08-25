import { Copy, Radio, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { isTauri, useAppStore } from "@/store/useAppStore";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { methodTone, prettyBody } from "@/lib/utils";
import { toast } from "sonner";

export function WebhookInbox() {
  const status = useAppStore((s) => s.webhookStatus);
  const events = useAppStore((s) => s.webhookEvents);
  const startWebhook = useAppStore((s) => s.startWebhook);
  const stopWebhook = useAppStore((s) => s.stopWebhook);
  const loadWebhooks = useAppStore((s) => s.loadWebhooks);
  const clearWebhooks = useAppStore((s) => s.clearWebhooks);
  const [port, setPort] = useState(9080);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = events.find((e) => e.id === selectedId) ?? events[0];

  useEffect(() => {
    void loadWebhooks();
  }, [loadWebhooks]);

  async function copyUrl() {
    if (!status.url) return;
    await navigator.clipboard.writeText(status.url);
    toast.success("URL copiada");
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[340px] flex-col border-r border-line">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-center gap-2">
            <Radio className={`h-4 w-4 ${status.running ? "text-ok" : "text-muted"}`} />
            <h1 className="text-sm font-semibold">Inbox de webhooks</h1>
          </div>
          {!isTauri() ? (
            <p className="text-xs text-muted">
              El servidor local solo corre en la app de escritorio Tauri.
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value) || 9080)}
                  disabled={status.running}
                />
                {status.running ? (
                  <Button variant="outline" onClick={() => void stopWebhook()}>
                    Parar
                  </Button>
                ) : (
                  <Button
                    onClick={() =>
                      void startWebhook(port).catch((err: Error) =>
                        toast.error(err.message),
                      )
                    }
                  >
                    Arrancar
                  </Button>
                )}
              </div>
              {status.running ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md bg-background px-2 py-1 font-mono text-[11px]">
                    {status.url}
                  </code>
                  <Button size="icon" variant="ghost" onClick={() => void copyUrl()}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs text-muted">{events.length} eventos</span>
          <Button size="sm" variant="ghost" onClick={() => void clearWebhooks()}>
            <Trash2 className="h-3.5 w-3.5" />
            Vaciar
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {events.map((event) => (
            <button
              key={event.id}
              onClick={() => setSelectedId(event.id)}
              className={`block w-full border-b border-line px-3 py-2 text-left ${
                selected?.id === event.id ? "bg-panel-2" : "hover:bg-panel-2/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[11px] ${methodTone(event.method)}`}>
                  {event.method}
                </span>
                <span className="truncate text-[13px]">{event.path}</span>
              </div>
              <div className="text-[11px] text-muted">
                {new Date(event.at).toLocaleTimeString()}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-auto p-5" data-selectable>
        {selected ? (
          <motion.div
            key={selected.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div>
              <div className="text-xs text-muted">Payload</div>
              <h2 className="font-mono text-sm">
                {selected.method} {selected.path}
                {selected.query ? `?${selected.query}` : ""}
              </h2>
            </div>
            <div>
              <h3 className="mb-1 text-xs uppercase text-muted">Headers</h3>
              <pre className="rounded-md bg-background p-3 font-mono text-[12px]">
                {selected.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}
              </pre>
            </div>
            <div>
              <h3 className="mb-1 text-xs uppercase text-muted">Body</h3>
              <pre className="rounded-md bg-background p-3 font-mono text-[12px]">
                {prettyBody(selected.body) || "—"}
              </pre>
            </div>
          </motion.div>
        ) : (
          <p className="text-sm text-muted">
            Arranca el inbox y envía un POST a la URL para ver el payload.
          </p>
        )}
      </div>
    </div>
  );
}
