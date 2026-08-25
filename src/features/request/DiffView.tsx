import type { DiffLine } from "@/core/diff";
import { isBinaryBody, lineDiff, prettyForDiff } from "@/core/diff";

export function DiffView({
  left,
  right,
  leftEncoding,
  rightEncoding,
  leftType,
  rightType,
  emptyLabel,
}: {
  left: string | null;
  right: string;
  leftEncoding?: string | null;
  rightEncoding?: string | null;
  leftType?: string | null;
  rightType?: string | null;
  emptyLabel?: string;
}) {
  if (left == null) {
    return (
      <p className="text-sm text-muted">
        {emptyLabel ?? "Aún no hay un 200 anterior para comparar."}
      </p>
    );
  }
  const leftBin = isBinaryBody(leftEncoding, leftType);
  const rightBin = isBinaryBody(rightEncoding, rightType);
  if (leftBin || rightBin) {
    return (
      <p className="text-sm">
        {left === right ? (
          <span className="text-muted">Binario igual al anterior.</span>
        ) : (
          <span className="text-accent">Binario distinto.</span>
        )}
      </p>
    );
  }
  const lines = lineDiff(prettyForDiff(left), prettyForDiff(right));
  const changes = lines.filter((line) => line.kind !== "same").length;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted">
        {changes ? `${changes} líneas distintas` : "Sin cambios"}
      </p>
      <pre className="font-mono text-[12px] leading-5">
        {lines.map((line, index) => (
          <DiffRow key={`${index}-${line.kind}`} line={line} />
        ))}
      </pre>
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const tone =
    line.kind === "add"
      ? "bg-ok/15 text-ok"
      : line.kind === "del"
        ? "bg-danger/15 text-danger"
        : "";
  const mark = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  return (
    <div className={tone}>
      {mark} {line.text}
    </div>
  );
}
