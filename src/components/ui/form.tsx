import * as React from "react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="label-base">
        {label} {required ? <span className="text-status-danger">*</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
      {error ? (
        <p className="text-xs font-medium text-status-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn("input-base", className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn("input-base min-h-[96px]", className)} {...props} />;
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn("input-base pr-8", className)} {...props}>
        {children}
      </select>
    );
  },
);

export function Checkbox({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" className="h-4 w-4 rounded border-surface-border text-brand-600 focus:ring-brand-500" {...props} />
      {label}
    </label>
  );
}
