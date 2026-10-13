import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

function uniquePhone(label: string): string {
  const hex = createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex");
  const suffix = (BigInt(`0x${hex.slice(0, 12)}`) % 100_000_000n)
    .toString()
    .padStart(8, "0");
  return `+55119${suffix}`;
}

test("cadastro manual usa normalização, distribuição e SLA persistidos", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/leads/entrada");
  await expect(page.getByRole("heading", { name: "Entrada de leads" })).toBeVisible();

  const phone = uniquePhone("e2e-manual");
  const pipelineSelect = page.getByRole("combobox", { name: "Pipeline", exact: true });
  const sellerSelect = page.getByRole("combobox", { name: "Vendedor responsável", exact: true });
  await expect(pipelineSelect).toBeVisible();
  await expect(sellerSelect).toBeVisible();
  const pipelineOptions = await pipelineSelect.evaluate((select) =>
    Array.from((select as HTMLSelectElement).options, ({ value }) => value),
  );
  const sellerOptions = await sellerSelect.evaluate((select) =>
    Array.from((select as HTMLSelectElement).options, ({ value }) => value),
  );
  expect(pipelineOptions.length).toBeGreaterThan(1);
  expect(sellerOptions.length).toBeGreaterThan(1);
  const pipelineId = pipelineOptions.at(-1);
  const ownerMemberId = sellerOptions.at(-1);
  expect(pipelineId).toBeTruthy();
  expect(ownerMemberId).toBeTruthy();
  await pipelineSelect.selectOption(pipelineId!);
  await sellerSelect.selectOption(ownerMemberId!);
  await page.getByLabel("Nome", { exact: true }).fill("Lead E2E fictício");
  await page.getByLabel("Telefone", { exact: true }).fill(phone);
  await page.getByLabel("Dor ou interesse").fill("Validar o fluxo completo de entrada.");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();

  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();
  const result = page.getByRole("status").filter({ hasText: "Entrada processada" });
  await expect(result).toContainText('"outcome": "CREATED"');
  await expect(result).toContainText(`"normalizedPhone": "${phone}"`);
  await expect(result).toContainText('"slaCycleId"');
  await expect(result).toContainText('"taskId"');

  const lead = await getDatabaseClient().lead.findFirstOrThrow({
    where: { normalizedPhone: phone, deletedAt: null },
    select: { pipelineId: true, ownerMemberId: true },
  });
  expect(lead).toMatchObject({ pipelineId, ownerMemberId });
});

test("vendedor da Prospecção Ativa cadastra lead e escolhe qualquer vendedor", async ({ page }) => {
  const database = getDatabaseClient();
  const seller = await database.workspaceMember.findFirstOrThrow({
    where: { user: { normalizedEmail: DEMO_USERS[2].email } },
    select: { id: true, workspaceId: true, userId: true },
  });
  const targetOwner = await database.workspaceMember.findFirstOrThrow({
    where: {
      workspaceId: seller.workspaceId,
      user: { normalizedEmail: DEMO_USERS[5].email },
    },
    select: { id: true },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: {
      workspaceId: seller.workspaceId,
      userId: seller.userId,
      type: "HUMAN",
    },
    select: { id: true },
  });
  const nextRotation = (await database.prospectingSellerConfig.aggregate({
    where: { workspaceId: seller.workspaceId },
    _max: { rotationPosition: true },
  }))._max.rotationPosition ?? -1;
  await database.prospectingSellerConfig.upsert({
    where: {
      workspaceId_memberId: {
        workspaceId: seller.workspaceId,
        memberId: seller.id,
      },
    },
    create: {
      workspaceId: seller.workspaceId,
      memberId: seller.id,
      active: true,
      dailyCapacity: 75,
      reservePercent: 10,
      rotationPosition: nextRotation + 1,
      createdByActorId: actor.id,
      updatedByActorId: actor.id,
    },
    update: {
      active: true,
      pausedReason: null,
      updatedByActorId: actor.id,
    },
  });
  const pipeline = await database.pipeline.findFirstOrThrow({
    where: {
      workspaceId: seller.workspaceId,
      entityType: "LEAD",
      name: "Prospecção Ativa",
      deletedAt: null,
    },
    select: { id: true },
  });

  await login(page, DEMO_USERS[2].email);
  await page.goto("/leads/entrada");
  await expect(page.getByRole("heading", { name: "Entrada de leads" })).toBeVisible();

  const pipelineSelect = page.getByRole("combobox", { name: "Pipeline", exact: true });
  const sellerSelect = page.getByRole("combobox", { name: "Vendedor responsável", exact: true });
  await expect(pipelineSelect.locator("option")).toHaveCount(1);
  await expect(pipelineSelect).toHaveValue(pipeline.id);
  await expect(sellerSelect.locator(`option[value="${targetOwner.id}"]`)).toHaveText(
    DEMO_USERS[5].displayName,
  );

  const phone = uniquePhone("e2e-active-prospecting-seller");
  await sellerSelect.selectOption(targetOwner.id);
  await page.getByLabel("Nome", { exact: true }).fill("Lead E2E da prospecção ativa");
  await page.getByLabel("Telefone", { exact: true }).fill(phone);
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();

  await expect(database.lead.findFirstOrThrow({
    where: { workspaceId: seller.workspaceId, normalizedPhone: phone },
    select: { pipelineId: true, ownerMemberId: true },
  })).resolves.toEqual({
    pipelineId: pipeline.id,
    ownerMemberId: targetOwner.id,
  });
});

