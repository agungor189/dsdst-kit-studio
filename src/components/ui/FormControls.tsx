import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "./utils";

type FieldShellProps = { id: string; label?: ReactNode; error?: ReactNode; hint?: ReactNode; required?: boolean; className?: string; children: ReactNode };

function FieldShell({ id, label, error, hint, required, className, children }: FieldShellProps) {
  return <div className={cn("ui-field-shell", className)}>
    {label && <label htmlFor={id}>{label}{required && <span className="ui-required"> *</span>}</label>}
    {children}
    {(error || hint) && <small id={`${id}-description`} className={error ? "ui-field-error" : "ui-field-hint"}>{error || hint}</small>}
  </div>;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> { label?: ReactNode; error?: ReactNode; hint?: ReactNode; containerClassName?: string }
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ id: suppliedId, label, error, hint, containerClassName, className, required, ...props }, ref) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  return <FieldShell id={id} label={label} error={error} hint={hint} required={required} className={containerClassName}>
    <input ref={ref} id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? `${id}-description` : undefined} className={cn("ui-input", className)} {...props}/>
  </FieldShell>;
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { label?: ReactNode; error?: ReactNode; hint?: ReactNode; containerClassName?: string }
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ id: suppliedId, label, error, hint, containerClassName, className, required, children, ...props }, ref) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  return <FieldShell id={id} label={label} error={error} hint={hint} required={required} className={containerClassName}>
    <select ref={ref} id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? `${id}-description` : undefined} className={cn("ui-select", className)} {...props}>{children}</select>
  </FieldShell>;
});
