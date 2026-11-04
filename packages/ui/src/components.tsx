import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type ButtonTone = "primary" | "secondary" | "lime" | "quiet";

export function Button({ tone = "primary", className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return <button className={`sp-button sp-button--${tone} ${className}`.trim()} {...props}>{children}</button>;
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`sp-input ${className}`.trim()} {...props} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "lime" | "blue" | "amber" | "danger"; children: ReactNode }) {
  return <span className={`sp-badge sp-badge--${tone}`}>{children}</span>;
}

export function EmptyState({ label, title, children, action }: { label: string; title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="sp-empty-state"><p className="eyebrow">{label}</p><h2>{title}</h2><div className="sp-empty-state__copy">{children}</div>{action && <div className="sp-empty-state__action">{action}</div>}</section>;
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return <div className="sp-loading-state" role="status"><span aria-hidden /><p className="eyebrow">{label}</p><span className="sr-only">Loading</span></div>;
}

export function ErrorState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="sp-error-state" role="alert"><p className="eyebrow">Connection state</p><h2>{title}</h2><div>{children}</div></section>;
}
