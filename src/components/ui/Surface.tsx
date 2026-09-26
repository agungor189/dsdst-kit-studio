import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

export interface CardProps extends HTMLAttributes<HTMLElement> { as?: "div" | "section" | "article" | "aside" | "form" }
export function Card({ as: Component = "div", className, ...props }: CardProps) {
  return <Component className={cn("card", className)} {...props}/>;
}

export type BadgeVariant = "default" | "success" | "warning" | "danger";
export function Badge({ variant = "default", className, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return <span className={cn("ui-badge", `ui-badge-${variant}`, className)} {...props}/>;
}

export type PageHeaderProps = { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string };
export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return <div className={cn("page-title", className)}><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="ui-page-actions">{actions}</div>}</div>;
}
