import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { enterDemoCompany } from "./helpers/company-hub";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createMediaPerformanceService } from "@/modules/marketing/application/media-performance-service";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { createRealtimeDashboardService } from "@/modules/realtime-dashboard/application/realtime-dashboard-service";
import { workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

test("Marketing calcula MQL com agendamentos do período, incluindo leads antigos e reuniões futuras", async ({ page }) => {
  const database = getDatabaseClient();
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspace: { slug: "politizai" }, user: { normalizedEmail: DEMO_USERS[1].email } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: member.workspaceId, userId: member.userId, type: "HUMAN" } });
  const context = { workspaceId: member.workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, sessionId: randomUUID(), roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  await ensureAdvertisingPipeline(database, context.workspaceId, context.actorId);
  const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId: context.workspaceId, name: "Anúncios", deletedAt: null } });
  const now = new Date();
  const today = workspaceDateAt(now, "America/Sao_Paulo");
  const start = workspaceDayRange(today, "America/Sao_Paulo").start;
  const intake = createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => now });
  const leadIds: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const result = await intake.intake({ channel: "MANUAL", idempotencyKey: randomUUID(), fullName: `MQL E2E pessoa ${index}`, phone: `+55119${88_000_000 + index}`, sourceKey: "manual", pipelineId: pipeline.id, rawPayload: {} }, context);
    if (result.outcome === "REJECTED") throw new Error(result.issues[0]?.message ?? result.code);
    leadIds.push(result.leadId);
  }
  // An older lead must contribute when its booking is registered today.
  await database.lead.update({ where: { id: leadIds[0]! }, data: { createdAt: new Date(start.getTime() - 86_400_000) } });
  for (const leadId of [...leadIds, leadIds[0]!, leadIds[1]!]) {
    await database.$transaction(tx => recordCommercialMetricFactInTransaction(tx, {
      workspaceId: context.workspaceId, eventKey: randomUUID(), eventType: "MEETING_SCHEDULED", occurredAt: now,
      sourceEntityType: "MeetingHistory", sourceEntityId: randomUUID(), leadId, meetingId: randomUUID(),
      pipelineId: pipeline.id, bookedByMemberId: context.memberId, creditedMemberId: context.memberId,
      safeMetadata: { scheduledFor: new Date(now.getTime() + 10 * 86_400_000).toISOString() },
    }));
  }
  await createRealtimeDashboardService({ database, authorization: createAuthorizationService({ database }), now: () => now }).rotate(context, "http://127.0.0.1:3100");
  const service = createMediaPerformanceService({ database, now: () => now });
  const csv = `date,channelKey,channelName,currency,timeZone,spendCents,impressions,reach,clicks,linkClicks,landingPageViews,reportedLeads,reportedPurchases,reportedRevenueCents\n${today},meta,Meta Ads,BRL,America/Sao_Paulo,20253,6186,5000,106,100,80,15,0,0`;
  const preview = await service.previewImport(context, { fileName: "mql-e2e.csv", csv, idempotencyKey: randomUUID() });
  expect(preview.validCount).toBe(1);
  await service.confirmImport(context, { previewRunId: preview.id, idempotencyKey: randomUUID() });

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[1].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
  for (const path of ["/aquisicao", "/aquisicao/midia"]) {
    await page.goto(`${path}?periodStart=${today}&periodEnd=${today}`);
    const card = page.locator("article").filter({ has: page.getByText("MQL · custo por reunião marcada", { exact: true }) });
    await expect(card).toContainText("R$ 50,63");
    await expect(card).toContainText("4 pessoas agendadas no período");
    await expect(page.getByLabel("Pessoas agendadas no período: 4", { exact: true })).toBeVisible();
  }
  const tvResponse = await page.request.get("/api/public/tempo?front=ADVERTISING");
  expect(tvResponse.ok()).toBe(true);
  const tv = await tvResponse.json();
  expect(tv.result.today.totals.meetingsScheduled).toBe(4);
  expect(tv.result.week.totals.meetingsScheduled).toBe(4);
  await page.screenshot({ path: ".cache/marketing-mql-bookings.png", fullPage: true, animations: "disabled" });
});
