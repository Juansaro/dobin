import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { methodTone } from "@/lib/utils";

function fuzzy(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return true;
  return n.split(/\s+/).every((part) => h.includes(part));
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const requests = useAppStore((s) => s.requests);
  const collections = useAppStore((s) => s.collections);
  const folders = useAppStore((s) => s.folders);
  const selectRequest = useAppStore((s) => s.selectRequest);
  const setView = useAppStore((s) => s.setView);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const mapped = requests.map((request) => {
      const collection =
        collections.find((item) => item.id === request.collectionId)?.name ?? "";
      const folder =
        folders.find((item) => item.id === request.folderId)?.name ?? "";
      const label = `${request.method} ${request.name} ${request.url} ${collection} ${folder}`;
      return { request, collection, folder, label };
    });
    return mapped.filter((item) => fuzzy(item.label, query)).slice(0, 30);
  }, [requests, collections, folders, query]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  if (!open) return null;

  function go(index: number) {
    const item = items[index];
    if (!item) return;
    selectRequest(item.request.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <button
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Cerrar paleta"
      />
      <div className="relative z-10 w-[min(560px,calc(100%-2rem))] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar request, URL, colección…"
          className="h-11 w-full border-b border-line bg-transparent px-4 text-sm outline-none"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              go(active);
            }
          }}
        />
        <div className="max-h-[360px] overflow-auto py-1">
          {items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Sin coincidencias</p>
          ) : (
            items.map((item, index) => (
              <button
                key={item.request.id}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                  index === active ? "bg-panel-2" : "hover:bg-panel-2/70"
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(index)}
              >
                <span
                  className={`w-12 shrink-0 font-mono text-[10px] ${methodTone(item.request.method)}`}
                >
                  {item.request.method}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.request.name}</span>
                <span className="max-w-[40%] truncate font-mono text-[11px] text-muted">
                  {item.request.url}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2 text-[11px] text-muted">
          <span>Ctrl+Enter envía</span>
          <span>Ctrl+S guarda</span>
          <button className="hover:text-foreground" onClick={() => { setView("settings"); onClose(); }}>
            Ajustes
          </button>
          <button className="hover:text-foreground" onClick={() => { setView("history"); onClose(); }}>
            Historial
          </button>
          <button className="hover:text-foreground" onClick={() => { setView("webhooks"); onClose(); }}>
            Webhooks
          </button>
        </div>
      </div>
    </div>
  );
}
