import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { enterDemoCompany } from "./helpers/company-hub";

test("financeiro mostra títulos privados, filtros e formulário de baixa", async ({ page }) => {
  if (!/^politizai_test_/.test(new URL(process.env.DATABASE_URL!).searchParams.get("schema") ?? "")) {
    throw new Error("Este cenário exige banco temporário de testes.");
  }
  const database = getDatabaseClient();
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId: workspace.id, user: { normalizedEmail: DEMO_USERS[0]!.email } },
    include: { user: { select: { displayName: true } } },
  });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, userId: member.userId } });
  const version = `browser-fixture-${randomUUID()}`;
  await database.commercialCompensationPolicy.create({ data: {
    workspaceId: workspace.id, version, effectiveDate: new Date("2026-11-01"), recordedById: actor.id,
  } });
  await database.commercialCompensationObligation.create({ data: {
    workspaceId: workspace.id, policyVersion: version, sellerMemberId: member.id,
    obligationKey: `browser:compensation:${randomUUID()}`, kind: "CLOSER_BONUS", status: "APPROVED", competenceMonth: "2026-11",
    amountCents: 12345n, basisCents: 75000n, milestoneOn: new Date("2026-12-01"), eligibleAt: new Date("2026-12-01T03:00:00Z"),
    dueOn: new Date("2026-12-07"), sourceFacts: { fixture: true },
  } });
  await database.otePlan.create({ data: {
    workspaceId: workspace.id, memberId: member.id, effectiveMonth: "2026-11", label: "Plano sintético de metas",
    role: "CLOSER", fixedCents: 370000n, quotaCents: 6000000n, bonusCents: 120000n, updatedByActorId: actor.id,
  } });

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
  await page.goto("/financeiro?section=comissoes&month=12&year=2026");
  const panel = page.getByRole("region", { name: "Remuneração comercial" });
  await expect(panel.getByText("A pagar por vencimento", { exact: true })).toBeVisible();
  await expect(panel.getByRole("row").filter({ hasText: member.user.displayName })).toContainText("R$ 123,45");
  await panel.getByLabel("Estado do título").selectOption("PAID");
  await expect(panel.getByText("Nenhum título no recorte.")).toBeVisible();
  await panel.getByLabel("Estado do título").selectOption("APPROVED");
  await panel.getByRole("button", { name: "Registrar baixa" }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar baixa de remuneração" });
  await expect(dialog.getByLabel("Valor baixado (R$)")).toHaveValue("123,45");
  await expect(dialog.getByLabel("Referência bancária")).toBeVisible();
  await expect(dialog.getByLabel("Evidência da baixa")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("link", { name: "Métricas Metas" }).click();
  await expect(page.getByRole("heading", { name: "Métricas Metas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Meta de NEW ACV" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Bônus de closer" })).toContainText("R$ 123,45");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ote?month=2026-11");
  await expect(page.getByRole("heading", { name: "Meta de NEW ACV" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Bônus de closer" })).toContainText("R$ 123,45");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
