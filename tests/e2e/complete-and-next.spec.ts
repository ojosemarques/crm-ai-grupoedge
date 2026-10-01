import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

import { enterDemoCompany } from "./helpers/company-hub";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[1].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

function uniquePhone(): string {
  const hash = createHash("sha256").update(randomUUID()).digest("hex");
  const suffix = (BigInt(`0x${hash.slice(0, 12)}`) % 100_000_000n)
    .toString()
    .padStart(8, "0");
  return `+55119${suffix}`;
}

test("conclui atendimento, agenda a próxima ação e abre o próximo lead da fila", async ({
  page,
}) => {
  const leadName = `Lead fluxo rápido ${randomUUID().slice(0, 8)}`;

  await login(page);
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(leadName);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone());
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await page
    .getByRole("link", { name: "Abrir histórico operacional do lead" })
    .click();

  await expect(page.getByRole("heading", { name: leadName, exact: true })).toBeVisible();
  const currentLeadPath = new URL(page.url()).pathname;
  const quickFlow = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Concluir atendimento e abrir próximo",
    }),
  });
  await expect(quickFlow).toBeVisible();
  const form = quickFlow.locator("form");

  const nextLead = quickFlow.locator("[data-next-lead-id]");
  await expect(nextLead).not.toContainText("Preparando…");
  const nextLeadId = await nextLead.getAttribute("data-next-lead-id");
  expect(nextLeadId).toBeTruthy();

  await form.locator('select[name="activityType"]').selectOption("CALL_UNANSWERED");
  await form.locator('select[name="activityResult"]').selectOption("NOT_CONNECTED");
  await form
    .locator('input[name="subject"]')
    .fill("Tentativa concluída pelo fluxo rápido");
  await form
    .locator('textarea[name="resultDescription"]')
    .fill("Lead não atendeu; novo retorno combinado.");
  await form.locator('input[name="nextTitle"]').fill("Retornar pelo fluxo rápido");
  await form.locator('input[name="nextDueAt"]').fill("2035-01-16T10:30");
  await form
    .locator('select[name="targetStageId"]')
    .selectOption({ label: "Tentando contato" });
  await form
    .locator('textarea[name="stageReason"]')
    .fill("Primeira tentativa registrada no fluxo rápido.");
  await quickFlow.getByRole("button", { name: "Concluir e próximo" }).click();

  await expect(page).toHaveURL(new RegExp(`/leads/${nextLeadId}/historico`));
  await expect(
    page.getByRole("heading", {
      name: "Concluir atendimento e abrir próximo",
    }),
  ).toBeVisible();

  await page.goto(currentLeadPath);
  await expect(
    page.getByText("Tentando contato", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Retornar pelo fluxo rápido", { exact: true }).first(),
  ).toBeVisible();
});
