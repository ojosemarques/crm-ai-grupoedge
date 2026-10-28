import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requireWorkspacePagePermission } from "@/modules/auth/http/authentication-guards";
import { getMetaNativeService } from "@/modules/acquisition-api/application/meta-native-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import styles from "../marketing-forms.module.css";

export const dynamic = "force-dynamic";

export default async function NativeFormsPage() {
  await requireWorkspacePagePermission(PermissionKeys.MARKETING_DEFINITIONS_MANAGE, { resourceType: "MarketingForm" });
  const context = await requireWorkspacePagePermission(PermissionKeys.MARKETING_JOURNEY_READ, { resourceType: "MarketingForm" });
  const connections = await getMetaNativeService().list(context);
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Marketing · captação" title="Forms Nativo" description="Formulários instantâneos da Meta e entradas recebidas no CRM, sem duplicar leads." />
    <nav className={styles.formTabs} aria-label="Origem dos formulários"><Link href="/formularios">Formulários CRM</Link><Link href="/formularios/nativos" aria-current="page">Forms Nativo</Link></nav>
    <section className={styles.index}>
      {connections.length ? connections.map((connection) => <section key={connection.id} className={styles.index}>
        <div><h2>{connection.name}</h2><p>{connection.enabled ? "Recepção habilitada" : "Recepção pausada"} · Página {connection.pageId}</p><p>{connection.processed} recebidos · {connection.pending} pendentes · {connection.failed} com falha</p><p>Última entrada: {connection.lastReceivedAt ? new Date(connection.lastReceivedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Aguardando primeiro lead"}</p></div>
        <div className={styles.formGrid}>{connection.forms.map((form) => <article className={styles.formCard} key={form.id}><div><span className={styles.status} data-status={form.status}>{form.status === "ACTIVE" ? "Ativo na Meta" : form.status}</span></div><h3>{form.name}</h3><p>Formulário {form.id}</p><div className={styles.cardMetrics}><span><b>{form.today}</b> leads hoje</span><span><b>{form.total}</b> recebidos no CRM</span></div></article>)}</div>
        {!connection.forms.length ? <p>O catálogo da Meta ainda não foi sincronizado.</p> : null}
        <p>Qualidade enviada à Meta: {connection.feedback.length ? connection.feedback.map((row) => `${row.count} ${row.status === "DELIVERED_EXTERNAL" ? "entregues" : row.status === "DEAD_LETTER" ? "bloqueados ou com falha" : "na fila"}`).join(" · ") : "Nenhum evento de reunião ou venda enviado."}</p>
      </section>) : <div className={styles.empty}><h2>Nenhuma Página conectada</h2><p>A integração precisa de acesso a leads, assinatura de webhooks e destino no CRM para receber os formulários nativos.</p></div>}
    </section>
  </main>;
}
