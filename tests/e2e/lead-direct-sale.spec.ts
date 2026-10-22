import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { enterDemoCompany } from "./helpers/company-hub";

for (const role of ["administrator", "closer"] as const) {
test(`marca vendido no card com SISTEMA POLITIZAI e valores negociados (${role})`, async ({ page }) => {
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
  const preparation = page.getByRole("region", { name: "Preparar venda do lead" });
  await expect(preparation.getByRole("combobox", { name: "Produto", exact: true })).toHaveValue(product.id);
  await preparation.getByRole("combobox", { name: "Vendedor", exact: true }).selectOption({ index: 1 });
  await preparation.getByLabel("Descrição da venda").fill("Licença do SISTEMA POLITIZAI nas condições combinadas.");
  await preparation.getByLabel("Valor total (R$)", { exact: true }).fill("7.654,32");
  await preparation.getByLabel("Entrada (R$)", { exact: true }).fill("654,32");
  await preparation.getByLabel("Número de parcelas").fill("7");
  await preparation.getByLabel("Valor de cada parcela (R$)").fill("1.000,00");
  await preparation.getByRole("button", { name: "Continuar fechamento" }).click();
  const completion = page.getByRole("tabpanel", { name: "Marcar vendido" });
  await completion.getByRole("combobox", { name: "Cadastro do cliente" }).selectOption("CREATE");
  await completion.getByLabel("Nome confirmado do cliente").fill(name);
  await completion.getByRole("combobox", { name: "Modelo de contrato" }).selectOption({ index: 1 });
  if (role === "closer") {
    await expect(completion.getByLabel("Valor já recebido (R$)")).toHaveAttribute("readonly", "");
    await expect(completion.getByRole("combobox", { name: "Vendedor", exact: true }).locator("option")).toHaveCount(1);
  }
  await expect(completion.getByLabel("Valor total (R$)", { exact: true })).toHaveValue("7654,32");
  await completion.getByLabel("Condição de pagamento detalhada").fill("Entrada de R$ 654,32 e 7 parcelas de R$ 1.000,00 via PIX, negociadas pelo vendedor.");
  await completion.getByLabel("Início de vigência").fill(new Date().toISOString().slice(0, 10));
  await completion.getByLabel("Quem confirmou a venda").fill(name);
  await completion.getByLabel("Cargo ou papel").fill("Diretor");
  await completion.getByRole("button", { name: "Revisar fechamento" }).click();
  await completion.getByRole("checkbox", { name: "Revisei os dados e confirmo a venda e os lançamentos financeiros." }).check();
  const response = page.waitForResponse((res) => res.url().endsWith("/api/opportunities/close-sale") && res.request().postDataJSON()?.action === "EXECUTE");
  await completion.getByRole("button", { name: "Confirmar e marcar vendido" }).click();
  const closed = await response;
  expect(await closed.json()).toMatchObject({ result: { receivedCents: "0", outstandingCents: "765432" } });
  expect(closed.ok()).toBe(true);
  const opportunity = await database.opportunity.findFirstOrThrow({ where: { workspaceId: workspace.id, leadId, deletedAt: null } });
  expect(opportunity).toMatchObject({ productId: product.id, status: "WON", tcvCents: 765432n });
  const contracts = await database.commercialContract.findMany({ where: { opportunityId: opportunity.id } });
  expect(contracts).toHaveLength(1);
  const invoices = await database.invoice.aggregate({ where: { contractId: contracts[0]!.id }, _sum: { totalCents: true } });
  expect(invoices._sum.totalCents).toBe(765432n);
});
}
