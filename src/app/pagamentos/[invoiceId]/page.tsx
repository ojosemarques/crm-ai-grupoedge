import styles from "@/app/receita/finance.module.css";
import { Icon } from "@/components/ui/icon";
import { redirect } from "next/navigation";
import { PaymentActions } from "@/app/pagamentos/[invoiceId]/payment-actions";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getPaymentService } from "@/modules/payments/application/payment-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
export const dynamic="force-dynamic";
const money=(value:bigint)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value)/100);
const when=(value:Date)=>value.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"});
export default async function PaymentDetailPage({params}:{params:Promise<{invoiceId:string}>}){const context=await requirePageAuthentication();let data;try{data=await getPaymentService().detail(context,(await params).invoiceId);}catch(error){if(error instanceof AccessDeniedError)redirect("/acesso-negado");throw error;}const invoice=data.invoice;return <main className={`page-canvas page-canvas-wide ${styles.workspace}`}>
  <PageHeader back={{ href: "/pagamentos", label: "Voltar às cobranças" }} eyebrow="Cobrança" title={invoice.invoiceNumber} description={`${invoice.accountNameSnapshot} · ${invoice.contractNumberSnapshot}`} meta={`${invoice.status} · revisão ${invoice.revision}`}/>
  <section className={styles.metrics}><article className={styles.metric}><Icon name="vendas" size={17}/><span>Total da cobrança</span><strong>{money(invoice.totalCents)}</strong><small>Valor original</small></article><article className={styles.metric}><Icon name="receita" size={17}/><span>Pagamento confirmado</span><strong>{money(invoice.paidCents)}</strong><small>Após conciliação</small></article><article className={styles.metric}><Icon name="relogio" size={17}/><span>Saldo em aberto</span><strong>{money(invoice.totalCents-invoice.paidCents)}</strong><small>Vence {invoice.dueAt.toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"})}</small></article></section>
  <div className={styles.detailLayout}><div className={styles.detailMain}>
    <section className={styles.panel}><header className={styles.panelHeader}><div><h2>Itens da cobrança</h2><p>Valores registrados na emissão</p></div><span className={styles.counter}>{data.lines.length}</span></header><div className={styles.table}><table><thead><tr><th>#</th><th>Descrição</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>{data.lines.map(line=><tr key={line.id}><td>{line.position}</td><td>{line.descriptionSnapshot}</td><td>{line.quantity}</td><td>{money(line.unitPriceCents)}</td><td>{money(line.totalCents)}</td></tr>)}</tbody></table></div></section>
    <section className={styles.panel}><header className={styles.panelHeader}><h2>Pagamentos conciliados</h2><span className={styles.counter}>{data.payments.length}</span></header>{data.payments.length===0?<div className="empty-state"><strong>Nenhum pagamento confirmado</strong><p>O aceite do provedor ainda não confirma o pagamento.</p></div>:<ol className={styles.history}>{data.payments.map(item=><li key={item.id}><strong>{money(item.amountCents)}</strong><p>{item.status}</p><time>{when(item.occurredAt)}</time></li>)}</ol>}</section>
    <section className={styles.panel}><header className={styles.panelHeader}><h2>Histórico da cobrança</h2></header><ol className={styles.history}>{data.events.map(item=><li key={item.id}><strong>#{item.sequence} · {item.type}</strong><p>{item.reason}</p><time>{when(item.occurredAt)}</time></li>)}</ol></section>
  </div><aside className={styles.detailAside}>
    <PaymentActions invoiceId={invoice.id} status={invoice.status} revision={invoice.revision} canManage={data.permissions.manage} canReprocess={data.permissions.reprocess} deadLetterAttempts={data.attempts.filter(item=>item.status==="DEAD_LETTER")}/>
    <section className={styles.panel}><header className={styles.panelHeader}><h2>Tentativas</h2><span className={styles.counter}>{data.attempts.length}</span></header>{data.attempts.length===0?<div className="empty-state"><p>Nenhuma tentativa iniciada.</p></div>:<ol className={styles.history}>{data.attempts.map(item=><li key={item.id}><strong>#{item.sequence} · {item.scenario}</strong><p>{item.status}{item.errorCode?` · ${item.errorCode}`:""}</p><time>{when(item.createdAt)}</time></li>)}</ol>}</section>
    {data.issues.length?<section className={styles.panel}><header className={styles.panelHeader}><h2>Divergências</h2></header><ol className={styles.history}>{data.issues.map(item=><li key={item.id}><strong>{item.reason}</strong><p>{item.status} · revisão humana obrigatória</p></li>)}</ol></section>:null}
  </aside></div>
  <p className={styles.note}>Pagamentos e receita são apurados separadamente. Confirmar um pagamento não altera a receita recorrente.</p>
</main>}
