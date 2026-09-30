import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

function uniquePhone(label: string) {
  const hash = createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex");
  const suffix = (BigInt(`0x${hash.slice(0, 12)}`) % 100_000_000n).toString().padStart(8, "0");
  return `+55119${suffix}`;
}

async function createManualLead(page: import("@playwright/test").Page, name: string) {
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(name));
  await page.getByLabel("Cargo ou atuação").fill("Gestor público fictício");
  await page.getByLabel("Dor ou interesse").fill("Organizar o processo comercial");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();
}

test("opera o pipeline por quadro, lista e cartão sem exigir configurações auxiliares", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  const leadName = `Lead pipeline E2E ${randomUUID().slice(0, 8)}`;
  await createManualLead(page, leadName);

  await page.goto(`/pipeline?q=${encodeURIComponent(leadName)}`);
  await expect(page.getByRole("heading", { name: "Pré-vendas", exact: true })).toBeVisible();
  const card = page.locator("article").filter({ hasText: leadName });
  await expect(card).toBeVisible();
  const pipelineNavigation = page.getByRole("navigation", { name: "Selecionar pipeline" });
  await expect(pipelineNavigation.getByRole("link", { name: "Pré-vendasPré-vendas" })).toHaveAttribute("aria-current", "page");
  await expect(pipelineNavigation.getByRole("link", { name: "VendasVendas" })).toBeVisible();
  await expect(page.getByLabel("Etapa").getByRole("option", { name: "Novo (1)" })).toHaveCount(1);

  const dragHandle = page.getByRole("button", { name: `Arrastar ${leadName}` });
  const destination = page.getByRole("region", { name: "Etapa Tentando contato" });
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dragHandle.dispatchEvent("dragstart", { dataTransfer });
  await destination.dispatchEvent("dragenter", { dataTransfer });
  await destination.dispatchEvent("dragover", { dataTransfer });
  await destination.dispatchEvent("drop", { dataTransfer });
  await dragHandle.dispatchEvent("dragend", { dataTransfer });
  await expect(page.getByRole("status")).toContainText(`${leadName} foi movido para Tentando contato.`);

  await page.getByRole("button", { name: "Lista" }).click();
  await expect(page.getByRole("row").filter({ hasText: leadName })).toContainText("Tentando contato");
  await page.getByRole("button", { name: "Abrir lead" }).click();
  const qualifiedStageId = await page
    .getByLabel("Etapa de destino")
    .locator("option")
    .filter({ hasText: /^Qualificado/ })
    .getAttribute("value");
  expect(qualifiedStageId).toBeTruthy();
  await page.getByLabel("Etapa de destino").selectOption(qualifiedStageId!);
  await page.getByRole("button", { name: "Confirmar transição" }).click();
  await expect(page.getByRole("status")).toContainText(`${leadName} foi movido para Qualificado.`);
  await expect(page.getByRole("row").filter({ hasText: leadName })).toContainText("Qualificado");

  await page.getByRole("button", { name: leadName, exact: true }).click();
  await expect(page).toHaveURL(/\/pipeline(?:\?|$)/);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("dialog", { name: leadName })).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumo do lead" })).toBeVisible();
  await page.getByRole("button", { name: "Fechar painel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("mantém o pipeline somente leitura para o visualizador", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/pipeline");
  await expect(page.getByRole("heading", { name: "Pré-vendas", exact: true })).toBeVisible();
  const firstTransitionButton = page.getByRole("button", { name: "Alterar etapa" }).first();
  if (await firstTransitionButton.count()) await expect(firstTransitionButton).toBeDisabled();
});

test("move leads no celular sem depender de arrastar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, DEMO_USERS[1].email);
  await page.goto("/pipeline");

  const moveButton = page.getByRole("button", { name: /^Mover .+ para outra etapa$/ }).first();
  await expect(moveButton).toBeVisible();
  const touchTarget = await moveButton.boundingBox();
  expect(touchTarget?.height).toBeGreaterThanOrEqual(40);
  expect(touchTarget?.width).toBeGreaterThan(100);

  const card = moveButton.locator("xpath=ancestor::article");
  await expect(card).toHaveAttribute("draggable", "false");
  await expect(card.getByRole("button", { name: /^Arrastar / })).toBeHidden();

  await moveButton.click();
  await expect(page).toHaveURL(/\/pipeline(?:\?|$)/);
  await expect(page.getByRole("dialog")).toBeVisible();
  const stageSelect = page.getByLabel("Etapa de destino");
  await expect(stageSelect).toBeVisible();
  await expect.poll(() => stageSelect.locator("option").count()).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Fechar painel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
