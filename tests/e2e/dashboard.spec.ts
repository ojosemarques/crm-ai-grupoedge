import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";
import { browserRequest } from "./support/browser-request";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[1].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

function uniquePhone(label: string) {
  const hash = createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex");
  const suffix = (BigInt(`0x${hash.slice(0, 12)}`) % 100_000_000n).toString().padStart(8, "0");
  return `+55119${suffix}`;
}

test("dashboard reconcilia KPI, filtros e drilldown com dados persistidos", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  const request = browserRequest(page);
  const baselineResponse = await request.get("/api/metrics/dashboard?preset=MONTH");
  expect(baselineResponse.ok()).toBe(true);
  const baselinePayload = await baselineResponse.json() as {
    result: { kpis: { id: string; value: number }[] };
  };
  const baselineLeads = baselinePayload.result.kpis.find(({ id }) => id === "leads")?.value ?? 0;
  const integratedBaselineResponse = await request.get("/api/metrics/integrated");
  expect(integratedBaselineResponse.ok()).toBe(true);
  const integratedBaseline = await integratedBaselineResponse.json() as { result: { values: { metricId: string; value: number | string | null }[] } };
  const baselineCanonicalLeads = Number(integratedBaseline.result.values.find(({ metricId }) => metricId === "contacts.leads_created")?.value ?? 0);
  const leadName = `Lead dashboard E2E ${randomUUID().slice(0, 8)}`;
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(leadName);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(leadName));
  await page.getByLabel("Cargo ou atuação").fill("Gestor público fictício");
  await page.getByLabel("Dor ou interesse").fill("Precisa organizar a operação comercial permanente");
  await page.getByLabel("Prioridade").selectOption("P1");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();

  const integratedResponse = await request.get("/api/metrics/integrated");
  expect(integratedResponse.ok()).toBe(true);
  const integrated = await integratedResponse.json() as { result: { values: { metricId: string; value: number | string | null }[] } };
  expect(Number(integrated.result.values.find(({ metricId }) => metricId === "contacts.leads_created")?.value)).toBe(baselineCanonicalLeads + 1);
  const integratedDrilldown = await request.get("/api/metrics/integrated/drilldown?metricId=contacts.leads_created&limit=100");
  expect(integratedDrilldown.ok()).toBe(true);
  const integratedRecords = await integratedDrilldown.json() as { result: { records: { eventType: string; sourceEntityType: string }[] } };
  expect(integratedRecords.result.records.some((record) => record.eventType === "LEAD_CREATED" && record.sourceEntityType === "Lead")).toBe(true);

  await page.goto("/dashboard?preset=MONTH");
  await expect(page.getByRole("heading", { name: "Bom trabalho, Gestor." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evolução comercial" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Seu funil, do primeiro contato à venda" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operação integrada" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Qualidade do PACTO" })).toBeVisible();

  const leadsKpi = page.getByRole("link", { name: /Leads recebidos/ });
  await expect(leadsKpi).toContainText(String(baselineLeads + 1));
  await leadsKpi.click();
  await expect(page).toHaveURL(/\/dashboard\/registros\?.*view=kpi.leads/);
  await expect(page.getByRole("heading", { name: "Leads recebidos" })).toBeVisible();
  await expect(page.getByText(leadName, { exact: true })).toBeVisible();
  await expect(page.getByText("Registros").locator(".." )).toContainText(String(baselineLeads + 1));

  await page.getByRole("link", { name: /Voltar ao dashboard com os mesmos filtros/ }).click();
  await page.locator("details").filter({ has: page.locator('select[name="priority"]') }).locator("summary").click();
  await expect(page.getByLabel("Prioridade")).toBeVisible();
  const response = await request.get("/api/metrics/dashboard?preset=MONTH");
  expect(response.ok()).toBe(true);
  const payload = await response.json() as { result: { priorities: { id: string; value: number }[] } };
  const persistedPriority = payload.result.priorities.find((item) => item.value > 0);
  expect(persistedPriority).toBeTruthy();
  await page.getByLabel("Prioridade").selectOption(persistedPriority!.id);
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(new RegExp(`priority=${persistedPriority!.id}`));
  await expect(page.getByRole("link", { name: /Leads recebidos/ })).not.toContainText(/^\s*0\s*$/);
});

test("dashboard exibe estado vazio honesto para período sem dados", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard?preset=CUSTOM&fromDate=2000-01-01&toDate=2000-01-02");
  await expect(page.getByRole("heading", { name: "Nenhum dado no período" })).toBeVisible();
  await expect(page.getByText("Sem dados para este recorte.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Leads recebidos/ })).toContainText("0");
});
