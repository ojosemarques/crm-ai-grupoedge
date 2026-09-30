"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

const LOGIN_WORKSPACE = "politizai";

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
          workspace: LOGIN_WORKSPACE,
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
    <form className="login-form" method="post" onSubmit={handleSubmit}>
      <label className="login-field">
        E-mail
        <input
          autoComplete="username"
          className="login-field__input"
          name="email"
          placeholder="voce@empresa.com"
          required
          type="email"
        />
      </label>

      <label className="login-field">
        Senha
        <input
          autoComplete="current-password"
          className="login-field__input"
          minLength={12}
          name="password"
          placeholder="••••••••••••"
          required
          type="password"
        />
      </label>

      <div className="login-form__meta">
        <span><span className="login-form__secure-mark" aria-hidden="true" /> Acesso protegido</span>
        <span>Esqueceu a senha? Fale com o administrador</span>
      </div>

      {errorMessage ? (
        <p className="login-form__error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <button className="login-form__submit" disabled={isSubmitting} type="submit">
        <span>{isSubmitting ? "Entrando..." : "Entrar"}</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
