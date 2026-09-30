import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { assertPipelineRequiredFields } from "./opportunity-required-fields";

function fixture(extraFields: Array<{ fieldKey: string; label: string }> = []) {
  return {
    opportunity: { findFirst: vi.fn().mockResolvedValue({ accountId: null, offers: [], pipeline: { templateApplication: { templateVersion: { stages: [{ position: 5, requiredFields: [{ fieldKey: "accountId", label: "Cliente" }, ...extraFields] }] } } } }) },
    pipelineStage: { findUniqueOrThrow: vi.fn().mockResolvedValue({ position: 5 }) },
  } as unknown as Prisma.TransactionClient;
}

describe("campos obrigatórios no fechamento integrado", () => {
  it("permite cliente planejado somente na prévia; transição real exige o vínculo persistido", async () => {
    const database = fixture();
    await expect(assertPipelineRequiredFields(database, "opportunity", "won", { accountWillBeLinked: true })).resolves.toBeUndefined();
    await expect(assertPipelineRequiredFields(database, "opportunity", "won")).rejects.toMatchObject({ code: "REQUIRED_FIELDS_MISSING" });
  });
  it("mantém as demais exigências do funil ao planejar o vínculo do cliente", async () => {
    await expect(assertPipelineRequiredFields(fixture([{ fieldKey: "productId", label: "Produto" }]), "opportunity", "won", { accountWillBeLinked: true })).rejects.toThrow("Produto");
  });
});
