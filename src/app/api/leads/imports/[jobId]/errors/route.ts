import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getLeadCsvImportService } from "@/modules/leads/application/lead-csv-import-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  try {
    const authentication = await requireApiAuthentication(request);
    const parsed = z.string().uuid().safeParse((await context.params).jobId);
    if (!parsed.success) {
      throw new ApplicationError("Importação não encontrada.", {
        code: "IMPORT_NOT_FOUND",
        statusCode: 404,
        expose: true,
      });
    }
    const report = await getLeadCsvImportService().errorReport(parsed.data, authentication);
    return new NextResponse(report.content, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${report.fileName}"`,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
