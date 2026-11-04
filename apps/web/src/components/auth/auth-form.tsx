"use client";

import { AUTH_LIMITS, parseLoginInput, parseRegisterInput, validateEmail, validateName, validatePassword } from "@scopepilot/contracts/auth";
import { Button, TextInput } from "@scopepilot/ui/components";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { ApiError, authApi } from "@/lib/api-client";
import styles from "./auth.module.css";

type Mode = "login" | "register";
type Field = "name" | "email" | "password";

export function describeAuthError(error: unknown, mode: Mode): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const wait = error.retryAfterSeconds ? ` Try again in about ${Math.max(1, Math.ceil(error.retryAfterSeconds / 60))} minute(s).` : " Try again later.";
      return `Too many attempts.${wait}`;
    }
    if (error.status === 401) return mode === "login"
      ? "Email or password is incorrect."
      : "Your account could not be signed in with these details. If you already have an account with this email, sign in with its existing password.";
    if (error.status === 400) return error.message;
    if (error.status === 403) return "This request was blocked because it did not come from the ScopePilot site. Reload the page and try again.";
    if (error.status === 0 || error.status >= 500) return "ScopePilot could not be reached. Check your connection and try again.";
  }
  return mode === "login" ? "Sign-in failed. Try again." : "Registration failed. Try again.";
}

/** Shared sign-in / registration form. Validation mirrors the API's shared contracts; the API remains authoritative. */
export function AuthForm({ mode, next }: Readonly<{ mode: Mode; next: string }>) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const isRegister = mode === "register";

  function validate(): boolean {
    const errors: Partial<Record<Field, string>> = {};
    if (isRegister) {
      const nameError = validateName(name);
      if (nameError) errors.name = nameError;
      const passwordError = validatePassword(password, { email });
      if (passwordError) errors.password = passwordError;
    } else if (!password) {
      errors.password = "Enter your password.";
    }
    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!validate()) return;
    setPending(true);
    try {
      if (isRegister) {
        const parsed = parseRegisterInput({ name, email, password });
        if (!parsed.ok) { setFieldErrors({ [parsed.field]: parsed.error }); setPending(false); return; }
        await authApi.register(parsed.value);
        // Registration answers the same for new and taken emails, so sign in with the same credentials.
        await authApi.login({ email: parsed.value.email, password: parsed.value.password });
      } else {
        const parsed = parseLoginInput({ email, password });
        if (!parsed.ok) { setFieldErrors({ [parsed.field]: parsed.error }); setPending(false); return; }
        await authApi.login(parsed.value);
      }
      // A full navigation renders the workspace with the new session cookie.
      window.location.assign(next);
    } catch (caught) {
      const field = caught instanceof ApiError && caught.status === 400 ? (caught.body as { field?: unknown } | undefined)?.field : undefined;
      if (field === "name" || field === "email" || field === "password") setFieldErrors({ [field]: (caught as ApiError).message });
      else setError(describeAuthError(caught, mode));
      setPassword("");
      setPending(false);
    }
  }

  const describedBy = (field: Field, help?: string) => [fieldErrors[field] ? `${field}-error` : "", help ?? ""].filter(Boolean).join(" ") || undefined;

  return <form className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={pending}>
    {isRegister && <div className={styles.field}>
      <label htmlFor="name" className="eyebrow">Name</label>
      <TextInput id="name" name="name" autoComplete="name" value={name} maxLength={AUTH_LIMITS.nameMax} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={describedBy("name")} />
      {fieldErrors.name && <p id="name-error" className={styles.fieldError}>{fieldErrors.name}</p>}
    </div>}
    <div className={styles.field}>
      <label htmlFor="email" className="eyebrow">Email</label>
      <TextInput id="email" name="email" type="email" inputMode="email" autoComplete={isRegister ? "email" : "username"} value={email} maxLength={AUTH_LIMITS.emailMax} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={describedBy("email")} />
      {fieldErrors.email && <p id="email-error" className={styles.fieldError}>{fieldErrors.email}</p>}
    </div>
    <div className={styles.field}>
      <label htmlFor="password" className="eyebrow">Password</label>
      <TextInput id="password" name="password" type="password" autoComplete={isRegister ? "new-password" : "current-password"} value={password} maxLength={AUTH_LIMITS.passwordMax} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={describedBy("password", isRegister ? "password-help" : undefined)} />
      {isRegister && <p id="password-help" className={styles.help}>At least {AUTH_LIMITS.passwordMin} characters. A short phrase is easier to remember than symbols.</p>}
      {fieldErrors.password && <p id="password-error" className={styles.fieldError}>{fieldErrors.password}</p>}
    </div>
    {error && <p className={styles.formError} role="alert">{error}</p>}
    <Button tone="lime" type="submit" disabled={pending}>{pending ? (isRegister ? "Creating account…" : "Signing in…") : (isRegister ? "Create account" : "Sign in")}<span aria-hidden>→</span></Button>
    <p className={styles.switch}>
      {isRegister
        ? <>Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>
        : <>New to ScopePilot? <Link href={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></>}
    </p>
    {!isRegister && <p className={styles.note}>Password reset is not available yet. Contact the workspace administrator if you are locked out.</p>}
  </form>;
}
