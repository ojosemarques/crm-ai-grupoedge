"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";

type ErrorResponse = { error?: { message?: string } };

const inputClass = "mt-2 h-11 w-full rounded-md border bg-card px-3 outline-none focus:ring-2 focus:ring-ring";

export function ChangePasswordForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    const form = event.currentTarget;
    const fields = new FormData(form);
    const currentPassword = String(fields.get("currentPassword") ?? "");
    const newPassword = String(fields.get("newPassword") ?? "");
    if (newPassword !== fields.get("confirmPassword")) {
      setErrorMessage("A confirmação da nova senha não corresponde.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const body = await response.json() as ErrorResponse;
        setErrorMessage(body.error?.message ?? "Não foi possível alterar a senha.");
        return;
      }
      form.reset();
      router.replace("/login");
      router.refresh();
    } catch {
      setErrorMessage("Não foi possível conectar à aplicação. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
      <label className="block text-sm font-medium">Senha atual
        <input autoComplete="current-password" className={inputClass} maxLength={128} name="currentPassword" required type="password" />
      </label>
      <label className="block text-sm font-medium">Nova senha
        <input autoComplete="new-password" className={inputClass} maxLength={128} minLength={16} name="newPassword" required type="password" />
      </label>
      <p className="text-sm text-muted-foreground">Use de 16 a 128 caracteres, incluindo maiúscula, minúscula, número e símbolo.</p>
      <label className="block text-sm font-medium">Confirme a nova senha
        <input autoComplete="new-password" className={inputClass} maxLength={128} minLength={16} name="confirmPassword" required type="password" />
      </label>
      {errorMessage ? <p className="rounded-md border border-danger/30 bg-[var(--danger-surface)] p-3 text-sm text-danger" role="alert">{errorMessage}</p> : null}
      <Button disabled={isSubmitting} type="submit">{isSubmitting ? "Alterando..." : "Alterar senha"}</Button>
    </form>
  );
}
