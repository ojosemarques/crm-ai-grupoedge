import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return (await response.json()).result;
}
const localDate = (offset: number) => { const date = new Date(Date.now() + offset); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

test("Copilot local confirma tarefas, clientes, despesas e recebimentos com histórico persistido", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const suffix = randomUUID();
  const customer = await post(page, "/api/accounts", { name: `Cliente Copilot ${suffix}`, domain: "copilot.example" });
  const account = await post(page, "/api/finance", { action: "CREATE_ACCOUNT", name: `Banco Copilot ${suffix}`, type: "BANK", openingBalanceCents: "100000" });
  const category = await post(page, "/api/finance", { action: "CREATE_CATEGORY", key: `copilot_${suffix.replaceAll("-", "")}`, name: `Licenças ${suffix}`, kind: "EXPENSE", dreGroup: "despesas_operacionais" });
  const paymentScreen = (await (await page.request.get("/api/payments")).json()).result;
  const invoice = await post(page, "/api/payments", { subscriptionId: paymentScreen.eligibleSubscriptions[0].id, billingPeriodStart: "2097-07-01T03:00:00Z", billingPeriodEnd: "2097-08-01T03:00:00Z", dueAt: "2097-08-05T03:00:00Z", idempotencyKey: suffix });
  await post(page, `/api/payments/${invoice.id}`, { action: "ISSUE", expectedRevision: invoice.revision, reason: "Emissão para teste integrado do Copilot." });
  await page.goto("/financeiro");
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Chat do Copilot" });
  const prepare = async () => {
    const response = page.waitForResponse((item) => item.url().endsWith("/api/ai/copilot") && item.request().method() === "POST", { timeout: 30_000 });
    await drawer.getByRole("button", { name: "Preparar prévia", exact: true }).click();
    const result = await response;
    expect(result.ok(), await result.text()).toBe(true);
    await expect(drawer.getByRole("region", { name: "Prévia da ação" }).last()).toBeVisible();
  };
  const confirm = async () => {
    const response = page.waitForResponse((item) => item.url().endsWith("/api/ai/copilot") && item.request().method() === "POST", { timeout: 30_000 });
    await drawer.getByRole("button", { name: "Confirmar ação", exact: true }).last().click();
    const result = await response;
    expect(result.ok(), await result.text()).toBe(true);
    await expect(drawer.getByText("Proposta finalizada. Consulte o histórico.").last()).toBeVisible();
  };
  const selectAction = async (kind: string) => {
    await drawer.getByRole("button", { name: "Ações", exact: true }).click();
    await drawer.getByRole("combobox", { name: "Ação", exact: true }).selectOption(kind);
  };
  await selectAction("CREATE_TASK");
  await drawer.getByLabel("Título da tarefa").fill(`Retornar contato ${suffix}`);
  await drawer.getByLabel("Prazo", { exact: true }).fill(localDate(86_400_000));
  await prepare();
  await confirm();
  await selectAction("UPDATE_CUSTOMER");
  await drawer.getByRole("combobox", { name: "Cliente", exact: true }).selectOption(customer.id);
  await drawer.getByLabel("Nome", { exact: true }).fill(`Cliente atualizado ${suffix}`);
  await prepare();
  expect((await (await page.request.get(`/api/accounts/${customer.id}`)).json()).result.name).toBe(customer.name);
  await confirm();
  expect((await (await page.request.get(`/api/accounts/${customer.id}`)).json()).result.name).toBe(`Cliente atualizado ${suffix}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await selectAction("CREATE_EXPENSE");
  await drawer.getByLabel("Descrição", { exact: true }).fill(`Software ${suffix}`);
  await drawer.getByRole("combobox", { name: "Categoria", exact: true }).selectOption(category.id);
  await drawer.getByRole("combobox", { name: "Conta financeira", exact: true }).selectOption(account.id);
  await drawer.getByLabel("Valor em reais", { exact: true }).fill("25,00");
  await drawer.getByLabel("Vencimento", { exact: true }).fill(localDate(-60_000));
  await drawer.getByRole("combobox", { name: "Situação", exact: true }).selectOption("SETTLED");
  await drawer.getByLabel("Data do pagamento", { exact: true }).fill(localDate(-60_000));
  await drawer.getByLabel("Confirmo que esta despesa já foi paga na conta selecionada.").check();
  await prepare();
  await confirm();
  await selectAction("RECORD_PAYMENT");
  await drawer.getByRole("combobox", { name: "Cobrança", exact: true }).selectOption(invoice.id);
  await drawer.getByRole("combobox", { name: "Conta financeira", exact: true }).selectOption(account.id);
  await drawer.getByLabel("Valor recebido em reais").fill("1,00");
  await drawer.getByLabel("Quando recebeu").fill(localDate(-60_000));
  await drawer.locator('input[name="reference"]').fill(`Comprovante ${suffix}`);
  await drawer.getByLabel("Confirmo o recebimento real na conta selecionada.").check();
  await prepare();
  expect((await (await page.request.get(`/api/payments/${invoice.id}`)).json()).result.invoice.paidCents).toBe("0");
  await confirm();
  expect((await (await page.request.get(`/api/payments/${invoice.id}`)).json()).result.invoice.paidCents).toBe("100");
  const finance = (await (await page.request.get("/api/finance")).json()).result;
  expect(finance.accounts.find((item: { id: string }) => item.id === account.id)?.balanceCents).toBe("97600");
  await page.reload();
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  await drawer.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(drawer.getByText("Executada", { exact: true })).toHaveCount(4);
  await expect(drawer).toHaveCSS("transform", "none");
  const box = await drawer.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("copilot-actions-mobile.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});
