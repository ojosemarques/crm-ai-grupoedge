import Link from "next/link";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { DashboardQuery } from "@/modules/metrics/domain/dashboard-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import styles from "./dashboard.module.css";

export async function MarketingCostStatus({ context, query }: Readonly<{ context: AuthenticatedContext; query: DashboardQuery }>) {
  if (query.mode === "PROSPECTING") return <p className={styles.qualityNote}>Investimento de marketing não se aplica à produção de Prospecção Ativa.</p>;
  const permission = await getAuthorizationService().authorize(context, PermissionKeys.MARKETING_MEDIA_READ, { workspaceId: context.workspaceId, resourceType: "MarketingPerformance", memberId: context.memberId });
  if (!permission.allowed || permission.scope !== "WORKSPACE") return <p className={styles.qualityNote}>Dados de investimento indisponíveis neste perfil.</p>;
  const href = `/aquisicao/midia?periodStart=${query.from}&periodEnd=${query.to}`;
  const restrictedDimensions = Object.entries(query.filters).some(([key, values]) => key !== "pipelineIds" && values.length > 0);
  if (restrictedDimensions) return <p className={styles.qualityNote}>Investimento sem atribuição comprovada a este recorte. <Link className="underline" href={href}>Consultar custos de mídia e cobertura</Link>.</p>;
  const costs = await getDatabaseClient().$queryRaw<{ currency: string; cents: bigint }[]>`
    SELECT currency, sum("spendCents")::bigint AS cents FROM (
      SELECT DISTINCT ON ("grainKey") "grainKey", currency, "spendCents", status
      FROM marketing_performance_facts WHERE "workspaceId" = ${context.workspaceId}::uuid
        AND "periodStart" >= ${new Date(query.from)} AND "periodStart" < ${new Date(query.to)}
      ORDER BY "grainKey", revision DESC
    ) current_facts WHERE status = 'CONFIRMED' GROUP BY currency
  `;
  if (!costs.length) return <p className={styles.qualityNote}>Dados de investimento indisponíveis neste período. Custos e retorno permanecem sem cálculo até existir uma fonte elegível. <Link className="underline" href={href}>Ver integrações e cobertura de mídia</Link>.</p>;
  return <p className={styles.qualityNote}>Investimento de mídia confirmado no período: {costs.map((cost) => `${cost.currency} ${(Number(cost.cents) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ")}. Moedas são apresentadas separadamente. <Link className="underline" href={href}>Ver custos, atribuição e cobertura</Link>.</p>;
}
