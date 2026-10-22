"use client";

import { useState } from "react";
import { calculateSale } from "@/modules/ote/domain/ote-calculator";
import styles from "./ote.module.css";

export const formatMoney = (value: string | bigint) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);

export function OteSimulator({ plan }: { plan: { role: string; fixedCents: string; quotaCents: string; bonusCents: string; meetingQuota: number; salesQuota: number } }) {
  const [acv, setAcv] = useState(Number(plan.quotaCents) / 100);
  const [meetings, setMeetings] = useState(plan.meetingQuota);
  const [sales, setSales] = useState(plan.salesQuota);
  const [selfSourced, setSelfSourced] = useState(false);
  function estimate(multiplier: number) {
    const value = BigInt(Math.round(Number(plan.quotaCents) * multiplier));
    const commission = calculateSale({ kind: "ANNUAL_MONTHLY", acvCents: value, receivedCents: 0n, selfSourced, priorNewAcvCents: 0n, quotaCents: BigInt(plan.quotaCents) }).projectedCents;
    return BigInt(plan.fixedCents) + commission + (value >= BigInt(plan.quotaCents) ? BigInt(plan.bonusCents) : 0n);
  }
  const simulated = plan.role === "SDR" ? BigInt(plan.fixedCents) + BigInt(meetings) * 4000n + BigInt(sales) * 10000n : estimate(Number(plan.quotaCents) ? acv * 100 / Number(plan.quotaCents) : 0);
  return <section className={styles.panel}><h2>Quanto posso atingir?</h2><p className={styles.muted}>Simulação da sua remuneração bruta. Comissão sem teto; projeção não é pagamento confirmado.</p><div className={styles.form}>
    {plan.role === "SDR" ? <><label>Reuniões realizadas e qualificadas<input min={0} max={100000} type="number" value={meetings} onChange={(e) => setMeetings(Math.min(100000, Math.max(0, Math.floor(Number(e.target.value)))))} /></label><label>Clientes originados e fechados<input min={0} max={100000} type="number" value={sales} onChange={(e) => setSales(Math.min(100000, Math.max(0, Math.floor(Number(e.target.value)))))} /></label></> : <><label>NEW ACV vendido (R$)<input min={0} max={999999999} step="0.01" type="number" value={acv} onChange={(e) => setAcv(Math.min(999999999, Math.max(0, Number(e.target.value))))} /></label><label><input checked={selfSourced} type="checkbox" onChange={(e) => setSelfSourced(e.target.checked)} />Todas as vendas de prospecção própria (+1 p.p.)</label></>}
    <div><span className={styles.muted}>Fixo + variável + bônus</span><p className="text-2xl font-semibold" aria-live="polite">{formatMoney(simulated)}</p></div></div>
    {plan.role === "CLOSER" ? <><p className={`${styles.muted} mt-3`}>Cenário com contratos novos anuais pagos mensalmente; faixas de 6%, 8% e 10% sobre cada excedente. A composição real das vendas pode mudar o resultado.</p><div className={styles.scenario}>{[1, 1.25, 1.5].map((fraction) => <div key={fraction}><small>{fraction * 100}% da sua meta · {formatMoney(BigInt(Math.round(Number(plan.quotaCents) * fraction)))} ACV</small><strong>{formatMoney(estimate(fraction))}</strong></div>)}</div></> : null}
  </section>;
}
