import styles from "../finance.module.css";
import { Icon } from "@/components/ui/icon";
import { redirect } from "next/navigation";
import { RevenueActions } from "@/app/receita/[subscriptionId]/revenue-actions";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getRevenueService } from "@/modules/revenue/application/revenue-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
export const dynamic="force-dynamic";
const money=(c:bigint)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(c)/100);
export default async function RevenueDetail({params}:{params:Promise<{subscriptionId:string}>}){
  const context=await requirePageAuthentication();let data;try{data=await getRevenueService().detail(context,(await params).subscriptionId);}catch(e){if(e instanceof AccessDeniedError)redirect("/acesso-negado");throw e;}const s=data.subscription;
  return <main className={`page-canvas page-canvas-wide ${styles.workspace}`}>
    <PageHeader back={{ href: "/receita", label: "Voltar às assinaturas" }} eyebrow="Assinatura" title={s.subscriptionNumber} description={`${s.accountNameSnapshot} · ${s.productNameSnapshot}`} meta={`${s.status} · revisão ${s.revision}`}/>
    <section className={styles.metrics}><article className={styles.metric}><Icon name="receita" size={17}/><span>MRR operacional atual</span><strong>{money(s.currentMrrCents)}</strong><small>Receita recorrente mensal</small></article><article className={styles.metric}><Icon name="agenda" size={17}/><span>Cadência</span><strong>{s.billingInterval}</strong><small>Periodicidade da assinatura</small></article><article className={styles.metric}><Icon name="auditoria" size={17}/><span>Movimentos registrados</span><strong>{data.ledger.length}</strong><small>Histórico preservado</small></article></section>
    <div className={styles.detailLayout}><div className={styles.detailMain}>
      <section className={styles.panel}><header className={styles.panelHeader}><div><h2>Movimentos de receita</h2><p>Alterações efetivas no MRR desta assinatura</p></div><span className={styles.counter}>{data.ledger.length}</span></header>{data.ledger.length===0?<div className="empty-state"><strong>Nenhum movimento registrado</strong><p>A assinatura ainda não foi ativada.</p></div>:<div className={styles.table}><table><thead><tr><th>#</th><th>Tipo</th><th>Delta MRR</th><th>Competência</th><th>Motivo</th></tr></thead><tbody>{data.ledger.map(m=><tr key={m.id}><td>{m.sequence}</td><td><span className="status-badge">{m.type}</span></td><td>{money(m.deltaMrrCents)}</td><td>{m.effectiveAt.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</td><td>{m.reason}</td></tr>)}</tbody></table></div>}</section>
      <section className={styles.panel}><header className={styles.panelHeader}><h2>Histórico da assinatura</h2></header><ol className={styles.history}>{data.history.map(h=><li key={h.id}><strong>{h.event}</strong><p>{h.reason}</p><time>{h.occurredAt.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</time></li>)}</ol>{data.history.length===0?<div className="empty-state"><p>Nenhum evento registrado.</p></div>:null}</section>
    </div><aside className={styles.detailAside}><RevenueActions subscriptionId={s.id} status={s.status}/></aside></div>
  </main>;
}
