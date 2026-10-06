"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import styles from "@/app/email-agente/prospecting-workspace.module.css";

type Settings = Readonly<{
  revision: number;
  releaseEnabled: boolean;
  emailEgressEnabled: boolean;
  dailyCapacity: number;
  reservePercent: number;
  emailWindowStart: string;
  emailWindowEnd: string;
  coverageWarningDays: number;
  coverageCriticalDays: number;
}> | null;

type Seller = Readonly<{
  memberId: string;
  senderProfileId: string | null;
  active: boolean;
  dailyCapacity: number;
  reservePercent: number;
  dailyEmailLimit: number | null;
  rotationPosition: number;
  pausedReason: string | null;
}>;

type Props = Readonly<{ screen: Readonly<{
  settings: Settings;
  sellers: readonly Seller[];
  sellerOptions: readonly Readonly<{ id: string; name: string }>[];
  senders: readonly Readonly<{ id: string; displayName: string; operatingMode: string }>[];
}> }>;

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export function ProspectingSettingsActions({ screen }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; message: string }> | null>(null);
  const sellerByMember = new Map(screen.sellers.map((seller) => [seller.memberId, seller]));

  async function execute(payload: Record<string, unknown>) {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/prospecting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Não foi possível salvar a configuração.");
      setNotice({ kind: "success", message: "Configuração persistida e auditada." });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void execute({
      action: "SAVE_SETTINGS",
      expectedRevision: screen.settings?.revision ?? 1,
      releaseEnabled: form.get("releaseEnabled") === "on",
      emailEgressEnabled: form.get("emailEgressEnabled") === "on",
      dailyCapacity: Number(text(form, "dailyCapacity")),
      reservePercent: Number(text(form, "reservePercent")),
      emailWindowStart: text(form, "emailWindowStart"),
      emailWindowEnd: text(form, "emailWindowEnd"),
      coverageWarningDays: Number(text(form, "coverageWarningDays")),
      coverageCriticalDays: Number(text(form, "coverageCriticalDays")),
    });
  }

  function saveSellers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selected = screen.sellerOptions.filter((member) => form.get(`include:${member.id}`) === "on");
    if (selected.length === 0) {
      setNotice({ kind: "error", message: "Selecione ao menos um vendedor." });
      return;
    }
    void execute({
      action: "SAVE_SELLERS",
      sellers: selected.map((member, index) => ({
        memberId: member.id,
        senderProfileId: text(form, `sender:${member.id}`) || null,
        active: form.get(`active:${member.id}`) === "on",
        dailyCapacity: Number(text(form, `capacity:${member.id}`)),
        reservePercent: Number(text(form, `reserve:${member.id}`)),
        dailyEmailLimit: text(form, `emailLimit:${member.id}`) ? Number(text(form, `emailLimit:${member.id}`)) : null,
        rotationPosition: Number(text(form, `rotation:${member.id}`) || index),
        pausedReason: text(form, `pausedReason:${member.id}`) || null,
      })),
    });
  }

  function publishTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void execute({ action: "PUBLISH_EMAIL_TEMPLATE", stepKey: text(form, "stepKey"), subject: text(form, "subject"), body: text(form, "body") });
  }

  function saveHolidays(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const holidays = text(form, "holidays").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const [localDate, ...nameParts] = line.split("|");
      return { localDate: localDate?.trim() ?? "", name: nameParts.join("|").trim() };
    });
    void execute({ action: "SAVE_HOLIDAYS", holidays });
  }

  const control = "w-full rounded-md border bg-background px-3 py-2 text-sm";
  return <section className={styles.section}>
    <div className={styles.sectionHeader}><div><h2>Administração operacional</h2><p>Mudanças passam por validação, revisão otimista e auditoria no servidor.</p></div></div>
    {notice ? <p className="feedback-banner rounded-md border p-3 text-sm" data-tone={notice.kind === "error" ? "danger" : "success"} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}
    <div className={styles.grid}>
      <form className={styles.card} onSubmit={saveSettings}>
        <h3>Gates e capacidade</h3>
        <label><input defaultChecked={screen.settings?.releaseEnabled} name="releaseEnabled" type="checkbox" /> Liberar releases diários</label>
        <label><input defaultChecked={screen.settings?.emailEgressEnabled} name="emailEgressEnabled" type="checkbox" /> Habilitar egress de e-mail</label>
        <label>Capacidade diária<input className={control} defaultValue={screen.settings?.dailyCapacity ?? 75} min="1" name="dailyCapacity" type="number" /></label>
        <label>Reserva (%)<input className={control} defaultValue={screen.settings?.reservePercent ?? 10} min="0" name="reservePercent" type="number" /></label>
        <label>Janela inicial<input className={control} defaultValue={screen.settings?.emailWindowStart ?? "09:00"} name="emailWindowStart" type="time" /></label>
        <label>Janela final<input className={control} defaultValue={screen.settings?.emailWindowEnd ?? "17:00"} name="emailWindowEnd" type="time" /></label>
        <label>Alerta de cobertura (dias)<input className={control} defaultValue={screen.settings?.coverageWarningDays ?? 10} min="1" name="coverageWarningDays" type="number" /></label>
        <label>Crítico de cobertura (dias)<input className={control} defaultValue={screen.settings?.coverageCriticalDays ?? 5} min="1" name="coverageCriticalDays" type="number" /></label>
        <button className={styles.button} disabled={pending} type="submit">Salvar gates</button>
      </form>
      <form className={styles.card} onSubmit={publishTemplate}>
        <h3>Publicar template imutável</h3>
        <label>Passo<select className={control} name="stepKey">{[1,2,3,4,5,6,7].map((number) => <option key={number} value={`email-${number}`}>E-mail {number}</option>)}</select></label>
        <label>Assunto<input className={control} minLength={3} name="subject" required /></label>
        <label>Corpo<textarea className={control} minLength={20} name="body" required rows={8} /></label>
        <button className={styles.button} disabled={pending} type="submit">Publicar nova versão</button>
      </form>
      <form className={styles.card} onSubmit={saveHolidays}>
        <h3>Calendário útil</h3>
        <p>Uma linha por feriado no formato <code>AAAA-MM-DD|Nome</code>.</p>
        <textarea className={control} name="holidays" placeholder="2026-11-20|Consciência Negra" rows={8} />
        <button className={styles.button} disabled={pending} type="submit">Salvar feriados</button>
      </form>
      <article className={styles.card}>
        <h3>Planejamento</h3>
        <p>Recalcula o estoque READY sob lock e respeita a carga de todos os dias manuais.</p>
        <button className={styles.button} disabled={pending} onClick={() => void execute({ action: "RUN_PLANNER", limit: 2_000 })} type="button">Executar planejador</button>
      </article>
    </div>
    <form className={styles.section} onSubmit={saveSellers}>
      <div className={styles.sectionHeader}><div><h3>Vendedores e remetentes</h3><p>O limite diário de e-mail é obrigatório antes do egress.</p></div><button className={styles.button} disabled={pending} type="submit">Salvar vendedores</button></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Usar</th><th>Ativo</th><th>Vendedor</th><th>Capacidade</th><th>Reserva</th><th>Ordem</th><th>Remetente</th><th>Limite e-mail</th><th>Motivo de pausa</th></tr></thead><tbody>{screen.sellerOptions.map((member, index) => {
        const seller = sellerByMember.get(member.id);
        return <tr key={member.id}><td><input defaultChecked={Boolean(seller)} name={`include:${member.id}`} type="checkbox" /></td><td><input defaultChecked={seller?.active ?? true} name={`active:${member.id}`} type="checkbox" /></td><td>{member.name}</td><td><input className={control} defaultValue={seller?.dailyCapacity ?? 75} min="1" name={`capacity:${member.id}`} type="number" /></td><td><input className={control} defaultValue={seller?.reservePercent ?? 10} min="0" name={`reserve:${member.id}`} type="number" /></td><td><input className={control} defaultValue={seller?.rotationPosition ?? index} min="0" name={`rotation:${member.id}`} type="number" /></td><td><select className={control} defaultValue={seller?.senderProfileId ?? ""} name={`sender:${member.id}`}><option value="">Pendente</option>{screen.senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.displayName} · {sender.operatingMode}</option>)}</select></td><td><input className={control} defaultValue={seller?.dailyEmailLimit ?? ""} min="1" name={`emailLimit:${member.id}`} placeholder="Pendente" type="number" /></td><td><input className={control} defaultValue={seller?.pausedReason ?? ""} name={`pausedReason:${member.id}`} /></td></tr>;
      })}</tbody></table></div>
    </form>
  </section>;
}
