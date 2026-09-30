import { enterDemoCompany } from "./helpers/company-hub";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return (await response.json()).result;
}

const localTomorrow = () => {
  const value = new Date(Date.now() + 86_400_000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

test("Copilot monta, reordena e confirma um plano inteiro; cancelamento e histórico preservam as etapas", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click(); await enterDemoCompany(page);
  await expect(page).not.toHaveURL(/\/login/);

  const suffix = randomUUID();
  const customer = await post(page, "/api/accounts", { name: `Plano cliente ${suffix}` });
  await page.goto("/contas");
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Chat do Copilot" });
  await drawer.getByRole("button", { name: "Ações", exact: true }).click();
  await drawer.getByLabel("Montar um plano com várias ações").check();
  const builder = drawer.getByRole("region", { name: "Montagem do plano" });
  await expect(builder.getByRole("button", { name: "Preparar prévia do plano" })).toBeDisabled();

  await drawer.getByRole("combobox", { name: "Ação", exact: true }).selectOption("UPDATE_CUSTOMER");
  await drawer.getByRole("combobox", { name: "Cliente", exact: true }).selectOption(customer.id);
  await drawer.getByLabel("Nome", { exact: true }).fill(`Plano atualizado ${suffix}`);
  await drawer.getByRole("button", { name: "Adicionar ao plano", exact: true }).click();
  await expect(builder.getByText("Etapas em preparação · 1/5")).toBeVisible();
  await expect(builder.getByRole("button", { name: "Preparar prévia do plano" })).toBeDisabled();

  await drawer.getByRole("combobox", { name: "Ação", exact: true }).selectOption("CREATE_TASK");
  const taskLeadId = await drawer.getByRole("combobox", { name: "Lead", exact: true }).inputValue();
  await drawer.getByLabel("Título da tarefa").fill(`Plano tarefa ${suffix}`);
  await drawer.getByLabel("Prazo", { exact: true }).fill(localTomorrow());
  await drawer.getByRole("button", { name: "Adicionar ao plano", exact: true }).click();
  await builder.getByRole("button", { name: "Mover etapa 2 para cima", exact: true }).click();
  await expect(builder.locator("ol > li").first()).toContainText("Criar tarefa");
  await expect(builder.locator("ol > li").last()).toContainText("Atualizar cliente");

  const proposedResponse = page.waitForResponse((response) => response.url().endsWith("/api/ai/copilot") && response.request().method() === "POST");
  await builder.getByRole("button", { name: "Preparar prévia do plano", exact: true }).click();
  const proposed = await proposedResponse;
  expect(proposed.ok(), await proposed.text()).toBe(true);
  const proposal = (await proposed.json()).result.proposal;
  const plan = drawer.locator(`section[data-proposal-id="${proposal.id}"]`);
  await expect(plan).toHaveAccessibleName("Prévia do plano");
  await expect(plan.getByRole("list", { name: "Etapas do plano" }).locator(":scope > li")).toHaveCount(2);
  await expect(plan.getByRole("list", { name: "Etapas do plano" }).locator(":scope > li").first()).toContainText(`Plano tarefa ${suffix}`);
  await expect(plan.getByRole("list", { name: "Etapas do plano" }).locator(":scope > li").last()).toContainText(customer.name);
  await expect(plan.getByRole("list", { name: "Etapas do plano" }).locator(":scope > li").last()).toContainText(`Plano atualizado ${suffix}`);
  expect((await (await page.request.get(`/api/accounts/${customer.id}`)).json()).result.name).toBe(customer.name);
  expect((await (await page.request.get(`/api/leads/${taskLeadId}/operations`)).json()).result.tasks.some((item: { title: string }) => item.title === `Plano tarefa ${suffix}`)).toBe(false);
  await expect(plan.getByRole("button", { name: "Confirmar plano", exact: true })).toHaveCount(1);
  await expect(plan.getByRole("button", { name: "Confirmar ação", exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("copilot-plan-mobile-preview.png"), animations: "disabled" });
  const confirmedResponse = page.waitForResponse((response) => response.url().endsWith("/api/ai/copilot") && response.request().method() === "POST");
  await plan.getByRole("button", { name: "Confirmar plano", exact: true }).click();
  const confirmed = await confirmedResponse;
  expect(confirmed.ok(), await confirmed.text()).toBe(true);
  expect((await confirmed.json()).result.result).toMatchObject({ atomic: true, steps: [{ position: 1, kind: "CREATE_TASK" }, { position: 2, kind: "UPDATE_CUSTOMER" }] });
  await expect(plan.getByText("Proposta finalizada. Consulte o histórico.")).toBeVisible();
  expect((await (await page.request.get(`/api/accounts/${customer.id}`)).json()).result.name).toBe(`Plano atualizado ${suffix}`);
  expect((await (await page.request.get(`/api/leads/${taskLeadId}/operations`)).json()).result.tasks.filter((item: { title: string }) => item.title === `Plano tarefa ${suffix}`)).toHaveLength(1);

  const screen = (await (await page.request.get("/api/ai/copilot")).json()).result;
  const cancelled = await post(page, "/api/ai/copilot", { action: "PROPOSE_PLAN", payload: { steps: [
    { kind: "CREATE_TASK", leadId: screen.options.leads[0].id, title: `Cancelada A ${suffix}`, taskKind: "GENERAL", priority: "MEDIUM", dueAt: new Date(Date.now() + 86_400_000).toISOString() },
    { kind: "CREATE_TASK", leadId: screen.options.leads[0].id, title: `Cancelada B ${suffix}`, taskKind: "GENERAL", priority: "MEDIUM", dueAt: new Date(Date.now() + 86_400_000).toISOString() },
  ] } });
  await drawer.getByRole("button", { name: "Histórico", exact: true }).click();
  await drawer.getByRole("button", { name: "Atualizar histórico", exact: true }).click();
  await expect(drawer.locator(`article[data-proposal-id="${cancelled.proposal.id}"]`)).toBeVisible();
  await drawer.getByRole("button", { name: "Conversa", exact: true }).click();
  const cancelledPlan = drawer.locator(`section[data-proposal-id="${cancelled.proposal.id}"]`);
  const cancelResponse = page.waitForResponse((response) => response.url().endsWith("/api/ai/copilot") && response.request().method() === "POST");
  await cancelledPlan.getByRole("button", { name: "Cancelar plano", exact: true }).click();
  const cancelledResult = await cancelResponse;
  expect(cancelledResult.ok(), await cancelledResult.text()).toBe(true);
  await expect(cancelledPlan.getByText("Proposta finalizada. Consulte o histórico.")).toBeVisible();
  expect((await (await page.request.get(`/api/leads/${screen.options.leads[0].id}/operations`)).json()).result.tasks.some((item: { title: string }) => item.title === `Cancelada A ${suffix}` || item.title === `Cancelada B ${suffix}`)).toBe(false);

  await page.reload();
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  await drawer.getByRole("button", { name: "Histórico", exact: true }).click();
  const completedHistory = drawer.locator(`article[data-proposal-id="${proposal.id}"]`);
  await expect(completedHistory.getByText("Executada", { exact: true })).toBeVisible();
  await completedHistory.getByText("Ver dados e efeitos", { exact: true }).click();
  await expect(completedHistory.getByRole("list", { name: "Etapas do plano" }).locator(":scope > li")).toHaveCount(2);
  await expect(drawer.locator(`article[data-proposal-id="${cancelled.proposal.id}"]`).getByText("Cancelada", { exact: true })).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
