import type { PrismaClient } from "@/generated/prisma/client";
import { metaNativeResponseSchema } from "@/modules/acquisition-api/domain/meta-native-answers";
import {
  summarizeMarketingFormAnswers,
  type MarketingFormResponseSummary,
} from "@/modules/marketing-forms/domain/marketing-form-response-summary";

export async function responsesByLead(
  database: PrismaClient,
  workspaceId: string,
  leadIds: readonly string[],
): Promise<ReadonlyMap<string, readonly MarketingFormResponseSummary[]>> {
  const uniqueLeadIds = [...new Set(leadIds)];
  if (uniqueLeadIds.length === 0) return new Map();
  const submissions = await database.leadFormSubmission.findMany({
    where: {
      workspaceId,
      leadId: { in: uniqueLeadIds },
      OR: [
        { marketingFormId: { not: null }, marketingFormVersionId: { not: null }, marketingFormReceiptId: { not: null } },
        { channel: "AD", formIdentifier: { startsWith: "meta-native:" }, rawPayload: { path: ["provider"], equals: "META_LEAD_ADS" } },
      ],
    },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    select: {
      leadId: true,
      marketingFormId: true,
      marketingFormVersionId: true,
      marketingFormReceiptId: true,
      submittedPhone: true,
      id: true,
      submittedAt: true,
      rawPayload: true,
    },
  });
  const receiptIds = submissions.flatMap((submission) => submission.marketingFormReceiptId ? [submission.marketingFormReceiptId] : []);
  const [receipts, forms, versions] = await Promise.all([
    receiptIds.length ? database.marketingFormReceipt.findMany({
      where: { workspaceId, id: { in: receiptIds }, status: "ACCEPTED", deletedAt: null },
      select: { id: true, marketingFormId: true, marketingFormVersionId: true, submittedAt: true, answers: true },
    }) : [],
    receiptIds.length ? database.marketingForm.findMany({
      where: { workspaceId, id: { in: submissions.flatMap((submission) => submission.marketingFormId ? [submission.marketingFormId] : []) } },
      select: { id: true, name: true },
    }) : [],
    receiptIds.length ? database.marketingFormVersion.findMany({
      where: { workspaceId, id: { in: submissions.flatMap((submission) => submission.marketingFormVersionId ? [submission.marketingFormVersionId] : []) } },
      select: { id: true, definition: true },
    }) : [],
  ]);
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const formNameById = new Map(forms.map((form) => [form.id, form.name]));
  const definitionById = new Map(versions.map((version) => [version.id, version.definition]));
  const result = new Map<string, MarketingFormResponseSummary[]>();
  for (const submission of submissions) {
    const raw = submission.rawPayload as Record<string, unknown> | null;
    if (submission.leadId && raw?.provider === "META_LEAD_ADS") {
      const native = metaNativeResponseSchema.safeParse(raw.nativeResponse);
      if (native.success) {
        const current = result.get(submission.leadId) ?? [];
        current.push({ receiptId: submission.id, formName: `${native.data.formName} · Forms Nativo`, submittedAt: submission.submittedAt.toISOString(), phone: submission.submittedPhone, answers: native.data.answers });
        result.set(submission.leadId, current);
      }
      continue;
    }
    if (!submission.leadId || !submission.marketingFormReceiptId || !submission.marketingFormId || !submission.marketingFormVersionId) continue;
    const receipt = receiptById.get(submission.marketingFormReceiptId);
    const definition = definitionById.get(submission.marketingFormVersionId);
    if (!receipt || !definition || receipt.marketingFormId !== submission.marketingFormId || receipt.marketingFormVersionId !== submission.marketingFormVersionId) continue;
    const response: MarketingFormResponseSummary = {
      receiptId: receipt.id,
      formName: formNameById.get(submission.marketingFormId) ?? "Formulário",
      submittedAt: receipt.submittedAt.toISOString(),
      phone: submission.submittedPhone,
      answers: summarizeMarketingFormAnswers(definition, receipt.answers),
    };
    const current = result.get(submission.leadId) ?? [];
    current.push(response);
    result.set(submission.leadId, current);
  }
  return result;
}
