import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";
import { browserRequest } from "./support/browser-request";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

function uniquePhone(label: string) {
  const hash = createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex");
  const suffix = (BigInt(`0x${hash.slice(0, 12)}`) % 100_000_000n).toString().padStart(8, "0");
  return `+55119${suffix}`;
}

test("gestor consulta registros do Copilot e confirma somente o plano", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  const leadName = `Lead Copilot E2E ${randomUUID().slice(0, 8)}`;
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(leadName);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(leadName));
  await page.getByLabel("Cargo ou atuação").fill("Gestor público fictício");
  await page.getByLabel("Dor ou interesse").fill("Precisa organizar o processo comercial permanente");
  await page.getByLabel("Prioridade").selectOption("P1");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();

  await page.goto("/copilot?preset=MONTH");
  await expect(page.getByRole("heading", { name: "Copilot gerencial" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quais leads precisam de ação hoje?" })).toBeVisible();
  await page.getByRole("button", { name: "Quais leads precisam de ação hoje?" }).click();

  await expect(page.getByText("Resposta direta", { exact: true })).toBeVisible();
  await expect(page.getByText("Local determinístico", { exact: true })).toBeVisible();
  await expect(page.getByText(/Fórmula:/)).toBeVisible();
  await expect(page.getByText(/Numerador:/)).toBeVisible();
  await page.locator("button").filter({ hasText: "Com tarefa vencida/hoje" }).last().click();
  await expect(page.getByRole("heading", { name: /Registros relacionados/ })).toBeVisible();
  await expect(page.getByText(leadName, { exact: true })).toBeVisible();
  await expect(page.getByText("Hipóteses correlacionais; não são afirmações de causalidade.", { exact: true })).toBeVisible();

  await page.getByLabel("Observação obrigatória").fill("Revisar estes registros com o time.");
  await page.getByRole("button", { name: "Confirmar plano" }).click();
  await expect(page.getByRole("status")).toContainText("nenhuma alteração de domínio foi executada");
  await expect(page.getByText("Decisão registrada: plano confirmado.", { exact: true })).toBeVisible();
});

test("visualizador não acessa a consulta gerencial por URL", async ({ page }) => {
  await login(page, DEMO_USERS[7].email);
  await page.goto("/copilot?preset=MONTH");
  await expect(page).toHaveURL(/\/acesso-negado$/);
  await expect(page.getByRole("heading", { name: "Você não tem permissão para esta ação" })).toBeVisible();
  const response = await browserRequest(page).get("/api/ai/manager-copilot?preset=MONTH");
  expect(response.status()).toBe(403);
});