test("erro de validação manual mantém os valores preenchidos", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill("Formulário preservado");
  await page.getByLabel("Telefone", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();

  await expect(page.getByText("Revise os dados", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Formulário preservado");
  await expect(page.getByLabel("Telefone", { exact: true })).toHaveValue("123");
});

test("CSV exige preview antes da confirmação e persiste o ImportJob", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/leads/entrada");
  await page.waitForLoadState("networkidle");
  const phone = uniquePhone("e2e-csv");
  const csv = `nome,telefone,email,prioridade\nLead CSV E2E,${phone},csv-e2e@example.invalid,P1`;

  await page.locator('input[type="file"]').setInputFiles({
    name: "leads-e2e.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Gerar preview" }).click();
  await expect(page.getByText(/1 linhas · 1 válidas · 0 duplicadas · 0 inválidas/)).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importação" }).click();

  await expect(page.getByText("Importação concluída", { exact: true })).toBeVisible();
  const result = page.getByRole("status").filter({ hasText: "Importação concluída" });
  await expect(result).toContainText('"status": "SUCCEEDED"');
  await expect(result).toContainText('"processedRows": 1');
});

test("@local-only webhook local é idempotente e simulador explicita cenário duplicado", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/leads/entrada");
  const eventId = `e2e-${randomUUID()}`;
  const webhookPayload = {
    eventId,
    eventType: "lead.received",
    lead: {
      fullName: "Webhook E2E fictício",
      phone: uniquePhone("e2e-webhook"),
      sourceKey: "website",
      priorityBandCode: "P2",
    },
  };
  await page.getByLabel("Payload JSON").fill(JSON.stringify(webhookPayload, null, 2));
  await page.getByRole("button", { name: "Enviar evento local" }).click();
  await expect(page.getByText("Evento local processado", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Evento local processado" })).toContainText('"idempotentReplay": false');

  await page.getByRole("button", { name: "Enviar evento local" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Evento local processado" })).toContainText('"idempotentReplay": true');

  await page.getByLabel("Cenário").selectOption("DUPLICATE");
  await page.getByLabel("Semente reprodutível").fill(`e2e-duplicate-${randomUUID()}`);
  await page.getByRole("button", { name: "Simular chegada" }).click();
  await expect(page.getByText("Simulação concluída — dados fictícios", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Simulação concluída — dados fictícios" })).toContainText('"outcome": "ATTACHED"');
});

test("visualizador não acessa a entrada alterando a URL", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/leads/entrada");
  await expect(page).toHaveURL(/\/acesso-negado$/);
  await expect(page.getByRole("heading", { name: "Você não tem permissão para esta ação" })).toBeVisible();
});
