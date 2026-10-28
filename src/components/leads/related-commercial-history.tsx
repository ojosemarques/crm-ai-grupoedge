import Link from "next/link";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getRelatedCommercialHistoryService } from "@/modules/contacts/application/related-commercial-history-service";
import { getDatabaseClient } from "@/shared/core/database/client";

export async function RelatedCommercialHistory({ context, leadId }: Readonly<{ context: AuthenticatedContext; leadId: string }>) {
  const rows = await getRelatedCommercialHistoryService().getHistory(context, leadId);
  if (!rows.length) return null;
  const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
  return <aside className="mb-4 rounded-lg border bg-muted/30 p-4" aria-label="Histórico comercial relacionado">
    <h2 className="font-semibold">Histórico comercial anterior ou relacionado</h2>
    <p className="text-sm text-muted-foreground">A entrada atual foi preservada. Os links abrem contatos, reuniões e resultados disponíveis no histórico de cada registro.</p>
    <ul className="mt-2 space-y-2 text-sm">{rows.slice(0, 10).map((row) => <li key={row.id}><strong>{row.confirmed ? "Mesmo contato" : "Possível coincidência de contato — identidade não confirmada"}</strong>: {row.pipeline.name} · {row.currentStage.name} · origem {row.source.name} · {new Intl.DateTimeFormat("pt-BR", { timeZone: workspace.timeZone, dateStyle: "short" }).format(new Date(row.createdAt))} · {row.owner?.user.displayName ?? "Sem responsável"}. <Link className="text-link underline" href={`/leads/${row.id}/historico`}>Ver histórico</Link></li>)}</ul>
    {rows.length > 10 ? <p className="text-xs">Exibindo os dez registros mais recentes permitidos.</p> : null}
  </aside>;
}
