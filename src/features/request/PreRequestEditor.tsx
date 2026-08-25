import type { PreStep, PreStepKind, PreStepScope } from "@/core/types";
import { emptyPreStep } from "@/core/types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Trash2 } from "lucide-react";

export function PreRequestEditor({
  steps,
  onChange,
}: {
  steps: PreStep[];
  onChange: (steps: PreStep[]) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Se ejecutan antes de enviar. Puedes usar {"{{$timestamp}}"}, {"{{$guid}}"} y{" "}
        {"{{$nonce}}"} también en URL y headers.
      </p>
      {steps.map((step) => (
        <div
          key={step.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2"
        >
          <input
            type="checkbox"
            className="accent-accent"
            checked={step.enabled}
            onChange={(e) =>
              onChange(
                steps.map((item) =>
                  item.id === step.id ? { ...item, enabled: e.target.checked } : item,
                ),
              )
            }
          />
          <select
            className="h-8 rounded-md border border-line bg-background px-2 text-xs"
            value={step.kind}
            onChange={(e) =>
              onChange(
                steps.map((item) =>
                  item.id === step.id
                    ? {
                        ...emptyPreStep(e.target.value as PreStepKind),
                        id: item.id,
                        enabled: item.enabled,
                        scope: item.scope,
                        key: item.key,
                      }
                    : item,
                ),
              )
            }
          >
            <option value="set">set</option>
            <option value="timestamp">timestamp</option>
            <option value="nonce">nonce</option>
          </select>
          <select
            className="h-8 rounded-md border border-line bg-background px-2 text-xs"
            value={step.scope}
            onChange={(e) =>
              onChange(
                steps.map((item) =>
                  item.id === step.id
                    ? { ...item, scope: e.target.value as PreStepScope }
                    : item,
                ),
              )
            }
          >
            <option value="environment">entorno</option>
            <option value="collection">colección</option>
            <option value="global">global</option>
          </select>
          <Input
            className="w-36"
            placeholder="Clave"
            value={step.key}
            onChange={(e) =>
              onChange(
                steps.map((item) =>
                  item.id === step.id ? { ...item, key: e.target.value } : item,
                ),
              )
            }
          />
          {step.kind === "set" ? (
            <Input
              className="min-w-[160px] flex-1"
              placeholder="Valor o {{var}}"
              value={step.value}
              onChange={(e) =>
                onChange(
                  steps.map((item) =>
                    item.id === step.id ? { ...item, value: e.target.value } : item,
                  ),
                )
              }
            />
          ) : null}
          {step.kind === "timestamp" ? (
            <select
              className="h-8 rounded-md border border-line bg-background px-2 text-xs"
              value={step.format || "iso"}
              onChange={(e) =>
                onChange(
                  steps.map((item) =>
                    item.id === step.id ? { ...item, format: e.target.value } : item,
                  ),
                )
              }
            >
              <option value="iso">ISO</option>
              <option value="epoch">epoch</option>
            </select>
          ) : null}
          {step.kind === "nonce" ? (
            <select
              className="h-8 rounded-md border border-line bg-background px-2 text-xs"
              value={step.format || "hex"}
              onChange={(e) =>
                onChange(
                  steps.map((item) =>
                    item.id === step.id ? { ...item, format: e.target.value } : item,
                  ),
                )
              }
            >
              <option value="hex">hex</option>
              <option value="uuid">uuid</option>
            </select>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onChange(steps.filter((item) => item.id !== step.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...steps, emptyPreStep("set")])}
        >
          Set
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...steps, emptyPreStep("timestamp")])}
        >
          Timestamp
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...steps, emptyPreStep("nonce")])}
        >
          Nonce
        </Button>
      </div>
    </div>
  );
}
