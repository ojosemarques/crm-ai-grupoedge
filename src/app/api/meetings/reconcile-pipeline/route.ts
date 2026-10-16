import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { assertSameOrigin } from "@/modules/auth/http/request-security";
import { getMeetingPipelineReconciliationService } from "@/modules/meetings/application/meeting-pipeline-reconciliation-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const path = "/api/meetings/reconcile-pipeline";

type Result = Awaited<ReturnType<ReturnType<typeof getMeetingPipelineReconciliationService>["run"]>>;

function resultText(result: Result) {
  return `${result.mode}: ${result.eligibleCount} elegíveis; ${result.movedCount} movidos; ${result.completedCount} realizadas; ${result.noShowCount} no-show; ${result.cancelledCount} canceladas; ${result.alreadyCorrectCount} já corretos; ${result.protectedByNewerStageCount} preservados por alteração posterior; ${result.inconsistentHistoryCount} com histórico inconsistente.`;
}

function page(result?: Result) {
  const status = result ? `<p role="status">${resultText(result)}</p>` : "";
  const body = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Reconciliar reuniões no pipeline</title><main><h1>Reconciliar reuniões na Prospecção Ativa</h1><p>Reuniões realizadas vão para Reunião feita. Canceladas e no-show vão para Noshow. Etapas alteradas depois do resultado são preservadas.</p><form method="post" action="${path}"><button name="mode" value="DRY_RUN">Ver prévia</button> <button name="mode" value="APPLY">Aplicar correção</button></form>${status}<p><a href="/pipeline">Voltar para Prospecção Ativa</a></p></main></html>`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiAuthentication(request);
    const result = await getMeetingPipelineReconciliationService().run(context, { mode: "DRY_RUN" });
    return page(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiAuthentication(request);
    const form = await request.formData();
    const result = await getMeetingPipelineReconciliationService().run(context, { mode: form.get("mode") });
    return page(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
