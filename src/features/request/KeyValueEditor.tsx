import type { KvRow } from "@/core/types";
import { emptyKv } from "@/core/types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Plus, Trash2 } from "lucide-react";

export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder = "Clave",
  valuePlaceholder = "Valor",
  allowSecret = false,
}: {
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  allowSecret?: boolean;
}) {
  const list = rows.length ? rows : [emptyKv()];

  function update(id: string, patch: Partial<KvRow>) {
    const next = list.map((row) => (row.id === id ? { ...row, ...patch } : row));
    const last = next[next.length - 1];
    if (last && (last.key || last.value)) next.push(emptyKv());
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {list.map((row) => (
        <div key={row.id} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => update(row.id, { enabled: e.target.checked })}
            className="accent-accent"
          />
          <Input
            value={row.key}
            placeholder={keyPlaceholder}
            onChange={(e) => update(row.id, { key: e.target.value })}
          />
          <Input
            type={row.secret ? "password" : "text"}
            value={row.value}
            placeholder={valuePlaceholder}
            onChange={(e) => update(row.id, { value: e.target.value })}
          />
          {allowSecret ? (
            <label className="flex items-center gap-1 text-[11px] text-muted">
              <input
                type="checkbox"
                className="accent-accent"
                checked={Boolean(row.secret)}
                onChange={(e) => update(row.id, { secret: e.target.checked })}
              />
              secreto
            </label>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onChange(list.filter((r) => r.id !== row.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => onChange([...list, emptyKv()])}
      >
        <Plus className="h-3.5 w-3.5" />
        Añadir
      </Button>
    </div>
  );
}
