import { NextRequest, NextResponse } from "next/server";

import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { getFinanceService } from "@/modules/finance/application/finance-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asciiFileName(value: string) {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
  return sanitized || "comprovante";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const context = await requireApiAuthentication(request);
    const attachment = await getFinanceService().getAttachment(context, (await params).attachmentId);
    return new NextResponse(Buffer.from(attachment.content), { headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${asciiFileName(attachment.fileName)}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "Content-Type": attachment.mimeType,
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return handleRouteError(error);
  }
}
