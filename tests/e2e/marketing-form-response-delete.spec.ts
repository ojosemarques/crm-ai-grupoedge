import { expect, test, type Page } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { enterDemoCompany } from "./helpers/company-hub";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
}

test("gestor exclui uma resposta pela lixeira sem excluir dados vinculados", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/formularios");

  const suffix = Date.now().toString(36);
  const formName = `QA Exclusão ${suffix}`;
  const respondent = `Pessoa Exclusão ${suffix}`;
  const slug = `qa-exclusao-${suffix}`;
  await page.getByRole("button", { name: "Novo formulário" }).click();
  const createDialog = page.getByRole("dialog", { name: "Comece pelo nome e endereço" });
  await createDialog.getByLabel("Nome").fill(formName);
  await createDialog.locator("input").nth(1).fill(slug);
  await createDialog.getByRole("button", { name: "Criar e editar" }).click();
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("status")).toHaveText("Nova versão publicada.");

  const formId = new URL(page.url()).pathname.split("/").at(-1)!;
  const database = getDatabaseClient();
  const form = await database.marketingForm.findUniqueOrThrow({ where: { id: formId }, select: { workspaceId: true, publishedVersionId: true, createdByActorId: true } });
  const receipt = await database.marketingFormReceipt.create({ data: {
    workspaceId: form.workspaceId,
    marketingFormId: formId,
    marketingFormVersionId: form.publishedVersionId!,
    idempotencyHash: `e2e-delete-${suffix}`,
    status: "ACCEPTED",
    answers: [{ questionKey: "nome-completo", value: respondent }],
    startedAt: new Date(),
    submittedAt: new Date(),
    acceptedAt: new Date(),
    createdByActorId: form.createdByActorId,
  } });
  const source = await database.leadSource.findFirstOrThrow({ where: { workspaceId: form.workspaceId, deletedAt: null }, select: { id: true } });
  await database.leadFormSubmission.create({ data: {
    workspaceId: form.workspaceId,
    sourceId: source.id,
    marketingFormId: formId,
    marketingFormVersionId: form.publishedVersionId!,
    marketingFormReceiptId: receipt.id,
    status: "RECEIVED",
    idempotencyKey: `e2e-delete-${suffix}`,
    submittedFullName: respondent,
    submittedAt: new Date(),
    rawPayload: {},
    createdByActorId: form.createdByActorId,
  } });

  await page.getByRole("button", { name: "Respostas" }).click();
  await expect(page.getByText("1 resposta", { exact: true })).toBeVisible();
  const deleteButton = page.getByRole("button", { name: `Excluir resposta de ${respondent}` });
  await deleteButton.click();
  const deleteDialog = page.getByRole("dialog", { name: "Excluir esta resposta?" });
  await expect(deleteDialog).toContainText("O lead criado no CRM será preservado.");
  await deleteDialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  await deleteDialog.getByRole("button", { name: "Excluir resposta" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Resposta excluída." })).toHaveText("Resposta excluída. O lead vinculado foi preservado no CRM.");
  await expect(page.getByText("0 respostas", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: respondent })).toHaveCount(0);
});
