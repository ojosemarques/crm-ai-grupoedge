import { enterDemoCompany } from "./helpers/company-hub";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

test("conversa apresenta prévia, executa ações reais e mantém somente Conversas e Histórico", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click(); await enterDemoCompany(page);
  for (const data of [
    { action: "CREATE_ACCOUNT", name: `Caixa conversa ${randomUUID()}`, type: "CASH", openingBalanceCents: "0" },
    { action: "CREATE_CATEGORY", key: `chat_${randomUUID().replaceAll("-", "")}`, name: "Despesa conversa", kind: "EXPENSE" },
  ]) { const response = await page.request.post("/api/finance", { data }); expect(response.ok(), await response.text()).toBe(true); }
  const options = (await (await page.request.get("/api/ai/copilot")).json()).result.options;
  const name = `Cliente conversa ${randomUUID()}`;
  const taskTitle = `Tarefa conversa ${randomUUID()}`;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  let operation: unknown;
  // Replace only the external model's interpretation. Proposal, authorization,
  // confirmation and all domain writes still run against the real local API/DB.
  await page.route("**/api/ai/copilot", async route => {
    const request = route.request();
    if (request.method() !== "POST" || request.postDataJSON().action !== "CHAT") return route.continue();
    expect(request.postDataJSON().message).toBeTruthy();
    const response = await route.fetch({ postData: JSON.stringify({ action: "PROPOSE", payload: operation }) });
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Chat do Copilot" });
  await expect(drawer.getByRole("navigation", { name: "Seções do Copilot" }).getByRole("button")).toHaveText(["Conversas", "Histórico"]);
  await expect(drawer.getByRole("button", { name: "Ações", exact: true })).toHaveCount(0);
  const actions = [
    { kind: "CREATE_CUSTOMER", name, segment: "UNKNOWN", size: "UNKNOWN" },
    { kind: "CREATE_TASK", leadId: options.leads[0].id, title: taskTitle, taskKind: "CALL", priority: "HIGH", dueAt: tomorrow },
    { kind: "CREATE_EXPENSE", description: "Licença solicitada na conversa", categoryId: options.categories[0].id, financialAccountId: options.financialAccounts[0].id, amountCents: "2500", competenceAt: tomorrow, dueAt: tomorrow, status: "PLANNED" },
  ];
  for (const action of actions) {
    operation = action;
    await drawer.getByLabel("Pergunte ao Copilot").fill(`Prepare ${action.kind} com os dados informados.`);
    await drawer.getByRole("button", { name: "Enviar pergunta" }).click();
    const preview = drawer.getByRole("region", { name: "Prévia da ação" }).last();
    await expect(preview).toBeVisible();
    if (action.kind === "CREATE_CUSTOMER") {
      const accounts = (await (await page.request.get(`/api/accounts?search=${encodeURIComponent(name)}`)).json()).result;
      expect(JSON.stringify(accounts)).not.toContain(name);
    }
    const response = page.waitForResponse(r => r.url().endsWith("/api/ai/copilot") && r.request().method() === "POST" && r.request().postDataJSON().action === "CONFIRM");
    await preview.getByRole("button", { name: "Confirmar ação", exact: true }).click();
    const result = await response; expect(result.ok(), await result.text()).toBe(true);
    await expect(preview.getByText("Proposta finalizada. Consulte o histórico.")).toBeVisible();
  }
  expect(JSON.stringify((await (await page.request.get(`/api/accounts?search=${encodeURIComponent(name)}`)).json()).result)).toContain(name);
  expect(JSON.stringify((await (await page.request.get(`/api/leads/${options.leads[0].id}/operations`)).json()).result)).toContain(taskTitle);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload(); await page.getByRole("button", { name: "Copilot", exact: true }).click();
  await drawer.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(drawer.getByText("Executada", { exact: true })).toHaveCount(3);
  const box = await drawer.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("copilot-conversation-mobile.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});
