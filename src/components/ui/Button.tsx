import { forwardRef, type ButtonHTMLAttributes, type ForwardedRef } from "react";
import { cn } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "primary-action",
  secondary: "ui-button ui-button-secondary",
  danger: "ui-button ui-button-danger",
  ghost: "ui-button ui-button-ghost",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
}

export function ButtonPrimitive(
  { variant = "primary", size = "md", loading = false, loadingText, disabled, className, type = "button", children, ...props }: ButtonProps,
  ref: ForwardedRef<HTMLButtonElement>,
) {
  return <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cn(variants[variant], size === "sm" && "ui-button-sm", className)} {...props}>
    {loading && <span className="ui-spinner" aria-hidden="true"/>}
    {loading && loadingText ? loadingText : children}
  </button>;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(ButtonPrimitive);
