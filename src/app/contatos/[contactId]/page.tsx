import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import styles from "./contact.module.css";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getWorkspaceExperienceService } from "@/modules/workspace-experience/application/workspace-experience-service";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";
export default async function ContactPage({ params, searchParams }: Readonly<{ params: Promise<{ contactId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication(); const { contactId } = await params; const query = await searchParams; let contact;
  try { contact = await getWorkspaceExperienceService().getContact360(context, contactId, { page: typeof query.page === "string" ? query.page : undefined, pageSize: 20 }); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); if (error instanceof ApplicationError && error.code === "NOT_FOUND") notFound(); throw error; }
  const initials = contact.preferredName.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("");
  return (
    <main className={styles.workspace}>
      <aside className={styles.profile}>
        <Link className={styles.back} href="/leads">← Voltar aos contatos</Link>
        <div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{initials}</span><h1>{contact.preferredName}</h1><p>{contact.jobTitle ?? "Contato"}</p><span className="status-badge">{contact.status}</span></div>
        <div className={styles.shortcuts}><a href="#contact-activity"><Icon name="meu-dia" />Atividades</a><a href="#contact-deals"><Icon name="vendas" />Negócios</a><a href="#contact-conversations"><Icon name="inbox" />Conversas</a></div>
        {contact.primaryAction ? <div className={styles.nextAction}><Button asChild><Link href={contact.primaryAction.href}>{contact.primaryAction.cta}</Link></Button><p>{contact.primaryAction.reason}</p></div> : null}
        <h2 className={styles.sectionLabel}>Informações do contato</h2>
        <dl className={styles.facts}><div><dt>Nome legal</dt><dd>{contact.legalName ?? "Não informado"}</dd></div>{contact.points.map((point) => <div key={point.id}><dt>{point.type}{point.primary ? " principal" : ""}</dt><dd>{point.maskedValue}</dd><small>{point.doNotContact ? "Não contatar" : point.verification}</small></div>)}<div><dt>Qualidade dos dados</dt><dd>{contact.quality}</dd></div></dl>
        <details className={styles.consent}><summary>Consentimentos e privacidade</summary>{contact.consents.length ? <ul>{contact.consents.map((item) => <li key={item.id}><strong>{item.channel}: {item.state}</strong><small>{item.reasonCode}</small></li>)}</ul> : <p>Nenhum consentimento registrado. Isso não autoriza contato.</p>}</details>
      </aside>
      <section className={styles.activity} id="contact-activity">
        <header className={styles.activityHeader}><span>CONTATO / VISÃO GERAL</span><h2>Atividades</h2><p>Acompanhe as próximas ações e o histórico de {contact.preferredName.split(" ")[0]}.</p></header>
        <nav className={styles.tabs} aria-label="Seções do contato"><a href="#contact-activity" aria-current="location">Atividades</a><a href="#contact-meetings">Reuniões <span>{contact.meetings.length}</span></a><a href="#contact-history">Histórico</a></nav>
        <div className={styles.activityBody}>
          <h3>Próxima atividade</h3>
          {contact.primaryAction ? <article className={styles.activityCard}><header><Icon name="meu-dia" /><span>{contact.primaryAction.urgency === "CRITICAL" ? "Ação necessária" : "Próxima ação"}</span></header><div><h4>{contact.primaryAction.title}</h4><p>{contact.primaryAction.reason}</p><Button asChild variant="secondary" size="sm"><Link href={contact.primaryAction.href}>{contact.primaryAction.cta}</Link></Button></div></article> : <EmptyState compact title="Tudo em dia por aqui" description="Não há uma próxima ação indicada para este contato." />}
          <section id="contact-meetings"><h3>Reuniões <span>{contact.meetings.length}</span></h3>{contact.meetings.length ? contact.meetings.map((item) => <Link className={styles.meeting} key={item.id} href={item.href}><Icon name="agenda" /><strong>{item.title}</strong><span className="status-badge">{item.status}</span><Icon name="seta-direita" size={14} /></Link>) : <p className={styles.empty}>Nenhuma reunião vinculada.</p>}</section>
          <section id="contact-history"><h3>Histórico de atividades</h3>{contact.timeline.length ? <ol className={styles.timeline}>{contact.timeline.map((item) => <li key={item.id}><span className={styles.timelineDot} /><article className={styles.activityCard}><header><Icon name="auditoria" size={15} /><span>{item.type}</span><time>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.occurredAt))}</time></header><div><h4>{item.title}</h4><p>{item.provenance}</p>{item.href ? <Link className={styles.textLink} href={item.href}>Ver atividade <Icon name="seta-direita" size={13} /></Link> : null}</div></article></li>)}</ol> : <EmptyState compact title="Nenhuma atividade registrada" description="As interações e alterações do contato aparecerão aqui." />}{contact.hasMoreTimeline ? <Button asChild className="mt-4" variant="secondary"><Link href={`?page=${contact.page + 1}#contact-history`}>Próxima página</Link></Button> : null}</section>
        </div>
      </section>
      <aside className={styles.context}>
        <section><h2>Empresa <span>{contact.accounts.length}</span></h2>{contact.accounts.length ? contact.accounts.map((item) => <Link className={styles.company} key={item.roleId} href={`/contas/${item.accountId}`}><span className={styles.companyAvatar}>{item.accountName.slice(0, 1)}</span><div><strong>{item.accountName}</strong><small>{item.roleType} · {item.validTo ? "Encerrado" : "Ativo"}</small><small>{item.influence} · {item.authority}</small></div></Link>) : <p className={styles.empty}>Sem empresa vinculada.</p>}</section>
        <section id="contact-deals"><h2>Negócios <span>{contact.opportunities.length}</span></h2>{contact.opportunities.length ? contact.opportunities.map((item) => <Link className={styles.deal} href={item.href} key={item.id}><span className="status-badge">{item.status}</span><strong>{item.name}</strong><span className={styles.textLink}>Abrir negócio <Icon name="seta-direita" size={12} /></span></Link>) : <p className={styles.empty}>Nenhum negócio vinculado.</p>}</section>
        <section><h2>Leads <span>{contact.leads.length}</span></h2>{contact.leads.map((item) => <Link className={styles.deal} href={item.href} key={item.id}><strong>{item.name}</strong><small>{item.status}</small></Link>)}{contact.leads.length === 0 ? <p className={styles.empty}>Nenhum lead vinculado.</p> : null}</section>
        <section id="contact-conversations"><h2>Conversas <span>{contact.conversations.length}</span></h2>{contact.conversations.length ? contact.conversations.map((item) => <Link className={styles.deal} key={item.id} href={item.href}><strong>{item.subject ?? item.channel}</strong><small>{item.status}</small></Link>) : <p className={styles.empty}>Nenhuma conversa autorizada.</p>}</section>
      </aside>
    </main>
  );
}
