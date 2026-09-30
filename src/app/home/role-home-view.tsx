"use client";

import Link from "next/link";
import styles from "./home.module.css";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import type { HomeViewKey, RoleHomeScreen } from "@/modules/workspace-experience/domain/workspace-experience-contracts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader, Surface } from "@/components/ui/surface";

const labels: Record<HomeViewKey, string> = { SDR: "SDR", CLOSER: "Closer", FARMER: "Farmer", CUSTOMER_SUCCESS: "Customer Success", MANAGER: "Gestão", ADMIN: "Administração" };
const urgency = { CRITICAL: "Crítico", ATTENTION: "Atenção", NORMAL: "Programado" } as const;

export function RoleHomeView({ screen }: Readonly<{ screen: RoleHomeScreen }>) {
  const router = useRouter();
  return <div className={`role-home ${styles.home}`}>
    <header className="role-home__header">
      <div><p className="page-eyebrow">Meu workspace · {labels[screen.activeView]}</p><h1>Olá, {screen.displayName.split(" ")[0]}</h1><p>Organize seu dia e acompanhe o que precisa da sua atenção.</p></div>
      {screen.availableViews.length > 1 ? <label>Visão<select aria-label="Visão da home" value={screen.activeView} onChange={(event) => router.push(`/?view=${event.target.value}`)}>{screen.availableViews.map((view) => <option key={view} value={view}>{labels[view]}</option>)}</select></label> : <span className="status-badge" data-tone="info">{labels[screen.activeView]}</span>}
    </header>
    {screen.primaryAction ? <Surface className="role-home__focus" tone="accent"><div className="role-home__focus-copy"><span className="status-badge" data-tone={screen.primaryAction.urgency === "CRITICAL" ? "danger" : screen.primaryAction.urgency === "ATTENTION" ? "warning" : "info"}>{urgency[screen.primaryAction.urgency]}</span><p className="role-home__entity">{screen.primaryAction.entityLabel}</p><h2>{screen.primaryAction.title}</h2><p>{screen.primaryAction.reason}</p>{screen.primaryAction.dueAt ? <small>Prazo: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: screen.timeZone }).format(new Date(screen.primaryAction.dueAt))}</small> : null}</div><Button asChild><Link href={screen.primaryAction.href}>{screen.primaryAction.cta}</Link></Button></Surface> : <EmptyState title="Nenhuma ação urgente" description="Não há pendência elegível nesta visão. Os indicadores abaixo continuam mostrando o universo autorizado." />}
    <section aria-label="Resumo da função" className="role-home__metrics">{screen.metrics.map((item) => <Link aria-label={`${item.label}: ${item.value}`} className="role-home__metric" href={item.href ?? "#"} key={item.label}><span><Icon name="tendencia" size={15} />{item.label}</span><strong>{item.value}</strong><small>{item.state === "PARTIAL" ? "Cobertura parcial" : item.state === "UNAVAILABLE" ? "Sem dado suficiente" : "Abrir recorte"}</small></Link>)}</section>
    <Surface className={styles.queue}><SectionHeader title="Próximas atividades" description="Próximas ações já ordenadas por risco e prazo." />{screen.queue.length ? <ol className="role-home__queue">{screen.queue.map((item, index) => <li key={`${item.entityType}:${item.entityId}`}><span>{index + 2}</span><div><strong>{item.entityLabel}</strong><p>{item.title} · {item.reason}</p></div><Button asChild size="sm" variant="secondary"><Link href={item.href}>{item.cta}</Link></Button></li>)}</ol> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma próxima ação adicional neste recorte.</p>}</Surface>
    <p className="role-home__updated">Atualizado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: screen.timeZone }).format(new Date(screen.generatedAt))} · {screen.timeZone}</p>
  </div>;
}
