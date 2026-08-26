import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-muted",
        className,
      )}
      {...props}
    />
  );
}
