import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getCommercialMetricBackfillService } from "@/modules/metrics/application/commercial-metric-backfill-service";
import { getCommercialMetricReconciliationService } from "@/modules/metrics/application/commercial-metric-reconciliation-service";
import { COMMERCIAL_METRIC_BACKFILL_RULE_VERSION } from "@/modules/metrics/domain/commercial-metric-quality";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const path = "/api/metrics/integrated/maintenance";

function page(result = "") {
  const body = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Manutenção de métricas</title><main><h1>Manutenção de métricas comerciais</h1><p>Execução restrita a administradores. Cada fato é gravado uma vez e a execução fica auditada.</p><form method="post" action="${path}"><button name="action" value="DRY_RUN">Prévia do backfill</button> <button name="action" value="APPLY">Aplicar backfill</button> <button name="action" value="RECONCILE">Reconciliar</button></form>${result ? `<p role="status">${result}</p>` : ""}<p><a href="/dashboard">Voltar aos indicadores</a></p></main></html>`;
  return new NextResponse(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

async function requireAdministrator(request: NextRequest) {
  const context = await requireApiAuthentication(request);
  if (context.roleKey !== "administrator") {
    throw new ApplicationError("Acesso restrito a administradores.", { code: "FORBIDDEN", statusCode: 403, expose: true });
  }
  return context;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdministrator(request);
    return page();
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireAdministrator(request);
    const form = await request.formData();
    const action = form.get("action");
    const date = new Date().toISOString().slice(0, 10);
    if (action === "DRY_RUN" || action === "APPLY") {
      const run = await getCommercialMetricBackfillService().run(context, {
        mode: action,
        runKey: `commercial-metrics:v${COMMERCIAL_METRIC_BACKFILL_RULE_VERSION}:${date}`,
        batchSize: 100,
      });
      return page(`${action}: ${run.status}; elegíveis ${run.eligibleCount}; criados ${run.createdCount}; já presentes ${run.existingCount}; revisão ${run.reviewCount}; falhas ${run.failedCount}.`);
    }
    if (action === "RECONCILE") {
      const run = await getCommercialMetricReconciliationService().run(context, {
        runKey: `commercial-metrics:reconcile:v${COMMERCIAL_METRIC_BACKFILL_RULE_VERSION}:${date}`,
      });
      return page(`Reconciliação: ${run.status}; esperados ${run.expectedCount}; registrados ${run.actualCount}; lacunas ${run.gapCount}; verificações divergentes ${run.divergentCheckCount}.`);
    }
    throw new ApplicationError("Ação inválida.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
