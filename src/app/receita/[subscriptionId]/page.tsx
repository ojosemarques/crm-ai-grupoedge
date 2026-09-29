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
  return <main className="page-canvas"><PageHeader eyebrow="Assinatura" title={s.subscriptionNumber} description={`${s.accountNameSnapshot} · ${s.productNameSnapshot}`} meta={`${s.status} · revisão ${s.revision}`}/><section className="metric-grid"><article className="metric-card"><span>MRR operacional atual</span><strong>{money(s.currentMrrCents)}</strong></article><article className="metric-card"><span>Cadência</span><strong>{s.billingInterval}</strong></article></section><RevenueActions subscriptionId={s.id} status={s.status}/><section className="surface-panel"><h2>Ledger append-only</h2>{data.ledger.length===0?<div className="empty-state"><p>Nenhum movimento. A assinatura ainda não foi ativada.</p></div>:<div className="table-scroll"><table><thead><tr><th>#</th><th>Tipo</th><th>Delta MRR</th><th>Competência</th><th>Motivo</th></tr></thead><tbody>{data.ledger.map(m=><tr key={m.id}><td>{m.sequence}</td><td>{m.type}</td><td>{money(m.deltaMrrCents)}</td><td>{m.effectiveAt.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</td><td>{m.reason}</td></tr>)}</tbody></table></div>}</section><section className="surface-panel"><h2>Histórico da assinatura</h2>{data.history.map(h=><p key={h.id}><strong>{h.event}</strong> · {h.reason} · {h.occurredAt.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</p>)}</section></main>;
}
