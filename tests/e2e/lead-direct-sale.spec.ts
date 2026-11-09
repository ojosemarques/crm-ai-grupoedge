import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { enterDemoCompany } from "./helpers/company-hub";

for (const { role, existing, custom } of [
  { role: "administrator", existing: false, custom: false }, { role: "closer", existing: false, custom: false }, { role: "administrator", existing: true, custom: false },
  { role: "administrator", existing: false, custom: true }, { role: "closer", existing: false, custom: true }, { role: "administrator", existing: true, custom: true },
] as const) {
test(`marca vendido no card em um envio (${role}, negócio ${existing ? "preparado" : "novo"}${custom ? ", personalizado" : ""})`, async ({ page }) => {
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
  const confirm = completion.getByRole("button", { name: "Confirmar e marcar vendido" });
  await completion.getByRole("combobox", { name: "Condição de pagamento", exact: true }).selectOption(custom ? "CUSTOM_INSTALLMENTS" : role === "closer" ? "CARD_INSTALLMENTS" : "UPFRONT_INSTALLMENTS");
  if (custom) {
    await expect(confirm).toBeDisabled();
    await completion.getByLabel("Entrada (R$)", { exact: true }).fill("1.000,00");
    for (const [index, value] of ["1.200,00", "2.500,00", "2.500,00"].entries()) {
      if (index > 0) await completion.getByRole("button", { name: "Adicionar grupo de parcelas", exact: true }).click();
      await completion.getByLabel(`Quantidade de parcelas do grupo ${index + 1}`, { exact: true }).fill("3");
      await completion.getByLabel(`Valor de cada parcela do grupo ${index + 1} (R$)`, { exact: true }).fill(value);
    }
    await expect(completion.getByLabel("Valor total (R$)", { exact: true })).toHaveValue("19600,00");
    await expect(completion.getByLabel("Valor total (R$)", { exact: true })).toHaveAttribute("readonly", "");
    await completion.getByRole("button", { name: "Adicionar grupo de parcelas", exact: true }).click();
    await expect(confirm).toBeDisabled();
    await completion.getByRole("button", { name: "Remover grupo 4", exact: true }).click();
    await completion.getByLabel("Quantidade de parcelas do grupo 1", { exact: true }).fill("61");
    await expect(confirm).toBeDisabled();
    await completion.getByLabel("Quantidade de parcelas do grupo 1", { exact: true }).fill("3");
    await expect(completion.getByRole("status")).toContainText(/9 parcelas; MRR médio: R\$\s*2\.066,67/);
    await expect(confirm).toBeEnabled();
    await completion.screenshot({ path: test.info().outputPath("parcelas-personalizadas.png") });
  } else {
  await completion.getByLabel("Valor total (R$)", { exact: true }).fill("7.654,32");
  await completion.getByLabel("Entrada (R$)", { exact: true }).fill("654,32");
  await completion.getByLabel("Valor de cada parcela (R$)").fill("1.000,00");
  await expect(confirm).toBeDisabled();
  await completion.getByLabel("Número de parcelas", { exact: true }).fill("6");
  await expect(confirm).toBeDisabled();
  await expect(completion).toContainText(/Total calculado: R\$\s*6\.654,32/);
  await completion.getByLabel("Número de parcelas", { exact: true }).fill("7");
  await completion.getByLabel("Condição de pagamento detalhada").fill("Entrada de R$ 654,32 e 7 parcelas de R$ 1.000,00, negociadas pelo vendedor.");
  await expect(completion.getByText(/7 parcelas/).first()).toBeVisible();
  }
  await expect(completion.getByLabel("Valor já recebido (R$)")).toHaveCount(0);
  await expect(completion.getByRole("button", { name: "Continuar fechamento" })).toHaveCount(0);
  const response = page.waitForResponse((res) => res.url().endsWith("/api/opportunities/close-sale") && res.request().postDataJSON()?.action === "COMPLETE_LEAD");
  await completion.getByRole("button", { name: "Confirmar e marcar vendido" }).click();
  const closed = await response;
  expect(closed.request().postDataJSON().payload.installmentCount).toBe(custom ? 9 : 7);
  if (custom) expect(closed.request().postDataJSON().payload.installmentGroups).toEqual([{ count: 3, amountCents: "120000" }, { count: 3, amountCents: "250000" }, { count: 3, amountCents: "250000" }]);
  expect(await closed.json()).toMatchObject({ result: { receivedCents: "0", outstandingCents: custom ? "1960000" : "765432" } });
  expect(closed.ok()).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "Venda registrada" })).toBeVisible();
  await expect(completion.locator("form")).toHaveCount(0);
  const opportunity = await database.opportunity.findFirstOrThrow({ where: { workspaceId: workspace.id, leadId, deletedAt: null } });
  expect(opportunity).toMatchObject({ productId: product.id, status: "WON", tcvCents: custom ? 1960000n : 765432n });
  const contracts = await database.commercialContract.findMany({ where: { opportunityId: opportunity.id } });
  expect(contracts).toHaveLength(1);
  const invoices = await database.invoice.aggregate({ where: { contractId: contracts[0]!.id }, _sum: { totalCents: true } });
  expect(invoices._sum.totalCents).toBe(custom ? 1960000n : 765432n);
  if (role === "administrator" && !existing && !custom) {
    await page.goto(`/contas/${opportunity.accountId}/vendas/${opportunity.id}`);
    await expect(page.getByRole("heading", { name: "Parcelas do contrato" })).toBeVisible();
    const last = await database.invoice.findFirstOrThrow({
      where: { contractId: contracts[0]!.id, dueAt: { gt: new Date() }, totalCents: 100000n },
      orderBy: { dueAt: "desc" },
    });
    const entry = await database.invoice.findFirstOrThrow({
      where: { contractId: contracts[0]!.id, totalCents: 165432n },
    });
    await page.getByText("Redistribuir parcelas futuras", { exact: true }).click();
    await page.getByLabel("Corrigir total contratual antes da confirmação").check();
    await page.getByRole("checkbox", { name: last.invoiceNumber, exact: true }).check();
    await page.getByRole("checkbox", { name: entry.invoiceNumber, exact: true }).check();
    await page.getByLabel(`Valor (R$) · ${last.invoiceNumber}`, { exact: true }).fill("980,00");
    await page.getByLabel("Novo total (R$)", { exact: true }).fill("7634,32");
    await page.getByLabel("Entrada revisada (R$)", { exact: true }).fill("600,00");
    await page.getByLabel("Quem aceitou a revisão").fill("Cliente sintético");
    await page.getByLabel("Cargo ou papel").fill("Responsável");
    await page.getByLabel("Evidência do aceite", { exact: true }).fill("Aceite comercial sintético para o desconto.");
    await page.getByRole("textbox", { name: "Condição revisada", exact: true }).fill("Entrada de R$ 600 e desconto de R$ 20 na última parcela.");
    await page.getByLabel("Motivo da revisão", { exact: true }).fill("Desconto comercial sintético acordado");
    const amended = page.waitForResponse((res) => res.url().endsWith("/schedule") && res.request().method() === "POST");
    await page.getByRole("button", { name: "Salvar revisão contratual" }).click();
    expect(await (await amended).json()).toMatchObject({ result: { changed: 2, replayed: false } });
    await expect(page.getByText("Condição contratada: Entrada de R$ 600 e desconto de R$ 20 na última parcela.")).toBeVisible();
    await page.getByLabel("Modalidade").selectOption("ANNUAL_INSTALLMENTS");
    await expect(page.getByLabel("Entrada negociada (R$)")).toHaveValue("600,00");
    await page.getByLabel("Aceite efetivo").fill("2025-11-07T14:00");
    await page.getByLabel("Evidência da origem").fill("Origem comercial sintética");
    await page.getByLabel("Motivo e evidência do aceite").fill("Confirmação de aceite sintético");
    const confirmation = page.waitForResponse((res) => res.url().endsWith("/confirmation") && res.request().method() === "POST");
    await page.getByRole("button", { name: "Salvar confirmação" }).click();
    expect(await (await confirmation).json()).toMatchObject({ result: { revision: 1, replayed: false } });
    await expect(page.getByText(/Última confirmação: revisão 1/)).toBeVisible();
    const future = await database.invoice.findMany({
      where: { contractId: contracts[0]!.id, dueAt: { gt: new Date() }, totalCents: 100000n },
      orderBy: { dueAt: "asc" }, take: 2,
    });
    expect(future).toHaveLength(2);
    await page.getByText("Redistribuir parcelas futuras", { exact: true }).click();
    await page.getByRole("checkbox", { name: future[0]!.invoiceNumber, exact: true }).check();
    await page.getByRole("checkbox", { name: future[1]!.invoiceNumber, exact: true }).check();
    await page.getByLabel(`Valor (R$) · ${future[0]!.invoiceNumber}`, { exact: true }).fill("1100,00");
    await page.getByLabel(`Valor (R$) · ${future[1]!.invoiceNumber}`, { exact: true }).fill("900,00");
    await page.getByLabel("Motivo da revisão", { exact: true }).fill("Redistribuição sintética acordada");
    const reallocated = page.waitForResponse((res) => res.url().endsWith("/schedule") && res.request().method() === "POST");
    await page.getByRole("button", { name: "Salvar redistribuição" }).click();
    expect(await (await reallocated).json()).toMatchObject({ result: { changed: 2, replayed: false } });
    await expect(page.getByRole("row").filter({ hasText: future[0]!.invoiceNumber })).toContainText(/1\.100,00/);
    await page.getByRole("link", { name: "Conferir parcela", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Registrar recebimento" })).toBeVisible();
    await page.goto(`/contas?search=${encodeURIComponent(name)}&status=AWAITING_RECEIPT`);
    await expect(page.getByRole("cell", { name: "Aguardando primeiro recebimento" })).toBeVisible();
  }
  if (custom) {
    const rows = await database.invoice.findMany({ where: { contractId: contracts[0]!.id }, orderBy: { dueAt: "asc" } });
    expect(rows.map(row => row.totalCents)).toEqual([220000n, 120000n, 120000n, 250000n, 250000n, 250000n, 250000n, 250000n, 250000n]);
    expect(opportunity.mrrCents).toBe(206667n);
  }
});
}
