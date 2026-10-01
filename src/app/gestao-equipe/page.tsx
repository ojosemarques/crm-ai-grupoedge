import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getTeamManagementScreen } from "@/modules/metrics/application/team-management-service";
import type { TeamManagementPerson } from "@/modules/metrics/domain/team-management-contracts";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { ApplicationError } from "@/shared/core/errors/application-error";
import styles from "./team-management.module.css";

export const dynamic = "force-dynamic";

const presets = [
  ["TODAY", "Hoje"], ["WEEK", "Semana"], ["MONTH", "Mês"],
] as const;

function percentage(value: number | null) { return value === null ? "—" : `${value.toLocaleString("pt-BR")}%`; }
function duration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}
function roles(person: TeamManagementPerson) { return person.roles.length ? person.roles.join(" + ") : "Operação"; }

export default async function TeamManagementPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  if (!['administrator', 'commercial_manager'].includes(context.roleKey)) redirect("/acesso-negado");
  const params = await searchParams;
  let screen;
  try {
    screen = await getTeamManagementScreen(context, params);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "INVALID_INPUT") redirect("/gestao-equipe?preset=MONTH");
    throw error;
  }
  const currentPreset = screen.query.preset;

  return <main className={`page-canvas page-canvas-wide ${styles.workspace}`}>
    <PageHeader eyebrow="Gestão comercial" title="Gestão e treinamento da equipe" description="Acompanhe a execução da fila, resultados por pessoa e pontos objetivos para coaching." meta={`Atualizado ${new Date(screen.generatedAt).toLocaleString("pt-BR", { timeZone: screen.timeZone })}`} />

    <nav aria-label="Período" className={styles.periods}>
      {presets.map(([preset, label]) => <Link aria-current={currentPreset === preset ? "page" : undefined} href={`/gestao-equipe?preset=${preset}`} key={preset}>{label}</Link>)}
      <form className={styles.customPeriod}>
        <input name="preset" type="hidden" value="CUSTOM" />
        <label>De<input defaultValue={screen.query.fromDate} name="fromDate" type="date" /></label>
        <label>Até<input defaultValue={screen.query.toDate} name="toDate" type="date" /></label>
        <button type="submit">Aplicar</button>
      </form>
    </nav>

    <section aria-label="Resumo da equipe" className={styles.metrics}>
      <article><Icon name="equipe" size={18}/><span>Pessoas acompanhadas</span><strong>{screen.summary.people}</strong><small>com atividade no recorte</small></article>
      <article data-tone="success"><Icon name="auditoria" size={18}/><span>Fila trabalhada corretamente</span><strong>{screen.summary.workingQueueCorrectly}</strong><small>sem pendência operacional</small></article>
      <article data-tone={screen.summary.leadsWithoutNextAction ? "danger" : "success"}><Icon name="alerta" size={18}/><span>Sem próxima ação</span><strong>{screen.summary.leadsWithoutNextAction}</strong><small>leads abertos</small></article>
      <article data-tone={screen.summary.forgottenLeads ? "warning" : "success"}><Icon name="relogio" size={18}/><span>Leads esquecidos</span><strong>{screen.summary.forgottenLeads}</strong><small>acima do limite da etapa</small></article>
      <article><Icon name="inbox" size={18}/><span>Contatos registrados</span><strong>{screen.summary.contacts}</strong><small>ligações, mensagens e e-mails</small></article>
      <article><Icon name="agenda" size={18}/><span>Reuniões</span><strong>{screen.summary.meetings}</strong><small>atribuídas no período</small></article>
    </section>

    <section className={styles.panel}>
      <header><div><h2>Execução por pessoa</h2><p>O selo de fila correta combina tarefas concluídas, próxima ação e estagnação.</p></div><span>{screen.people.length} pessoa(s)</span></header>
      {screen.people.length ? <div className={styles.tableScroll}><table><thead><tr><th>Pessoa</th><th>Fila</th><th>Sem ação</th><th>1ª resposta</th><th>Contatos</th><th>Reuniões</th><th>Conv. SDR</th><th>Conv. vendas</th><th>Tarefas</th><th>Esquecidos</th></tr></thead><tbody>
        {screen.people.map((person) => <tr key={person.id}><td><strong>{person.name}</strong><small>{roles(person)}</small></td><td><span className={styles.queueStatus} data-ok={person.workedQueueCorrectly}>{person.workedQueueCorrectly ? "Em dia" : "Revisar"}</span></td><td className={person.leadsWithoutNextAction ? styles.danger : undefined}>{person.leadsWithoutNextAction}</td><td>{duration(person.averageFirstResponseSeconds)}</td><td>{person.contacts}</td><td>{person.meetings}</td><td>{percentage(person.sdrConversionPercentage)}</td><td>{percentage(person.sellerConversionPercentage)}</td><td>{person.tasksCompleted}/{person.tasksTotal}<small>{percentage(person.taskCompletionPercentage)}</small></td><td className={person.forgottenLeads ? styles.warning : undefined}>{person.forgottenLeads}</td></tr>)}
      </tbody></table></div> : <div className={styles.empty}><strong>Sem atividade atribuída neste período.</strong><p>Altere o período ou registre tarefas, contatos e oportunidades para iniciar o acompanhamento.</p></div>}
    </section>

    <div className={styles.columns}>
      <section className={styles.panel}><header><div><h2>Leads que exigem ação</h2><p>Carteira sem próximo passo ou acima do limite de estagnação.</p></div><span>{screen.leadAlerts.length}</span></header>
        {screen.leadAlerts.length ? <ul className={styles.alertList}>{screen.leadAlerts.slice(0, 20).map((lead) => <li key={lead.id}><div><strong>{lead.name}</strong><span>{lead.ownerName} · {lead.kind === "WITHOUT_NEXT_ACTION" ? "sem próxima ação" : "esquecido"}</span></div><Link href={lead.href}>Abrir lead</Link></li>)}</ul> : <div className={styles.empty}><strong>Nenhum lead esquecido.</strong><p>A equipe está com a carteira operacional em dia.</p></div>}
      </section>
      <section className={styles.panel}><header><div><h2>Motivos de perda</h2><p>Razões registradas nas oportunidades perdidas no período.</p></div></header>
        {screen.lossReasons.length ? <ol className={styles.lossList}>{screen.lossReasons.map((reason) => <li key={reason.id}><span>{reason.label}</span><div><i style={{ width: `${reason.percentage ?? 0}%` }}/></div><strong>{reason.value} <small>{percentage(reason.percentage)}</small></strong></li>)}</ol> : <div className={styles.empty}><strong>Sem perdas registradas.</strong><p>Não há motivo de perda para analisar neste período.</p></div>}
      </section>
    </div>

    <section className={styles.panel}>
      <header><div><h2>Sugestões de coaching</h2><p>Recomendações calculadas a partir dos desvios da operação. O gerente decide a ação.</p></div><span>{screen.coaching.length}</span></header>
      {screen.coaching.length ? <div className={styles.coaching}>{screen.coaching.map((item, index) => <article data-priority={item.priority} key={`${item.memberId}:${item.title}:${index}`}><span>{item.priority === "HIGH" ? "Prioridade alta" : item.priority === "MEDIUM" ? "Prioridade média" : "Desenvolvimento"}</span><h3>{item.memberName} · {item.title}</h3><p>{item.reason}</p><strong>Próxima ação</strong><p>{item.action}</p></article>)}</div> : <div className={styles.empty}><strong>Sem desvios relevantes.</strong><p>Mantenha os rituais atuais e acompanhe a evolução no próximo período.</p></div>}
    </section>

    <details className={styles.definitions}><summary>Como cada indicador é calculado</summary><dl>{screen.definitions.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.formula}</dd></div>)}</dl></details>
  </main>;
}
