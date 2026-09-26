import type { ReactNode } from "react";
import { cn } from "./utils";

export function EmptyState({ title, description, icon, action, className }: { title: ReactNode; description?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={cn("empty-state", className)}>{icon}<h2>{title}</h2>{description && <p>{description}</p>}{action}</div>;
}

export function LoadingState({ label = "Yükleniyor…", fullScreen = false, className }: { label?: ReactNode; fullScreen?: boolean; className?: string }) {
  return <div className={cn("loading", !fullScreen && "ui-loading-inline", className)} role="status"><span className="spinner" aria-hidden="true"/><span>{label}</span></div>;
}
