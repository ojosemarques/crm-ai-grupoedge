import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

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

async function createManualLead(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(name));
  await page.getByLabel("Cargo ou atuação").fill("Gestor público fictício");
  await page.getByLabel("Dor ou interesse").fill("Organizar atendimento comercial");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();
}

test("filtra, configura colunas, salva visão e abre o lead", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  const leadName = `Lead lista E2E ${randomUUID().slice(0, 8)}`;
  const viewName = `Visão E2E ${randomUUID().slice(0, 8)}`;
  await createManualLead(page, leadName);

  await page.goto("/leads");
  await expect(page.locator("select[multiple]")).toHaveCount(0);
  await page.getByLabel("Busca").fill(leadName);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();

  await expect(page).toHaveURL(/q=Lead(?:\+|%20)lista(?:\+|%20)E2E/);
  await expect(page.getByRole("button", { name: new RegExp(`Remover filtro Busca: ${leadName}`) })).toBeVisible();
  await page.getByRole("button", { name: /^Colunas/ }).click();
  const columnsDialog = page.getByRole("dialog", { name: "Colunas exibidas" });
  await columnsDialog.getByRole("checkbox", { name: "Pontuação" }).uncheck();
  await columnsDialog.getByRole("button", { name: "Aplicar colunas" }).click();

  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("link", { name: `Abrir cartão do lead ${leadName}` })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Pontuação" })).toHaveCount(0);

  await page.getByRole("button", { name: "Salvar atual" }).click();
  const saveDialog = page.getByRole("dialog", { name: "Salvar visualização atual" });
  await saveDialog.getByLabel("Nome da nova visualização").fill(viewName);
  await saveDialog.getByRole("button", { name: "Salvar visualização", exact: true }).click();
  await expect(page.getByText("Visualização salva para seu usuário.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Visualização salva")).toContainText(viewName);

  await page.getByLabel("Visualização salva").selectOption({ label: viewName });
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Excluir visualização?" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("button", { name: "Excluir", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await page.getByRole("dialog", { name: "Excluir visualização?" }).getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByText("Visualização removida.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Visualização salva")).not.toContainText(viewName);

  await page.getByRole("link", { name: `Abrir cartão do lead ${leadName}` }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+\/historico$/);
  await expect(page.getByRole("heading", { name: "Cartão 360 do lead" })).toBeVisible();
});

test("confirma redistribuição em massa, audita no domínio e nega visualizador", async ({
  page,
}) => {
  await login(page, DEMO_USERS[1].email);
  const leadName = `Lead lote E2E ${randomUUID().slice(0, 8)}`;
  await createManualLead(page, leadName);
  await page.goto(`/leads?q=${encodeURIComponent(leadName)}`);
  await page.getByRole("checkbox", { name: `Selecionar ${leadName}` }).check();
  await page.getByLabel("Motivo obrigatório").fill("Redistribuição confirmada pelo E2E");
  await page.getByRole("button", { name: "Revisar redistribuição" }).click();
  const bulkDialog = page.getByRole("dialog", { name: "Confirmar redistribuição em massa" });
  await expect(bulkDialog).toBeVisible();
  await bulkDialog.getByRole("button", { name: "Confirmar redistribuição", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 lead(s) redistribuído(s)");

  const leadHref = await page
    .getByRole("link", { name: `Abrir cartão do lead ${leadName}` })
    .getAttribute("href");
  const leadId = leadHref?.split("/")[2];
  expect(leadId).toBeTruthy();
  await page.getByRole("button", { name: "Sair" }).click();
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto(`/leads?q=${encodeURIComponent(leadName)}`);
  await expect(page.getByText(leadName, { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: `Selecionar ${leadName}` }).check();
  await expect(page.getByText(/Ação em massa/)).toHaveCount(0);

  const denial = await page.evaluate(async (id) => {
    const response = await fetch("/api/leads/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadIds: [id],
        target: { type: "GENERAL_QUEUE" },
        reason: "Tentativa direta sem permissão",
      }),
    });
    return { status: response.status, body: await response.json() };
  }, leadId!);
  expect(denial.status).toBe(403);
  expect(denial.body.error.code).toBe("ACCESS_DENIED");

  await page.getByRole("searchbox", { name: "Busca" }).fill(`inexistente-${randomUUID()}`);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nenhum resultado" })).toBeVisible();
});

test("multisseleção, chips, drawer e drilldown preservam URL, foco e mobile", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/leads?priorities=P1&sla=CRITICAL&operationalBucket=OVERDUE");

  await expect(page.getByRole("button", { name: "Remover filtro P1" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Remover filtro SLA: Crítico/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remover filtro Recorte: Atrasados" })).toBeVisible();
  await expect(page.locator("select[multiple]")).toHaveCount(0);

  const priorityTrigger = page.getByRole("button", { name: /^Prioridade: P1/ });
  await priorityTrigger.click();
  const priorityDialog = page.getByRole("dialog", { name: "Filtrar por prioridade" });
  await priorityDialog.getByRole("checkbox", { name: /^P2/ }).check();
  await priorityDialog.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(page).toHaveURL(/priorities=P1%2CP2/);
  await expect(page.getByRole("button", { name: "Remover filtro P2" })).toBeVisible();

  await page.getByRole("button", { name: "Remover filtro P1" }).click();
  await expect(page).toHaveURL(/priorities=P2/);
  await expect(page).not.toHaveURL(/priorities=P1/);

  const responsibleTrigger = page.getByRole("button", { name: /^Responsável:/ });
  await responsibleTrigger.click();
  await expect(page.getByRole("dialog", { name: "Filtrar por responsável" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(responsibleTrigger).toBeFocused();

  const advancedTrigger = page.getByRole("button", { name: /^Mais filtros/ });
  await advancedTrigger.click();
  const advancedDialog = page.getByRole("dialog", { name: "Refine sua lista" });
  await expect(advancedDialog.getByRole("group", { name: /Status/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(advancedTrigger).toBeFocused();

  await advancedTrigger.click();
  const reopenedAdvancedDialog = page.getByRole("dialog", { name: "Refine sua lista" });
  await reopenedAdvancedDialog.getByRole("group", { name: /Status/ }).getByRole("checkbox", { name: "Aberto" }).check();
  await reopenedAdvancedDialog.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/statuses=OPEN/);
  await expect(page.getByRole("button", { name: "Remover filtro Status: Aberto" })).toBeVisible();

  await page.getByRole("button", { name: "Limpar todos", exact: true }).click();
  await expect(page).not.toHaveURL(/priorities|sla|operationalBucket/);
  await expect(page.getByLabel("Filtros ativos")).toHaveCount(0);

  await page.goto("/leads?operationalBucket=MISSING_NEXT_ACTION");
  await expect(page.getByRole("button", { name: "Remover filtro Recorte: Sem próxima ação" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await expect(page.getByRole("button", { name: /^Mais filtros/ })).toBeVisible();
});
