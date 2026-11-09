import type { CommercialGoalsPerson } from "@/modules/finance/application/commercial-goals-screen";
import styles from "@/app/ote/ote.module.css";

const number = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const paymentStates = {
  PENDING: "Pendente", ELIGIBLE: "Elegível", APPROVED: "Aprovado", PAID: "Pago", REVIEW: "Em revisão",
};
const titleKinds = {
  SALE_COMMISSION: "Comissão de venda", CLOSER_BONUS: "Bônus de closer",
  SDR_COMMISSION: "Comissão de Anúncios", SDR_BONUS: "Bônus de Anúncios", LEGACY_STAGE: "Etapa histórica",
};
const periodLabels: Record<string, string> = { DAY: "Dia", WEEK: "Semana", MONTH: "Mês" };

function money(value: string | null) {
  if (value === null) return "—";
  const cents = BigInt(value);
  return `R$ ${number.format(cents / 100n)},${(cents % 100n).toString().padStart(2, "0")}`;
}
const date = (value: string | null) => value?.split("-").reverse().join("/") ?? "—";

export function CommercialGoals({ person, timeZone }: { person: CommercialGoalsPerson; timeZone: string }) {
  const displayTime = new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" });
  return <article className={styles.stack}>
    <section className={styles.panel}>
      <h2>{person.name} · {person.label}</h2>
      <dl className={styles.cards}>
        <Amount label="Fixo mensal" value={person.fixedCents} />
        <Amount label="OTE na meta" value={person.targetOteCents} />
        <Amount label="Comissão gerada" value={person.commissionCents} />
        <Amount label="Bônus gerado" value={person.bonusCents} />
        <Amount label="Pago no período" value={person.periodPaidCents} />
      </dl>
    </section>
    {person.role === "CLOSER" ? <section className={styles.panel}>
      <h3>Meta de NEW ACV</h3>
      <dl className={styles.cards}>
        <Amount label="Meta do mês" value={person.goalCents} />
        <Amount label="ACV realizado" value={person.newAcvCents} />
        <Amount label="ACV pendente" value={person.pendingAcvCents} />
        <Amount label="Falta para a meta" value={person.goalCents ? person.missingCents : null} />
      </dl>
      {person.ramp ? <p>{person.rampVerified ? "Rampa comprovada. Comissão padrão, sem meta ou bônus neste mês."
        : "Rampa pendente de comprovação."}</p> : person.attainmentBps !== null ? <>
        <p>Atingimento real: {percent.format(Number(person.attainmentBps) / 10000)}</p>
        <progress className={styles.progress} aria-label="Progresso de NEW ACV" max={10000} value={Math.min(10000, Number(person.attainmentBps))} />
      </> : <p>Meta sem cobertura para o período.</p>}
      <p>{person.pendingSales} venda(s) da competência aguardando confirmação ou D0.</p>
      <p>O mês de D0 define o NEW ACV. D0 considera aceite, ativação e primeira liquidação efetiva.</p>
    </section> : <section className={styles.panel}>
      <h3>Metas de Anúncios</h3>
      <p>Agendamento de 40% das chegadas atribuídas e comparecimento de 50% das reuniões elegíveis.</p>
      <div className={styles.cards}>{person.metrics.map((period) => {
        const { counts, attainment } = period.facts ?? {};
        return <div className={styles.card} key={period.kind}>
          <h4>{periodLabels[period.kind] ?? period.kind} · {date(period.fromOn)}</h4>
          {counts && attainment ? <>
            <p>Agendados: {counts.bookedLeads}/{counts.leads} · {counts.leads ? percent.format(counts.bookedLeads / counts.leads) : "Sem base"}</p>
            <p>Realizadas: {counts.heldMeetings}/{counts.eligibleMeetings} · {counts.eligibleMeetings ? percent.format(counts.heldMeetings / counts.eligibleMeetings) : "Sem base"}</p>
            <p>{attainment.coverage === "REVIEW" ? "Pendente de auditoria" : attainment.coverage === "NO_BASE" ? "Sem base"
              : `Faixa ${attainment.band}%`}</p>
            {attainment.attainmentBps !== null && <p>Atingimento real: {percent.format(attainment.attainmentBps / 10000)}</p>}
            {attainment.progressBps !== null && <progress className={styles.progress} aria-label={`Progresso de Anúncios · ${periodLabels[period.kind]}`}
              max={10000} value={attainment.progressBps} />}
            <small>Reuniões pendentes: {counts.pendingMeetings} · Evidências ausentes: {counts.missingEvidence}</small>
          </> : <p>Sem apuração registrada neste período.</p>}
          {period.evaluatedAt && <small>Atualizado em {displayTime.format(new Date(period.evaluatedAt))}{period.revision ? ` · Revisão ${period.revision}` : ""}</small>}
        </div>;
      })}</div>
    </section>}
    <section className={styles.panel}>
      <h3>Títulos de remuneração</h3>
      {person.titles.length ? <div className={styles.tableWrap}><table>
        <thead><tr><th>Título</th><th>Competência</th><th>Estado</th><th>Vencimento</th><th>Total</th><th>Pago</th><th>Saldo</th></tr></thead>
        <tbody>{person.titles.map((title) => <tr key={title.key}>
          <td>{titleKinds[title.kind]}{title.opportunityName && <small>{title.opportunityName}</small>}
            {title.facts?.d0 && <small>D0: {displayTime.format(new Date(title.facts.d0))}</small>}
            {title.facts?.tiers?.map((tier, index) => <small key={index}>{percent.format(Number(tier.rateBps) / 10000)} sobre {money(tier.basisCents)}</small>)}
          </td>
          <td>{title.competenceMonth}</td><td>{paymentStates[title.status]}{title.reason && <small>{title.reason}</small>}</td>
          <td>{date(title.dueOn)}{title.milestoneOn && <small>Marco: {date(title.milestoneOn)}</small>}
            {title.eligibleAt && <small>Elegível em {displayTime.format(new Date(title.eligibleAt))}</small>}</td>
          <td>{money(title.amountCents)}</td><td>{money(title.paidCents)}</td><td>{money(title.balanceCents)}</td>
        </tr>)}</tbody>
      </table></div> : <p>Nenhum título no período selecionado.</p>}
    </section>
  </article>;
}

function Amount({ label, value }: { label: string; value: string | null }) {
  return <div className={styles.card}><dt>{label}</dt><dd><strong>{money(value)}</strong></dd></div>;
}
