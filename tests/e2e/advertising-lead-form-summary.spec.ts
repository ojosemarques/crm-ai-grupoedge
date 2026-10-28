import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { enterDemoCompany } from "./helpers/company-hub";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
}

test.afterAll(async () => getDatabaseClient().$disconnect());

test("vendedor abre as respostas fechadas no Resumo da ficha de Anúncios", async ({ page }, testInfo) => {
  if (!new URL(process.env.DATABASE_URL!).searchParams.get("schema")?.startsWith("politizai_test_")) throw new Error("Ephemeral schema required");
  await login(page, DEMO_USERS[0].email);
  const name = `Resumo Forms E2E ${randomUUID().slice(0, 8)}`;
  await page.goto("/anuncios");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  const entry = page.getByRole("dialog");
  await entry.getByLabel("Nome", { exact: true }).fill(name);
  await entry.getByLabel("Telefone", { exact: true }).fill(`+55119${String(parseInt(randomUUID().slice(0, 8), 16) % 100_000_000).padStart(8, "0")}`);
  await entry.getByRole("button", { name: "Adicionar lead" }).click();
  await expect(page.locator("article").filter({ hasText: name })).toBeVisible();
  const db = getDatabaseClient();
  const workspace = await db.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const lead = await db.lead.findFirstOrThrow({ where: { workspaceId: workspace.id, fullName: name, deletedAt: null } });
  const actor = await db.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, key: "system" } });
  const seller = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: "sdr1@demo.politizai.local" } } });
  await db.lead.update({ where: { id: lead.id }, data: { ownerMemberId: seller.id, queueId: null } });
  await db.leadFormSubmission.create({ data: { workspaceId: workspace.id, leadId: lead.id, sourceId: lead.sourceId, channel: "AD", status: "LINKED", intakeOutcome: "ATTACHED",
    formIdentifier: `meta-native:summary-${randomUUID()}`, idempotencyKey: randomUUID(), submittedFullName: name, submittedAt: new Date(), createdByActorId: actor.id,
    rawPayload: { provider: "META_LEAD_ADS", nativeResponse: { formName: "Formulário nativo de teste", answers: [{ questionKey: "objetivo", question: "Qual é o seu objetivo?", displayValue: "Organizar atendimento" }] } } } });
  await page.context().clearCookies();
  await login(page, "sdr1@demo.politizai.local");
  await page.goto(`/anuncios?q=${encodeURIComponent(name)}`);
  await page.locator("article").filter({ hasText: name }).click();
  const profile = page.getByRole("dialog");
  await profile.getByRole("tab", { name: "Resumo", exact: true }).click();
  const responses = profile.getByRole("region", { name: "Respostas do formulário", exact: true });
  const disclosure = responses.locator("details");
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(responses.getByText("Organizar atendimento", { exact: true })).not.toBeVisible();
  await disclosure.locator("summary").click();
  await expect(responses).toContainText("Formulário nativo de teste · Forms Nativo");
  await expect(responses.getByText("Qual é o seu objetivo?", { exact: true })).toBeVisible();
  await expect(responses.getByText("Organizar atendimento", { exact: true })).toBeVisible();
  await responses.screenshot({ path: testInfo.outputPath("form-responses-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(responses.getByText("Organizar atendimento", { exact: true })).toBeVisible();
  await responses.screenshot({ path: testInfo.outputPath("form-responses-mobile.png") });
  await disclosure.locator("summary").click();
  await expect(responses.getByText("Organizar atendimento", { exact: true })).not.toBeVisible();
});
