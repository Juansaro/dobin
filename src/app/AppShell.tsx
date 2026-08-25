import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HistoryView } from "@/features/history/HistoryView";
import { PlansView } from "@/features/plans/PlansView";
import { RequestWorkbench } from "@/features/request/RequestWorkbench";
import { SettingsView } from "@/features/settings/SettingsView";
import { WebhookInbox } from "@/features/webhooks/WebhookInbox";
import { CommandPalette } from "@/features/search/CommandPalette";
import { isTauri, useAppStore } from "@/store/useAppStore";
import type { WebhookEvent } from "@/core/types";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const view = useAppStore((s) => s.view);
  const ready = useAppStore((s) => s.ready);
  const error = useAppStore((s) => s.error);
  const prependWebhook = useAppStore((s) => s.prependWebhook);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen<WebhookEvent>("webhook:event", (event) => {
        prependWebhook(event.payload);
        toast.message("Webhook recibido", {
          description: `${event.payload.method} ${event.payload.path}`,
        });
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => unlisten?.();
  }, [prependWebhook]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Cargando openDobin…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-danger">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full bg-background">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {view === "request" ? <RequestWorkbench /> : null}
            {view === "webhooks" ? <WebhookInbox /> : null}
            {view === "history" ? <HistoryView /> : null}
            {view === "settings" ? <SettingsView /> : null}
            {view === "plans" ? <PlansView /> : null}
          </motion.div>
        </AnimatePresence>
      </main>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
