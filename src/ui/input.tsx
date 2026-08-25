import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-line bg-background px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent/70",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-line bg-background p-2.5 font-mono text-[12.5px] text-foreground outline-none placeholder:text-muted focus:border-accent/70",
        className,
      )}
      {...props}
    />
  );
}
