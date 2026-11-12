"use client";

import { useState, type FormEvent } from "react";
import { AgendaPicker } from "./agenda-picker";
import styles from "./agenda.module.css";

export function NativeAgendaEntry() {
  const [receipt, setReceipt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function identify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/public/agenda/native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.get("name"), phone: values.get("phone") }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? "Aguarde um minuto e tente novamente." : "Confira o nome e o WhatsApp usados no formulário. Se acabou de preencher, aguarde um instante e tente novamente.");
        return;
      }
      const result: { receipt: string } = await response.json();
      setReceipt(result.receipt);
    } catch {
      setError("Não foi possível abrir a agenda agora. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  if (receipt) return <AgendaPicker receipt={receipt} />;

  return <main className={styles.shell}>
    <section className={styles.nativeEntry} aria-labelledby="native-agenda-title">
      <h1 id="native-agenda-title">Agende sua reunião</h1>
      <p>Use os mesmos dados do formulário para acessar os horários.</p>
      <form onSubmit={identify}>
        <label>Nome completo<input name="name" autoComplete="name" minLength={3} maxLength={200} required /></label>
        <label>WhatsApp com DDD<input name="phone" type="tel" autoComplete="tel" minLength={10} maxLength={25} required /></label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? "Abrindo agenda…" : "Ver horários"}</button>
      </form>
    </section>
  </main>;
}
