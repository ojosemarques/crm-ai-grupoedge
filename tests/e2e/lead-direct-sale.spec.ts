import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { enterDemoCompany } from "./helpers/company-hub";

for (const { role, existing } of [{ role: "administrator", existing: false }, { role: "closer", existing: false }, { role: "administrator", existing: true }] as const) {
test(`marca vendido no card em um envio (${role}, negócio ${existing ? "preparado" : "novo"})`, async ({ page }) => {
  test.setTimeout(120_000);
  if (!/^politizai_test_/.test(new URL(process.env.DATABASE_URL!).searchParams.get("schema") ?? "")) {
    throw new Error("Este cenário exige banco temporário de testes.");
  }
  const database = getDatabaseClient();
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  // Reproduz a ausência de catálogo elegível encontrada em produção.
  await database.product.updateMany({ where: { workspaceId: workspace.id, name: { not: "SISTEMA POLITIZAI" } }, data: { active: false } });
  await database.contractTemplate.updateMany({ where: { workspaceId: workspace.id, key: { not: "politizai-commercial-record" } }, data: { status: "INACTIVE" } });
  await database.$executeRawUnsafe(readFileSync("scripts/sql/configure-politizai-sales.sql", "utf8"));
  await database.$executeRawUnsafe(readFileSync("scripts/sql/configure-politizai-closer-sales.sql", "utf8"));
  const product = await database.product.findFirstOrThrow({ where: { workspaceId: workspace.id, sku: "SISTEMA-POLITIZAI" } });

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
  const name = `Venda Politizai ${randomUUID().slice(0, 8)}`;
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Telefone", { exact: true }).fill(`+55119${String(Date.now()).slice(-8)}`);
  await page.getByLabel("Cargo ou atuação").fill("Diretor");
  await page.getByLabel("Dor ou interesse").fill("Contratar sistema Politizai");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();
  if (existing) {
    const seller = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: "closer1@demo.politizai.local" } } });
    const lead = await database.lead.findFirstOrThrow({ where: { workspaceId: workspace.id, fullName: name } });
    const prepared = await page.request.post("/api/opportunities/prepare-sale", { headers: { Origin: new URL(page.url()).origin }, data: {
      leadId: lead.id, sellerMemberId: seller.id, productId: product.id,
      description: "Venda preparada antes da simplificação", totalCents: "765432", upfrontCents: "65432", installmentCents: "100000", installmentCount: 7,
      paymentPlan: "UPFRONT_INSTALLMENTS", paymentMethod: "PIX", idempotencyKey: randomUUID(),
    } });
    expect(prepared.ok()).toBe(true);
  }
  if (role === "closer") {
    const seller = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: "closer1@demo.politizai.local" } } });
    const lead = await database.lead.findFirstOrThrow({ where: { workspaceId: workspace.id, fullName: name } });
    await database.lead.update({ where: { id: lead.id }, data: { ownerMemberId: seller.id } });
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("closer1@demo.politizai.local");
    await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await enterDemoCompany(page);
  }
  await page.goto("/leads");
  await page.getByLabel("Busca").fill(name);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page.getByRole("link", { name: `Abrir cartão do lead ${name}` }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+\/historico$/);
  const leadId = new URL(page.url()).pathname.split("/")[2]!;
  const sell = page.locator('[aria-label="Ações comerciais do lead"]').getByRole("button", { name: "Marcar vendido", exact: true });
  await expect(sell).toBeEnabled();
  await sell.click();
  const completion = page.getByRole("tabpanel", { name: "Marcar vendido" });
  await expect(completion.locator("form input, form select, form textarea")).toHaveCount(7);
  if (existing) await expect(completion.getByLabel("Valor total (R$)", { exact: true })).toHaveValue("7654,32");
  await completion.getByRole("combobox", { name: "Vendedor", exact: true }).selectOption({ index: 1 });
  await completion.getByLabel("Valor total (R$)", { exact: true }).fill("7.654,32");
  await completion.getByRole("combobox", { name: "Condição de pagamento", exact: true }).selectOption(role === "closer" ? "CARD_INSTALLMENTS" : "UPFRONT_INSTALLMENTS");
  await completion.getByLabel("Entrada (R$)", { exact: true }).fill("654,32");
  await completion.getByLabel("Valor de cada parcela (R$)").fill("1.000,00");
  const confirm = completion.getByRole("button", { name: "Confirmar e marcar vendido" });
  await expect(confirm).toBeDisabled();
  await completion.getByLabel("Número de parcelas", { exact: true }).fill("6");
  await expect(confirm).toBeDisabled();
  await expect(completion).toContainText(/Total calculado: R\$\s*6\.654,32/);
  await completion.getByLabel("Número de parcelas", { exact: true }).fill("7");
  await completion.getByLabel("Condição de pagamento detalhada").fill("Entrada de R$ 654,32 e 7 parcelas de R$ 1.000,00, negociadas pelo vendedor.");
  await expect(completion.getByText(/7 parcelas/).first()).toBeVisible();
  await expect(completion.getByLabel("Valor já recebido (R$)")).toHaveCount(0);
  await expect(completion.getByRole("button", { name: "Continuar fechamento" })).toHaveCount(0);
  const response = page.waitForResponse((res) => res.url().endsWith("/api/opportunities/close-sale") && res.request().postDataJSON()?.action === "COMPLETE_LEAD");
  await completion.getByRole("button", { name: "Confirmar e marcar vendido" }).click();
  const closed = await response;
  expect(closed.request().postDataJSON().payload.installmentCount).toBe(7);
  expect(await closed.json()).toMatchObject({ result: { receivedCents: "0", outstandingCents: "765432" } });
  expect(closed.ok()).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "Venda registrada" })).toBeVisible();
  await expect(completion.locator("form")).toHaveCount(0);
  const opportunity = await database.opportunity.findFirstOrThrow({ where: { workspaceId: workspace.id, leadId, deletedAt: null } });
  expect(opportunity).toMatchObject({ productId: product.id, status: "WON", tcvCents: 765432n });
  const contracts = await database.commercialContract.findMany({ where: { opportunityId: opportunity.id } });
  expect(contracts).toHaveLength(1);
  const invoices = await database.invoice.aggregate({ where: { contractId: contracts[0]!.id }, _sum: { totalCents: true } });
  expect(invoices._sum.totalCents).toBe(765432n);
});
}
