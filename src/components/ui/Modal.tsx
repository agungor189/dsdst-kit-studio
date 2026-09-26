import { X } from "lucide-react";
import { useEffect, useId, type MouseEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "./utils";

export type ModalProps = { open: boolean; onClose: () => void; title?: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string; size?: "sm" | "md" | "lg"; closeOnBackdrop?: boolean; closeOnEscape?: boolean; showCloseButton?: boolean; ariaLabel?: string };

export function Modal({ open, onClose, title, description, children, footer, className, size = "md", closeOnBackdrop = true, closeOnEscape = true, showCloseButton = true, ariaLabel }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [closeOnEscape, onClose, open]);
  if (!open) return null;
  const closeBackdrop = (event: MouseEvent<HTMLDivElement>) => { if (closeOnBackdrop && event.target === event.currentTarget) onClose(); };
  return <div className="modal-backdrop" onMouseDown={closeBackdrop}>
    <div className={cn("ui-modal", `ui-modal-${size}`, className)} role="dialog" aria-modal="true" aria-label={!title ? ariaLabel : undefined} aria-labelledby={title ? titleId : undefined} aria-describedby={description ? descriptionId : undefined}>
      {(title || description || showCloseButton) && <div className="modal-head"><div>{title && <h2 id={titleId}>{title}</h2>}{description && <p id={descriptionId}>{description}</p>}</div>{showCloseButton && <Button variant="ghost" size="sm" aria-label="Kapat" onClick={onClose}><X size={18}/></Button>}</div>}
      <div className="ui-modal-body">{children}</div>
      {footer && <div className="ui-modal-footer">{footer}</div>}
    </div>
  </div>;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Onayla", cancelLabel = "Vazgeç", destructive = false, loading = false }: { open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; title: ReactNode; description?: ReactNode; confirmLabel?: string; cancelLabel?: string; destructive?: boolean; loading?: boolean }) {
  return <Modal open={open} onClose={onClose} title={title} size="sm" closeOnBackdrop={!loading} closeOnEscape={!loading} footer={<><Button variant="secondary" disabled={loading} onClick={onClose}>{cancelLabel}</Button><Button variant={destructive ? "danger" : "primary"} loading={loading} onClick={() => void onConfirm()}>{confirmLabel}</Button></>}>
    {description && <p className="ui-confirm-description">{description}</p>}
  </Modal>;
}
