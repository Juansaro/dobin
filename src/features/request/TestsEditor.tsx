import type { Assertion, AssertionKind, AssertionOp } from "@/core/types";
import { emptyAssertion } from "@/core/types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Trash2 } from "lucide-react";

export function TestsEditor({
  tests,
  onChange,
}: {
  tests: Assertion[];
  onChange: (tests: Assertion[]) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Reglas sin código. Se evalúan después de enviar. Un fail no cancela la respuesta.
      </p>
      {tests.map((test) => (
        <div
          key={test.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2"
        >
          <input
            type="checkbox"
            className="accent-accent"
            checked={test.enabled}
            onChange={(e) =>
              onChange(
                tests.map((item) =>
                  item.id === test.id ? { ...item, enabled: e.target.checked } : item,
                ),
              )
            }
          />
          <select
            className="h-8 rounded-md border border-line bg-background px-2 text-xs"
            value={test.kind}
            onChange={(e) => {
              const kind = e.target.value as AssertionKind;
              onChange(
                tests.map((item) =>
                  item.id === test.id
                    ? { ...emptyAssertion(kind), id: item.id, enabled: item.enabled }
                    : item,
                ),
              );
            }}
          >
            <option value="status">Status</option>
            <option value="header">Header</option>
            <option value="jsonpath">JSONPath</option>
          </select>
          {test.kind === "status" ? (
            <>
              <select
                className="h-8 rounded-md border border-line bg-background px-2 text-xs"
                value={test.op}
                onChange={(e) =>
                  onChange(
                    tests.map((item) =>
                      item.id === test.id
                        ? { ...item, op: e.target.value as AssertionOp }
                        : item,
                    ),
                  )
                }
              >
                <option value="eq">igual a</option>
                <option value="inRange">rango</option>
              </select>
              {test.op === "inRange" ? (
                <>
                  <Input
                    className="w-20"
                    type="number"
                    value={test.min}
                    onChange={(e) =>
                      onChange(
                        tests.map((item) =>
                          item.id === test.id
                            ? { ...item, min: Number(e.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                  <Input
                    className="w-20"
                    type="number"
                    value={test.max}
                    onChange={(e) =>
                      onChange(
                        tests.map((item) =>
                          item.id === test.id
                            ? { ...item, max: Number(e.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                </>
              ) : (
                <Input
                  className="w-24"
                  value={test.expected}
                  onChange={(e) =>
                    onChange(
                      tests.map((item) =>
                        item.id === test.id
                          ? { ...item, expected: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
              )}
            </>
          ) : null}
          {test.kind === "header" ? (
            <>
              <Input
                className="w-36"
                placeholder="Nombre"
                value={test.headerName}
                onChange={(e) =>
                  onChange(
                    tests.map((item) =>
                      item.id === test.id
                        ? { ...item, headerName: e.target.value }
                        : item,
                    ),
                  )
                }
              />
              <select
                className="h-8 rounded-md border border-line bg-background px-2 text-xs"
                value={test.op}
                onChange={(e) =>
                  onChange(
                    tests.map((item) =>
                      item.id === test.id
                        ? { ...item, op: e.target.value as AssertionOp }
                        : item,
                    ),
                  )
                }
              >
                <option value="exists">existe</option>
                <option value="eq">igual a</option>
              </select>
              {test.op === "eq" ? (
                <Input
                  className="w-40"
                  placeholder="Valor"
                  value={test.expected}
                  onChange={(e) =>
                    onChange(
                      tests.map((item) =>
                        item.id === test.id
                          ? { ...item, expected: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
              ) : null}
            </>
          ) : null}
          {test.kind === "jsonpath" ? (
            <>
              <Input
                className="w-40"
                placeholder="$.id"
                value={test.path}
                onChange={(e) =>
                  onChange(
                    tests.map((item) =>
                      item.id === test.id ? { ...item, path: e.target.value } : item,
                    ),
                  )
                }
              />
              <select
                className="h-8 rounded-md border border-line bg-background px-2 text-xs"
                value={test.op}
                onChange={(e) =>
                  onChange(
                    tests.map((item) =>
                      item.id === test.id
                        ? { ...item, op: e.target.value as AssertionOp }
                        : item,
                    ),
                  )
                }
              >
                <option value="exists">existe</option>
                <option value="eq">igual a</option>
                <option value="contains">contiene</option>
              </select>
              {test.op !== "exists" ? (
                <Input
                  className="w-40"
                  placeholder="Valor"
                  value={test.expected}
                  onChange={(e) =>
                    onChange(
                      tests.map((item) =>
                        item.id === test.id
                          ? { ...item, expected: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
              ) : null}
            </>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onChange(tests.filter((item) => item.id !== test.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...tests, emptyAssertion("status")])}
        >
          Status
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...tests, emptyAssertion("header")])}
        >
          Header
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...tests, emptyAssertion("jsonpath")])}
        >
          JSONPath
        </Button>
      </div>
    </div>
  );
}
