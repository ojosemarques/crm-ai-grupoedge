import { enterDemoCompany } from "./helpers/company-hub";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

test("plano solicitado na conversa permite cancelar ou executar todas as etapas e consultar o histórico", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click(); await enterDemoCompany(page);
  const options = (await (await page.request.get("/api/ai/copilot")).json()).result.options;
  const suffix = randomUUID(); let round = 0;
  // Deterministic model boundary; the plan service and transaction are real.
  await page.route("**/api/ai/copilot", async route => {
    if (route.request().method() !== "POST" || route.request().postDataJSON().action !== "CHAT") return route.continue();
    round += 1;
    const steps = [1, 2].map(position => ({ kind: "CREATE_TASK", leadId: options.leads[0].id, title: `Plano ${suffix} ${round} ${position}`, taskKind: "GENERAL", priority: "LOW", dueAt: new Date(Date.now() + 86_400_000).toISOString() }));
    const response = await route.fetch({ postData: JSON.stringify({ action: "PROPOSE_PLAN", payload: { steps } }) });
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Chat do Copilot" });
  for (const decision of ["Cancelar plano", "Confirmar plano"]) {
    await drawer.getByLabel("Pergunte ao Copilot").fill("Prepare um plano de duas tarefas para o lead selecionado.");
    await drawer.getByRole("button", { name: "Enviar pergunta" }).click();
    const plan = drawer.getByRole("region", { name: "Prévia do plano" }).last();
    await expect(plan.getByRole("list", { name: "Etapas do plano" }).locator(":scope > li")).toHaveCount(2);
    await plan.getByRole("button", { name: decision, exact: true }).click();
    await expect(plan.getByText("Proposta finalizada. Consulte o histórico.")).toBeVisible();
  }
  const tasks = JSON.stringify((await (await page.request.get(`/api/leads/${options.leads[0].id}/operations`)).json()).result);
  expect(tasks).not.toContain(`Plano ${suffix} 1 1`); expect(tasks).toContain(`Plano ${suffix} 2 1`); expect(tasks).toContain(`Plano ${suffix} 2 2`);
  await drawer.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(drawer.getByText("Cancelada", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Executada", { exact: true }).first()).toBeVisible();
});
