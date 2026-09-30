import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DEMO_SEED_PASSWORD, DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";

async function login(page:Page,email:string){await page.goto("/login");await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);await page.getByLabel("E-mail").fill(email);await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);await page.getByRole("button",{name:"Entrar"}).click();await expect(page).toHaveURL(/\/$/);}

test("pagamentos mostra dados persistidos, recebimentos e não cria overflow",async({page},testInfo)=>{await login(page,DEMO_USERS[0]!.email);for(const viewport of [{width:1440,height:900},{width:390,height:844}]){await page.setViewportSize(viewport);await page.goto("/pagamentos");await expect(page.getByRole("heading",{name:"Cobranças e pagamentos",level:1})).toBeVisible();await expect(page.getByText("Registre pagamentos recebidos pela página da cobrança.", {exact:false})).toBeVisible();await page.locator("summary").filter({hasText:"Nova cobrança"}).click();await expect(page.getByLabel("Assinatura")).toContainText("SUB-CRM54");const dimensions=await page.evaluate(()=>({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);await page.screenshot({path:testInfo.outputPath(`payments-${viewport.width}x${viewport.height}.png`),fullPage:true});}});

test("visualizador sem permissão financeira não acessa pagamentos",async({page})=>{await login(page,DEMO_USERS.find((user)=>user.key==="viewer")!.email);await page.goto("/pagamentos");await expect(page).toHaveURL(/\/acesso-negado$/);await expect(page.getByRole("heading",{name:"Você não tem permissão para esta ação"})).toBeVisible();expect((await page.request.get("/api/payments")).status()).toBe(403);});

test("@local-only webhook de pagamento rejeita assinatura inválida antes de persistir",async({request})=>{const response=await request.post("/api/local/payments/webhook",{headers:{"content-type":"application/json","x-politizai-workspace-id":randomUUID(),"x-politizai-payment-timestamp":new Date().toISOString(),"x-politizai-payment-signature":"sha256=invalid"},data:{invalid:true}});expect(response.status()).toBe(401);});

test("recebimento exige prévia e atestado, baixa cobrança e aparece na conta financeira", async ({ page }) => {
  await login(page, DEMO_USERS[0]!.email);
  const screenResponse = await page.request.get("/api/payments");
  expect(screenResponse.ok()).toBe(true);
  const screen = (await screenResponse.json()).result;
  const subscription = screen.eligibleSubscriptions[0];
  expect(subscription).toBeTruthy();
  const reference = `e2e-receipt-${randomUUID()}`;
  const accountResponse = await page.request.post("/api/finance", { data: { action: "CREATE_ACCOUNT", name: reference, type: "BANK", openingBalanceCents: "0" } });
  expect(accountResponse.ok()).toBe(true);
  const account = (await accountResponse.json()).result;
  const invoiceResponse = await page.request.post("/api/payments", { data: { subscriptionId: subscription.id, billingPeriodStart: "2098-07-01T03:00:00Z", billingPeriodEnd: "2098-08-01T03:00:00Z", dueAt: "2098-08-05T03:00:00Z", idempotencyKey: reference } });
  expect(invoiceResponse.ok()).toBe(true);
  const invoice = (await invoiceResponse.json()).result;
  const issueResponse = await page.request.post(`/api/payments/${invoice.id}`, { data: { action: "ISSUE", expectedRevision: invoice.revision, reason: "Emissão para recebimento conferido." } });
  expect(issueResponse.ok()).toBe(true);
  await page.goto(`/pagamentos/${invoice.id}`);
  await expect(page.getByRole("button", { name: "Simular pagamento" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Conta financeira", exact: true }).selectOption(account.id);
  await page.getByLabel("Valor recebido (R$)").fill("1,00");
  const localDate = new Date(Date.now() - 60_000);
  const localDateInput = new Date(localDate.getTime() - localDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel("Data e hora do recebimento").fill(localDateInput);
  await page.getByLabel("Referência única do comprovante").fill(reference);
  await page.getByRole("button", { name: "Revisar recebimento" }).click();
  await expect(page.getByRole("button", { name: "Confirmar recebimento" })).toBeDisabled();
  await expect(page.getByText("Saldo restante", { exact: true })).toBeVisible();
  const beforeConfirm = await page.request.get(`/api/payments/${invoice.id}`);
  expect((await beforeConfirm.json()).result.invoice.paidCents).toBe("0");
  await page.getByLabel("Confirmo que este dinheiro foi recebido na conta informada.").check();
  await page.getByRole("button", { name: "Confirmar recebimento" }).click();
  await expect(page.getByText("Recebimento registrado. Cobrança, caixa e indicadores atualizados.")).toBeVisible();
  const detail = (await (await page.request.get(`/api/payments/${invoice.id}`)).json()).result;
  expect(detail.invoice.paidCents).toBe("100");
  expect(detail.payments).toHaveLength(1);
  const finance = (await (await page.request.get("/api/finance")).json()).result;
  expect(finance.accounts.find((item: { id: string }) => item.id === account.id)?.balanceCents).toBe("100");
});
