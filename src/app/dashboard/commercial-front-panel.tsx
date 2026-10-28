import { commercialFrontEvidenceHref } from "@/modules/metrics/domain/commercial-front-links";
import Link from "next/link";
import type { DashboardScreen } from "@/modules/metrics/domain/dashboard-contracts";
import styles from "./dashboard.module.css";

export function CommercialFrontPanel({ screen }: Readonly<{ screen: DashboardScreen }>) {
  const summary = screen.commercialSummary;
  if (!summary) return null;
  const total = summary.total;
  const href = (measure: string, memberId?: string, pipelineId?: string) => commercialFrontEvidenceHref(screen.query, measure, memberId, pipelineId);
  const names = new Map(screen.filterOptions.integratedMembers.map((row) => [row.id, row.name]));
  const peopleRows = total.members.filter((row) => names.has(row.memberId) && (!summary.selectedMemberIds.length || summary.selectedMemberIds.includes(row.memberId)));
  const percent = (value: number | null) => value === null ? "Sem base elegível" : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  return <section className={styles.panel} aria-label="Contribuição das frentes comerciais">
    <header className={styles.panelHeader}><div><h2>Entradas e contribuição comercial</h2><p>Pessoas usam a união dos vínculos confirmados; identidades incertas têm cobertura parcial. Uma pessoa pode ter participações nas duas frentes.</p></div></header>
    <div className={styles.integratedGrid}>
      <Link href={href("entries")}><span>Entradas comerciais</span><strong>{total.entries}</strong><small>Submissões legítimas, sem replay técnico</small></Link>
      <Link href={href("participations")}><span>Novas participações</span><strong>{total.participations}</strong><small>Registros comerciais criados no período</small></Link>
      <Link href={href("people")}><span>Pessoas nas novas participações</span><strong>{total.uniquePeople}</strong><small>{total.unresolvedIdentities ? `${total.unresolvedIdentities} identidade(s) sem vínculo confirmado; cobertura parcial` : "União por contato canônico registrado"}</small></Link>
      <div><span>Reuniões agendadas / realizadas</span><strong><Link href={href("booked")}>{total.booked}</Link> / <Link href={href("completed")}>{total.completed}</Link></strong><small>Marcos ocorridos no período; créditos não são somados ao total</small></div>
    </div>
    <p className={styles.qualityNote}>Reentradas comerciais confirmadas: {total.reentries}.{total.unresolvedEntries ? ` ${total.unresolvedEntries} entrada(s) sem tipo histórico comprovado; não foram classificadas como reentrada por suposição.` : " Tipo de entrada conferido nas submissões."}</p>
    <div className={styles.performanceScroll}><table className={styles.performanceTable}><thead><tr><th>Frente</th><th>Entradas</th><th>Participações</th><th>Pessoas</th><th>Agendadas</th><th>Realizadas</th></tr></thead><tbody>{summary.fronts.map((row) => <tr key={row.id}><td><Link href={row.name === "Anúncios" ? "/dashboard/anuncios" : "/dashboard/prospeccao"}>{row.name}</Link></td><td><Link href={href("entries", undefined, row.id)}>{row.entries}</Link></td><td><Link href={href("participations", undefined, row.id)}>{row.participations}</Link></td><td><Link href={href("people", undefined, row.id)}>{row.uniquePeople}</Link></td><td><Link href={href("booked", undefined, row.id)}>{row.booked}</Link></td><td><Link href={href("completed", undefined, row.id)}>{row.completed}</Link></td></tr>)}</tbody></table></div>
    <p className={styles.qualityNote}>Agendamento na coorte de entrada: {percent(total.bookingCohort.rate)} ({total.bookingCohort.numerator}/{total.bookingCohort.denominator} participações com entrada). Realização na coorte de agendamento: {percent(total.completionCohort.rate)} ({total.completionCohort.numerator}/{total.completionCohort.denominator} reuniões). Resultados de outras coortes não entram nestas taxas.</p>
    <p className={styles.qualityNote}>{Math.max(0, summary.fronts.reduce((sum, front) => sum + front.uniquePeople, 0) - total.uniquePeople)} pessoa(s) com novas participações nas duas frentes no recorte. {summary.unclassifiedCount > 0 ? `Cobertura parcial: ${summary.unclassifiedCount} marco(s) autorizado(s) ainda sem frente histórica comprovada; não foram atribuídos por suposição.` : "Os marcos deste resumo possuem frente comercial identificada."}</p>
    <h3 className="mt-4 font-semibold">Tempo desde a primeira entrada no recorte</h3>
    <div className={styles.integratedGrid}>{total.timing.map((row) => <Link href={href(row.id)} key={row.id}><span>{row.label}</span><strong>{row.statistics.medianSeconds === null ? "Sem amostra" : row.statistics.medianSeconds < 60 ? `${row.statistics.medianSeconds}s` : `${(row.statistics.medianSeconds / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`}</strong><small>Mediana · {row.statistics.sampleCount} participação(ões) medida(s), {row.missingCount} sem marco observado no recorte</small></Link>)}</div>
    <p className={styles.qualityNote}>Primeira ação inclui execução humana ou automática confirmada. Resposta humana exige ligação atendida ou evidência de resposta. Resultado comercial é venda, perda ou desqualificação; não inferimos resultados ausentes.</p>
    <h3 className="mt-4 font-semibold">Crédito por papel</h3>
    <div className={styles.performanceScroll}><table className={styles.performanceTable}><thead><tr><th>Pessoa</th><th>Agendadas por esta pessoa</th><th>Atribuídas no agendamento</th><th>Realizadas pelo responsável</th></tr></thead><tbody>{peopleRows.map((row) => <tr key={row.memberId}><td>{names.get(row.memberId)}</td><td><Link href={href("booked", row.memberId)}>{row.booked}</Link></td><td><Link href={href("assigned", row.memberId)}>{row.assigned}</Link></td><td><Link href={href("completed", row.memberId)}>{row.completed}</Link></td></tr>)}</tbody></table></div>
    <p className={styles.qualityNote}>Atribuição usa o responsável no agendamento. Reuniões sem realização conservam seu estado real. Não somar as colunas de crédito para obter reuniões únicas.</p>
  </section>;
}
