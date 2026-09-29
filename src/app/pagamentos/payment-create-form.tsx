"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type SubscriptionOption = Readonly<{id:string;subscriptionNumber:string;accountName:string;productName:string;recurringPriceCents:string;quantity:number}>;
const isoDate=(date:Date)=>date.toISOString().slice(0,10);

export function PaymentCreateForm({subscriptions}:{subscriptions:readonly SubscriptionOption[]}){
  const router=useRouter(); const now=new Date(); const next=new Date(now); next.setMonth(next.getMonth()+1);
  const [subscriptionId,setSubscriptionId]=useState(subscriptions[0]?.id??"");
  const [start,setStart]=useState(isoDate(now)); const [end,setEnd]=useState(isoDate(next)); const [due,setDue]=useState(isoDate(next));
  const [pending,setPending]=useState(false); const [message,setMessage]=useState("");
  async function submit(){if(!subscriptionId){setMessage("Nenhuma assinatura ativa disponível no seu escopo.");return;}setPending(true);setMessage("");const response=await fetch("/api/payments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subscriptionId,billingPeriodStart:`${start}T00:00:00-03:00`,billingPeriodEnd:`${end}T00:00:00-03:00`,dueAt:`${due}T23:59:59-03:00`,idempotencyKey:`payment-ui:${crypto.randomUUID()}`})});const body=await response.json().catch(()=>null);setPending(false);if(!response.ok){setMessage(body?.error?.message??"Não foi possível criar a cobrança.");return;}router.push(`/pagamentos/${body.result.id}`);router.refresh();}
  return <section className="surface-panel"><div className="section-heading"><div><p className="eyebrow">Ação controlada</p><h2>Nova cobrança</h2></div></div>{subscriptions.length===0?<div className="empty-state"><strong>Nenhuma assinatura faturável</strong><p>Ative uma assinatura explicitamente antes de criar a cobrança. Nada será fabricado pelo sistema.</p></div>:<div className="form-grid payment-create-form"><label><span className="field-label">Assinatura</span><select value={subscriptionId} onChange={event=>setSubscriptionId(event.target.value)}>{subscriptions.map(item=><option key={item.id} value={item.id}>{item.subscriptionNumber} · {item.accountName} · {item.productName}</option>)}</select></label><label><span className="field-label">Início da competência</span><input type="date" value={start} onChange={event=>setStart(event.target.value)}/></label><label><span className="field-label">Fim da competência</span><input type="date" value={end} onChange={event=>setEnd(event.target.value)}/></label><label><span className="field-label">Vencimento</span><input type="date" value={due} onChange={event=>setDue(event.target.value)}/></label><div className="button-row"><Button disabled={pending} onClick={submit}>{pending?"Criando…":"Criar rascunho"}</Button></div></div>}{message?<p role="status">{message}</p>:null}</section>;
}
