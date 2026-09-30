import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import styles from "@/app/contatos/[contactId]/contact.module.css";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { SectionHeader, Surface } from "@/components/ui/surface";
import { JourneyPanel } from "@/components/lifecycle/journey-panel";
import { getAccountService } from "@/modules/accounts/application/account-service";
import type { AccountDetail } from "@/modules/accounts/domain/account-contracts";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getLifecycleService } from "@/modules/lifecycle/application/lifecycle-service";

export const dynamic = "force-dynamic";
const money = (value: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);

export default async function AccountPage({ params, searchParams }: Readonly<{ params: Promise<{ accountId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication(); const { accountId } = await params; const query = await searchParams; let account: AccountDetail; let journey;
  try { [account, journey] = await Promise.all([getAccountService().get(context, accountId, { page: typeof query.page === "string" ? query.page : undefined }), getLifecycleService().getJourney(context, { entityType: "ACCOUNT", entityId: accountId })]); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); if (error instanceof Error && error.message.includes("não encontrada")) notFound(); throw error; }
  const next = account.customerSuccess.find((item) => item.state === "ACTIVE") ?? null;
  return (
    <main className={styles.workspace}>
      <aside className={styles.profile}>
        <Link className={styles.back} href="/contas">← Voltar às empresas</Link>
        <div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{account.name.slice(0, 2).toUpperCase()}</span><h1>{account.name}</h1><p>{account.legalName ?? account.segment}</p><span className="status-badge" data-tone={account.quality === "CONFIRMED" ? "success" : "warning"}>{account.status}</span></div>
        <div className={styles.shortcuts}><a href="#account-activity"><Icon name="meu-dia" />Atividades</a><a href="#account-people"><Icon name="leads" />Contatos</a><a href="#account-deals"><Icon name="vendas" />Negócios</a></div>
        <div className={styles.nextAction}><Button asChild><Link href={next ? `/customer-success?accountId=${account.id}` : `/oportunidades?accountId=${account.id}`}>{next ? "Abrir carteira" : "Ver oportunidades"}</Link></Button></div>
        <h2 className={styles.sectionLabel}>Informações da empresa</h2>
        <dl className={styles.facts}><div><dt>Documento</dt><dd>{account.originalDocument ?? "Não informado"}</dd></div><div><dt>Domínio</dt><dd>{account.originalDomain ?? "Não informado"}</dd></div><div><dt>Segmento / porte</dt><dd>{account.segment} · {account.size}</dd></div><div><dt>Conta pai</dt><dd>{account.parent ? <Link href={`/contas/${account.parent.id}`}>{account.parent.name}</Link> : "Nenhuma"}</dd></div><div><dt>MRR ativo</dt><dd>{money(account.subscriptions.reduce((sum, item) => sum + BigInt(item.mrrCents), 0n).toString())}</dd></div><div><dt>Sinais de expansão / churn</dt><dd>{account.expansionSignals} / {account.churnEvents}</dd></div><div><dt>Qualidade dos dados</dt><dd>{account.quality} · revisão {account.revision}</dd></div></dl>
      </aside>
      <section className={styles.activity} id="account-activity">
        <header className={styles.activityHeader}><span>EMPRESA / VISÃO GERAL</span><h2>Relacionamento</h2><p>Contatos, atividades e negócios de {account.name}.</p></header>
        <nav className={styles.tabs} aria-label="Seções da empresa"><a href="#account-activity" aria-current="location">Atividades</a><a href="#account-people">Contatos <span>{account.people.length}</span></a><a href="#account-history">Histórico</a></nav>
        <div className={styles.activityBody}>
          <article className={styles.activityCard}><header><Icon name="meu-dia" size={15} /><span>Próxima ação</span></header><div><h4>{next?.nextAction ?? "Revisar relacionamento da conta"}</h4><p>{next ? "Ação prevista na carteira de Customer Success." : "Nenhuma próxima ação de Customer Success registrada."}</p></div></article>
          <JourneyPanel journey={journey} />
          <section id="account-people"><h3>Contatos e comitê de compra <span>{account.people.length}</span></h3>{account.people.length ? account.people.map((person) => <Link className={styles.meeting} href={`/contatos/${person.contactId}`} key={person.roleId}><span className={styles.companyAvatar}>{person.name.slice(0, 1)}</span><div><strong>{person.name}</strong><p className={styles.empty}>{person.roleTitle ?? person.roleType} · {person.influence} · {person.authority}</p></div><Icon name="seta-direita" size={14} /></Link>) : <EmptyState compact title="Nenhum contato vinculado" description="Os contatos confirmados desta empresa aparecerão aqui." />}</section>
          <section id="account-history"><h3>Histórico de atividades</h3>{account.timeline.length ? <ol className={styles.timeline}>{account.timeline.map((item) => <li key={item.id}><span className={styles.timelineDot} /><article className={styles.activityCard}><header><Icon name="auditoria" size={14} /><span>{item.type}</span><time>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.occurredAt))}</time></header><div><h4>{item.title}</h4><p>{item.provenance}</p>{item.href ? <Link className={styles.textLink} href={item.href}>Ver atividade <Icon name="seta-direita" size={13} /></Link> : null}</div></article></li>)}</ol> : <EmptyState compact title="Nenhuma atividade registrada" description="As interações com esta empresa aparecerão aqui." />}{account.hasMoreTimeline ? <Button asChild className="mt-4" variant="secondary"><Link href={`?page=${account.timelinePage + 1}#account-history`}>Próxima página</Link></Button> : null}</section>
          <Surface><SectionHeader title="Solicitações e onboarding" /><div className="entity-groups"><div>{account.requests.map((item) => <Link href={item.href} key={item.id}><span>{item.subject}</span><strong>{item.status}</strong></Link>)}{account.onboarding.map((item) => <Link href={item.href} key={item.id}><span>{item.nextAction}</span><strong>{item.status}</strong></Link>)}{account.requests.length + account.onboarding.length === 0 ? <p className={styles.empty}>Nenhuma solicitação ou onboarding vinculado.</p> : null}</div></div></Surface>
        </div>
      </section>
      <aside className={styles.context}>
        <section><h2>Responsáveis</h2>{account.ownership.length ? account.ownership.map((item) => <div className={styles.deal} key={item.id}><small>{item.function}</small><strong>{item.responsible}</strong></div>) : <p className={styles.empty}>Nenhum responsável funcional vigente.</p>}</section>
        <section id="account-deals"><h2>Negócios <span>{account.opportunities.length}</span></h2>{account.opportunities.map((item) => <Link className={styles.deal} href={`/oportunidades?opportunityId=${item.id}`} key={item.id}><span className="status-badge">{item.status}</span><strong>{item.name}</strong><strong>{money(item.amountCents)}</strong></Link>)}{account.opportunities.length === 0 ? <p className={styles.empty}>Nenhum negócio vinculado.</p> : null}</section>
        <section><h2>Contratos e assinaturas</h2>{account.contracts.map((item) => <Link className={styles.deal} href={`/contratos?contractId=${item.id}`} key={item.id}><strong>{item.number}</strong><small>{item.status}</small></Link>)}{account.subscriptions.map((item) => <Link className={styles.deal} href={`/receita?subscriptionId=${item.id}`} key={item.id}><strong>{item.number}</strong><small>{money(item.mrrCents)} MRR</small></Link>)}{account.contracts.length + account.subscriptions.length === 0 ? <p className={styles.empty}>Nenhum contrato ou assinatura vinculado.</p> : null}</section>
        <section><h2>Leads <span>{account.leads.length}</span></h2>{account.leads.map((item) => <Link className={styles.deal} href={item.href} key={item.id}><strong>{item.name}</strong><small>{item.status}</small></Link>)}</section>
        <section><h2>Renovação</h2>{account.renewals.length ? account.renewals.map((item) => <Link className={styles.deal} href={item.href} key={item.id}><strong>{item.status}</strong><small>{item.risk} · {new Intl.DateTimeFormat("pt-BR").format(new Date(item.targetDate))}</small></Link>) : <p className={styles.empty}>Nenhuma renovação registrada.</p>}</section>
      </aside>
    </main>
  );
}
