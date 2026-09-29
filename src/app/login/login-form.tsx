"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";

type LoginErrorResponse = {
  error?: { message?: string };
};

export function LoginForm() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: formData.get("workspace"),
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });
      const body = (await response.json()) as LoginErrorResponse;

      if (!response.ok) {
        setErrorMessage(
          body.error?.message ?? "Não foi possível entrar. Tente novamente.",
        );
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setErrorMessage("Não foi possível conectar à aplicação. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
      <label className="block text-sm font-medium">
        Workspace
        <input
          autoComplete="organization"
          className="mt-2 h-11 w-full rounded-md border bg-card px-3 outline-none focus:ring-2 focus:ring-ring"
          name="workspace"
          placeholder="slug-do-workspace"
          required
        />
      </label>

      <label className="block text-sm font-medium">
        E-mail
        <input
          autoComplete="username"
          className="mt-2 h-11 w-full rounded-md border bg-card px-3 outline-none focus:ring-2 focus:ring-ring"
          name="email"
          required
          type="email"
        />
      </label>

      <label className="block text-sm font-medium">
        Senha
        <input
          autoComplete="current-password"
          className="mt-2 h-11 w-full rounded-md border bg-card px-3 outline-none focus:ring-2 focus:ring-ring"
          minLength={12}
          name="password"
          required
          type="password"
        />
      </label>

      {errorMessage ? (
        <p className="rounded-md border border-danger/30 bg-[var(--danger-surface)] p-3 text-sm text-danger" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <Button className="w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
