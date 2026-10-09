"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "@/app/email-agente/prospecting-workspace.module.css";

type Props = Readonly<{
  privacyApproved: boolean;
  canaryApproved: boolean;
}>;

type ApiResult = Readonly<{
  result?: Readonly<{ eligibleCount?: number; scheduledCount?: number }>;
  error?: Readonly<{ message?: string }>;
}>;

export function ProspectingLaunchActions({ privacyApproved, canaryApproved }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function execute(payload: Record<string, unknown>) {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/prospecting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as ApiResult | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Não foi possível concluir a ação.");
      if (body?.result?.eligibleCount !== undefined) {
        setEligibleCount(body.result.eligibleCount);
        setNotice(`${body.result.eligibleCount} primeiro(s) e-mail(s) elegível(is) na prévia.`);
      } else if (body?.result?.scheduledCount !== undefined) {
        setEligibleCount(null);
        setNotice(`${body.result.scheduledCount} primeiro(s) e-mail(s) agendado(s).`);
      } else {
        setNotice("Aprovação registrada e auditada.");
      }
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Liberação auditada</h2>
          <p>Registra as aprovações e inicia somente primeiros e-mails ainda não enviados de cadências ativas e elegíveis.</p>
        </div>
      </div>
      {notice ? <p className="feedback-banner rounded-md border p-3 text-sm" role="status">{notice}</p> : null}
      <div className={styles.grid}>
        <article className={styles.card}>
          <h3>Privacidade</h3>
          <p>{privacyApproved ? "Aprovada" : "Pendente"}</p>
          {!privacyApproved ? <button className={styles.button} disabled={pending} onClick={() => void execute({ action: "RECORD_PRIVACY_APPROVAL", confirmed: true, evidenceReference: "Autorização explícita do administrador para a cadência automática em produção em 2026-10-09." })} type="button">Registrar autorização</button> : null}
        </article>
        <article className={styles.card}>
          <h3>Canário</h3>
          <p>{canaryApproved ? "Aprovado" : "Pendente"}</p>
          {!canaryApproved ? <button className={styles.button} disabled={pending} onClick={() => void execute({ action: "RECORD_CANARY_APPROVAL", confirmed: true, evidenceReference: "Canário real MillionSend/Hostinger entregue e webhook confirmado com HTTP 202 em 2026-10-09." })} type="button">Registrar canário</button> : null}
        </article>
        <article className={styles.card}>
          <h3>Primeiro e-mail</h3>
          <p>Exclui respostas, reuniões, opt-outs, supressões, outras etapas e mensagens já enviadas.</p>
          <button className={styles.button} disabled={pending} onClick={() => void execute({ action: "START_ACTIVE_INITIAL_EMAILS", execute: false, expectedCount: null })} type="button">Gerar prévia</button>
          {eligibleCount !== null ? <button className={styles.button} disabled={pending} onClick={() => void execute({ action: "START_ACTIVE_INITIAL_EMAILS", execute: true, expectedCount: eligibleCount })} type="button">Agendar {eligibleCount} e-mail(s)</button> : null}
        </article>
      </div>
    </section>
  );
}
