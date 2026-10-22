import { expect, test } from "@playwright/test";

import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";
import type { RealtimeDashboardSnapshot } from "@/modules/realtime-dashboard/domain/realtime-dashboard-contracts";
import { aggregateRealtimeDashboard, resolveRealtimeDashboardPeriods, weeklySalesGoal } from "@/modules/realtime-dashboard/domain/realtime-dashboard-domain";

function rankingSnapshot(): RealtimeDashboardSnapshot {
  const now = new Date("2026-10-22T18:00:00Z");
  const sellers = [
    { id: "carlos", name: "Carlos Henrique" },
    { id: "jhon", name: "Jhon Cunha" },
    { id: "ede", name: "Ede Rafael" },
  ];
  const fact = (id: string, eventType: string, creditedMemberId: string, quantity: number, occurredAt = "2026-10-22T14:00:00Z"): IntegratedActivityFact => ({
    id, eventType, creditedMemberId, quantity, occurredAt, sourceEntityType: "Activity", leadId: null,
    performedByMemberId: null, bookedByMemberId: null, taskKind: null, result: null, cadenceStepKey: null, valueCents: null,
  });
  const result = aggregateRealtimeDashboard([
    fact("c-agendas", "MEETING_SCHEDULED", "carlos", 1),
    fact("j-agendas", "MEETING_SCHEDULED", "jhon", 2),
    fact("e-agendas", "MEETING_SCHEDULED", "ede", 3),
    fact("c-semana", "MEETING_SCHEDULED", "carlos", 9, "2026-10-20T14:00:00Z"),
    fact("c-ligacoes", "CALL_ATTEMPTED", "carlos", 100),
    fact("c-execucoes", "TASK_COMPLETED", "carlos", 999),
  ], sellers, resolveRealtimeDashboardPeriods(now, "America/Sao_Paulo"), {
    profiles: sellers.map((seller, index) => ({ memberId: seller.id, callsTarget: 50 + index, messagesTarget: 40 + index, effectiveContactsTarget: 75, meetingsScheduledTarget: 4, meetingsCompletedTarget: seller.id === "carlos" ? 0 : 2, salesValueTargetCents: 0n })),
    quotas: [],
  });
  return { ...result, workspaceName: "Politizai", timeZone: "America/Sao_Paulo", generatedAt: now.toISOString(), freshnessAt: now.toISOString(), quality: { state: "LIVE", reason: "Fixture de ranking" }, week: { ...result.week, salesGoal: weeklySalesGoal(0, null, null) } };
}

test("ranking destaca agendamentos de hoje, respeita metas individuais e não mostra execuções", async ({ page }, testInfo) => {
  const snapshot = rankingSnapshot();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: new Date(snapshot.generatedAt) });
  await page.route("**/api/public/tempo-real", route => route.fulfill({ json: { result: snapshot } }));
  await page.goto(`/tempo-real-publico#${"v".repeat(43)}`);
  await page.getByRole("button", { name: "Pausar apresentação", exact: true }).click();
  await page.getByRole("button", { name: "Mostrar slide 2", exact: true }).click();
  const ranking = page.getByRole("region", { name: "Slide 2 de 2" });
  const leaders = ranking.locator('[class*="leaderCard"]');
  const table = ranking.getByRole("table", { name: "Ranking semanal da equipe" });
  await expect(leaders.locator("h3")).toHaveText(["Ede Rafael", "Jhon Cunha", "Carlos Henrique"]);
  await expect(leaders.locator('[class*="leaderResult"] > strong')).toHaveText(["3", "2", "1"]);
  await expect(leaders.getByText("reuniões agendadas hoje", { exact: true })).toHaveCount(3);
  await expect(ranking).not.toContainText(/ações hoje|execuções|tarefas concluídas/i);
  await expect(table.getByRole("columnheader")).toHaveCount(8);
  const rows = table.getByRole("row");
  await expect(rows).toHaveCount(4);
  for (let index = 0; index < 3; index += 1) {
    const row = rows.nth(index + 1);
    const cells = row.getByRole("cell");
    const seller = snapshot.week.ranking[index]!;
    await expect(cells).toHaveCount(8);
    await expect(cells.nth(1)).toContainText(seller.name);
    await expect(cells.nth(2)).toContainText(/0\s*\/\s*75/);
    await expect(cells.nth(2)).toContainText(/0\s*\/\s*375/);
    await expect(cells.nth(3)).toContainText(new RegExp(`/\\s*${seller.goals.today.calls.targetValue}`));
    await expect(cells.nth(4)).toContainText(new RegExp(`/\\s*${seller.goals.today.messages.targetValue}`));
    await expect(cells.nth(5)).toContainText(new RegExp(`${seller.today.meetingsScheduled}\\s*/\\s*4`));
    await expect(cells.nth(5)).toContainText(new RegExp(`${seller.meetingsScheduled}\\s*/\\s*20`));
    if (seller.name !== "Carlos Henrique") {
      await expect(cells.nth(6)).toContainText(/0\s*\/\s*2/);
      await expect(cells.nth(6)).toContainText(/0\s*\/\s*10/);
    } else await expect(cells.nth(6)).toContainText("Sem meta cadastrada");
  }
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const theme of ["escuro", "claro"]) {
      await page.getByRole("button", { name: `Tema ${theme}`, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
      if (size.width > 900) {
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
        const overflow = await leaders.locator(":scope > *").evaluateAll(elements => elements.filter(element => {
          const child = element.getBoundingClientRect();
          const parent = element.parentElement!.getBoundingClientRect();
          return child.left < parent.left - 1 || child.right > parent.right + 1 || child.bottom > parent.bottom + 1;
        }).map(element => element.textContent));
        expect(overflow).toEqual([]);
      }
      await page.screenshot({ path: testInfo.outputPath(`ranking-${theme}-${size.width}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});
