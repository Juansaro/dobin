import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/ui/button";
import { methodTone, statusTone } from "@/lib/utils";

export function HistoryView() {
  const history = useAppStore((s) => s.history);
  const loadHistory = useAppStore((s) => s.loadHistory);
  const clearHistory = useAppStore((s) => s.clearHistory);
  const replayHistory = useAppStore((s) => s.replayHistory);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold">Historial</h1>
        <Button size="sm" variant="ghost" onClick={() => void clearHistory()}>
          <Trash2 className="h-3.5 w-3.5" />
          Vaciar
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {history.length === 0 ? (
          <p className="p-4 text-sm text-muted">Aún no hay ejecuciones.</p>
        ) : (
          history.map((entry) => (
            <button
              key={entry.id}
              onClick={() => replayHistory(entry)}
              className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left hover:bg-panel-2"
            >
              <span className={`w-14 font-mono text-[11px] ${methodTone(entry.method)}`}>
                {entry.method}
              </span>
              <span className={`w-10 font-mono text-[11px] ${statusTone(entry.status)}`}>
                {entry.status ?? "—"}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                {entry.url}
              </span>
              <span className="text-[11px] text-muted">
                {entry.durationMs ?? 0} ms
              </span>
              <span className="text-[11px] text-muted">
                {new Date(entry.at).toLocaleString()}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
