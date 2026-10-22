"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { OteAdministration } from "@/modules/ote/application/ote-service";
import { saleKinds, saleKindLabels, type SaleKind } from "@/modules/ote/domain/ote-calculator";
import styles from "../ote.module.css";

const money = (value: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
const centsInput = (value: FormDataEntryValue | null) => {
  const raw = String(value ?? "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error("Informe valores monetários positivos com até duas casas decimais.");
  const [integer, fraction = ""] = raw.split(".");
  return (BigInt(integer!) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
};
export function OteAdmin({ screen }: { screen: OteAdministration }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [memberId, setMemberId] = useState(screen.members[0]?.id ?? "");
  const [effectiveMonth, setEffectiveMonth] = useState(screen.month);
  const latest = screen.plans.find((p) => p.memberId === memberId && p.effectiveMonth <= effectiveMonth);
  const exact = screen.plans.find((p) => p.memberId === memberId && p.effectiveMonth === effectiveMonth);
  const choices = (empty = false): ReactNode => <>{empty ? <option value="">Sem atribuição SDR</option> : <option value="">Selecione</option>}{screen.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</>;
  async function submit(event: FormEvent<HTMLFormElement>, payload: (data: FormData) => unknown) {
    event.preventDefault();
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const body = payload(new FormData(event.currentTarget));
      const response = await fetch("/api/ote/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Não foi possível salvar.");
      setMessage("Registro salvo. A projeção individual já considera os dados conferidos.");
      router.refresh();
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Falha ao salvar."); }
    finally { setBusy(false); }
  }
  return <div className={`${styles.stack} mt-6`}><div className={styles.toolbar}><Link className={styles.link} href="/ote">Meu OTE</Link><form className={styles.toolbar}><label>Competência<input name="month" defaultValue={screen.month} required type="month" /></label><button className={styles.link} type="submit">Consultar</button></form></div>
    <p className={styles.notice}>Somente administradores podem acessar esta tela. Cada vendedor consulta apenas o próprio plano. Conferir OTE não gera lançamentos nem pagamentos no Financeiro.</p>
    {message ? <p className={styles.notice} role={failed ? "alert" : "status"}>{message}</p> : null}
    <section className={styles.panel}><h2>Salário e meta por pessoa</h2><div className={styles.toolbar}><label>Pessoa<select className={styles.link} value={memberId} onChange={(e) => setMemberId(e.target.value)}>{choices()}</select></label><label>Vigência a partir de<input type="month" value={effectiveMonth} onChange={(e) => setEffectiveMonth(e.target.value)} required /></label></div>
    <form className={styles.form} key={`${memberId}:${effectiveMonth}:${latest?.revision ?? 0}`} onSubmit={(e) => void submit(e, (d) => ({ action: "SAVE_PLAN", memberId, effectiveMonth, label: d.get("label"), role: d.get("role"), fixedCents: centsInput(d.get("fixed")), quotaCents: centsInput(d.get("quota")), bonusCents: centsInput(d.get("bonus")), meetingQuota: Number(d.get("meetingQuota")), salesQuota: Number(d.get("salesQuota")), expectedRevision: exact?.revision ?? 0 }))}>
      <label>Cargo no plano<input name="label" defaultValue={latest?.label ?? "Comercial"} maxLength={100} required /></label><label>Modelo<select name="role" defaultValue={latest?.role ?? "CLOSER"}><option value="CLOSER">Closer</option><option value="SDR">SDR</option></select></label>
      <label>Fixo mensal (R$)<input name="fixed" defaultValue={Number(latest?.fixedCents ?? 0) / 100} min="0" max="9999999999" step="0.01" type="number" required /></label><label>Meta NEW ACV (R$)<input name="quota" defaultValue={Number(latest?.quotaCents ?? 0) / 100} min="0" max="9999999999" step="0.01" type="number" required /></label><label>Bônus a 100% (R$)<input name="bonus" defaultValue={Number(latest?.bonusCents ?? 0) / 100} min="0" max="9999999999" step="0.01" type="number" required /></label><label>Meta reuniões SDR<input name="meetingQuota" defaultValue={latest?.meetingQuota ?? 20} min="1" max="1000" type="number" required /></label><label>Meta vendas SDR<input name="salesQuota" defaultValue={latest?.salesQuota ?? 4} min="1" max="1000" type="number" required /></label><Button disabled={busy || !memberId} type="submit">Salvar plano</Button>
    </form><p className={`${styles.muted} mt-3`}>Nova vigência preserva os meses anteriores. Salvar na mesma vigência corrige o plano existente e registra auditoria. Para SDR, NEW ACV e bônus são desconsiderados; a variável usa R$ 40 por reunião e R$ 100 por cliente.</p>
    {latest ? <p className="mt-3">OTE com o plano exibido: <strong>{money(latest.oteCents)}</strong> / mês</p> : null}</section>
    <section className={styles.panel}><h2>Conferir vendas ganhas · {screen.month}</h2><p className={styles.muted}>Confirme tipo, ACV e origem com o contrato. Nos projetos, informe zero no ACV: a base será o recebido confirmado no CRM. Em expansão, informe apenas o ACV incremental. Recebimentos e ativação são consultados automaticamente; não há campo para simular caixa recebido.</p>
      {screen.sales.length === 0 ? <p className="mt-4">Nenhuma venda ganha nesta competência.</p> : screen.sales.map((s) => <details className="mt-4 border-t border-border pt-4" key={`${s.id}:${s.fact?.revision ?? 0}`}><summary className="cursor-pointer font-medium">{s.name} · {screen.members.find((m) => m.id === s.sellerMemberId)?.name ?? "Vendedor"} · {s.fact ? "Conferida" : "Pendente"}</summary><form className={styles.form} onSubmit={(e) => void submit(e, (d) => ({ action: "CLASSIFY_SALE", opportunityId: s.id, kind: d.get("kind"), acvCents: centsInput(d.get("acv")), selfSourced: d.get("selfSourced") === "on", sdrMemberId: d.get("sdrMemberId") || null, evidence: d.get("evidence"), expectedRevision: s.fact?.revision ?? 0 }))}>
        <label>Tipo<select defaultValue={s.fact?.kind ?? ""} name="kind" required><option value="" disabled>Conferir tipo</option>{saleKinds.map((kind: SaleKind) => <option value={kind} key={kind}>{saleKindLabels[kind]}</option>)}</select></label><label>ACV / ACV incremental (R$)<input name="acv" defaultValue={Number(s.fact?.acvCents ?? s.suggestedAcvCents) / 100} min="0" max="9999999999" step="0.01" type="number" required /></label><label>Origem SDR<select name="sdrMemberId" defaultValue={s.fact?.sdrMemberId ?? ""}>{choices(true)}</select></label><label><input name="selfSourced" type="checkbox" defaultChecked={s.fact?.selfSourced ?? false} />Prospecção própria</label><label>Evidência da classificação<textarea name="evidence" defaultValue={s.fact?.evidence ?? ""} minLength={5} maxLength={1000} required /></label><Button disabled={busy} type="submit">Conferir venda</Button>
      </form></details>)}
    </section><section className={styles.panel}><h2>Conferir reuniões realizadas · {screen.month}</h2><p className={styles.muted}>Atribua a origem SDR e confirme que a reunião aconteceu e foi qualificada. Uma reunião gera no máximo um crédito, mesmo se for editada.</p>
      {screen.meetings.length === 0 ? <p className="mt-4">Nenhuma reunião concluída nesta competência.</p> : screen.meetings.map((m) => <details className="mt-4 border-t border-border pt-4" key={`${m.id}:${m.fact?.revision ?? 0}`}><summary className="cursor-pointer font-medium">{m.title} · {m.fact?.qualified ? "Qualificada" : "Sem crédito qualificado"}</summary><form className={styles.form} onSubmit={(e) => void submit(e, (d) => ({ action: "QUALIFY_MEETING", meetingId: m.id, sdrMemberId: d.get("sdrMemberId"), qualified: d.get("qualified") === "on", evidence: d.get("evidence"), expectedRevision: m.fact?.revision ?? 0 }))}>
        <label>SDR de origem<select name="sdrMemberId" defaultValue={m.fact?.sdrMemberId ?? ""} required>{choices()}</select></label><label><input defaultChecked={m.fact?.qualified ?? false} name="qualified" type="checkbox" />Realizada e qualificada</label><label>Evidência da qualificação<textarea name="evidence" minLength={5} maxLength={1000} defaultValue={m.fact?.evidence ?? ""} required /></label><Button disabled={busy} type="submit">Conferir reunião</Button></form></details>)}
    </section>
  </div>;
}
