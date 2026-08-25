import { Copy, Radio, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { isTauri, useAppStore } from "@/store/useAppStore";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { methodTone, prettyBody } from "@/lib/utils";
import { toast } from "sonner";
import { Features, getEntitlements } from "@/core/entitlements";
import { replayUrl } from "@/core/replay";
import { Modal } from "@/ui/badge";

export function WebhookInbox() {
  const status = useAppStore((s) => s.webhookStatus);
  const events = useAppStore((s) => s.webhookEvents);
  const startWebhook = useAppStore((s) => s.startWebhook);
  const stopWebhook = useAppStore((s) => s.stopWebhook);
  const startTunnel = useAppStore((s) => s.startTunnel);
  const stopTunnel = useAppStore((s) => s.stopTunnel);
  const loadWebhooks = useAppStore((s) => s.loadWebhooks);
  const clearWebhooks = useAppStore((s) => s.clearWebhooks);
  const replayWebhook = useAppStore((s) => s.replayWebhook);
  const collections = useAppStore((s) => s.collections);
  const draft = useAppStore((s) => s.draft);
  const plan = useAppStore((s) => s.plan);
  const setView = useAppStore((s) => s.setView);
  const [port, setPort] = useState(9080);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = events.find((e) => e.id === selectedId) ?? events[0];
  const canTunnel = getEntitlements(plan).can(Features.WebhooksPublicTunnel);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayUrlValue, setReplayUrlValue] = useState("");
  const [replayCollection, setReplayCollection] = useState("");
  const [createNew, setCreateNew] = useState(true);
  const [sendNow, setSendNow] = useState(false);

  useEffect(() => {
    void loadWebhooks();
  }, [loadWebhooks]);

  async function copyText(value: string, label: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success(label);
  }

  function openReplay() {
    if (!selected) return;
    setReplayUrlValue(replayUrl(selected.path, selected.query));
    setReplayCollection(
      draft?.collectionId ?? collections[0]?.id ?? "",
    );
    setCreateNew(true);
    setSendNow(false);
    setReplayOpen(true);
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
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md bg-background px-2 py-1 font-mono text-[11px]">
                      {status.url}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void copyText(status.url, "URL local copiada")}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  {canTunnel ? (
                    <>
                      <p className="text-[11px] text-accent">
                        El túnel público expone este inbox a internet. Úsalo solo
                        para pruebas.
                      </p>
                      {status.tunnelRunning ? (
                        <div className="flex items-center gap-2">
                          <code className="flex-1 truncate rounded-md bg-background px-2 py-1 font-mono text-[11px]">
                            {status.publicUrl
                              ? `${status.publicUrl}/hook`
                              : "Túnel activo"}
                          </code>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              void copyText(
                                status.publicUrl
                                  ? `${status.publicUrl}/hook`
                                  : "",
                                "URL pública copiada",
                              )
                            }
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void stopTunnel()}
                          >
                            Cerrar túnel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void startTunnel().catch((err: Error) =>
                              toast.error(err.message),
                            )
                          }
                        >
                          Abrir túnel público
                        </Button>
                      )}
                      {status.tunnelError ? (
                        <p className="text-[11px] text-danger">{status.tunnelError}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-[11px] text-muted">
                      Túnel público (Pro).{" "}
                      <button
                        className="text-accent underline"
                        onClick={() => setView("plans")}
                      >
                        Activar Pro (dev)
                      </button>
                    </p>
                  )}
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-muted">Payload</div>
                <h2 className="font-mono text-sm">
                  {selected.method} {selected.path}
                  {selected.query ? `?${selected.query}` : ""}
                </h2>
              </div>
              <Button size="sm" variant="outline" onClick={openReplay}>
                Reenviar a mi API
              </Button>
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
      <Modal
        open={replayOpen}
        title="Reenviar a mi API"
        onClose={() => setReplayOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReplayOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!selected || !replayCollection) {
                  toast.error("Elige una colección");
                  return;
                }
                void replayWebhook(selected, {
                  collectionId: replayCollection,
                  url: replayUrlValue,
                  createNew,
                  sendNow,
                })
                  .then(() => {
                    setReplayOpen(false);
                    toast.success(
                      sendNow ? "Request creado y enviado" : "Request listo en el workbench",
                    );
                  })
                  .catch((err: Error) => toast.error(err.message));
              }}
            >
              {sendNow ? "Crear y enviar" : "Crear request"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1 text-xs">
            URL destino
            <Input
              className="font-mono"
              value={replayUrlValue}
              onChange={(e) => setReplayUrlValue(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs">
            Colección
            <select
              value={replayCollection}
              onChange={(e) => setReplayCollection(e.target.value)}
              className="h-8 w-full rounded-md border border-line bg-background px-2 text-sm"
            >
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-accent"
              checked={createNew}
              onChange={(e) => setCreateNew(e.target.checked)}
            />
            Crear request nuevo (si no, rellena el draft actual)
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-accent"
              checked={sendNow}
              onChange={(e) => setSendNow(e.target.checked)}
            />
            Enviar ahora
          </label>
        </div>
      </Modal>
    </div>
  );
}
