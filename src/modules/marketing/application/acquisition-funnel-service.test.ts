import { expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadAcquisitionFunnel } from "./acquisition-funnel-service";

it("counts CRM leads by completion without adding anonymous responses to the CRM total", async () => {
  const start = new Date("2026-11-11T03:00:00Z");
  const end = new Date("2026-11-12T03:00:00Z");
  const leads = [
    { id: "quiz-partial", tags: ["Incompleto"] },
    { id: "native-partial", tags: ["Incompleto"] },
    { id: "completed", tags: ["Completo", "Incompleto"] },
    { id: "unclassified", tags: [] },
  ].map(({ id, tags }) => ({
    id, tags: tags.map((name) => ({ tag: { name } })), createdAt: start,
    submissions: [], opportunities: [], meetings: [], source: null, campaign: null, creative: null,
  }));
  const transaction = {
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    marketingFormPartialResponse: { findMany: vi.fn().mockResolvedValueOnce([
      { id: "anonymous", marketingFormId: "form", marketingFormVersionId: "version" },
    ]).mockResolvedValue([]) },
    leadFormSubmission: { findMany: vi.fn().mockResolvedValue([]) },
    marketingForm: { findMany: vi.fn().mockResolvedValue([{ id: "form" }]) },
    marketingFormVersion: { findMany: vi.fn().mockResolvedValue([{ id: "version", definition: {
      destination: {
        pipelineId: "73a6fd99-68e6-414c-90d6-ad15af68cb10",
        initialStageId: "bb04f8ae-daf8-4574-aa98-cec84dcfe9d5",
        sourceKey: "anuncios",
      },
    } }]) },
    pipeline: { findMany: vi.fn().mockResolvedValue([{ id: "73a6fd99-68e6-414c-90d6-ad15af68cb10" }]) },
    leadSource: { findMany: vi.fn().mockResolvedValue([]) },
    lead: { findMany: vi.fn().mockResolvedValue(leads) },
    marketingTouchpoint: { findMany: vi.fn().mockResolvedValue([]) },
    commercialEntityTag: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const database = {
    $transaction: (run: (tx: typeof transaction) => unknown) => run(transaction),
  } as unknown as PrismaClient;

  await expect(loadAcquisitionFunnel(database, "workspace", start, end, "Anúncios")).resolves.toMatchObject({
    cohortSize: 5,
    incompleteCount: 3,
    crmLeads: { total: 4, complete: 1, incomplete: 2, unclassified: 1 },
  });
});
