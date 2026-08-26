import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="opendobin-modal-title"
        className="relative z-10 w-[min(520px,calc(100%-2rem))] rounded-xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="opendobin-modal-title" className="text-sm font-semibold">
            {title}
          </h2>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
        {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function PromptDialog({
  open,
  title,
  defaultValue,
  confirmLabel = "Confirmar",
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  defaultValue: string;
  confirmLabel?: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (!open) return;
    setValue(defaultValue);
  }, [open, defaultValue]);

  function confirm() {
    const next = value.trim();
    if (!next) return;
    onSubmit(next);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!value.trim()} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Borrar",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  );
}
