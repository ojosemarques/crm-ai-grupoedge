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

test("resumo usa o consolidado da API sem perder atividade fora do ranking nem duplicar contatos", async ({ page }) => {
  const original = rankingSnapshot();
  const snapshot = {
    ...original,
    today: { ...original.today, totals: { ...original.today.totals, effectiveContacts: 1, calls: 103 } },
    week: { ...original.week, totals: { ...original.week.totals, effectiveContacts: 2, calls: 105 } },
  };
  await page.route("**/api/public/tempo-real", route => route.fulfill({ json: { result: snapshot } }));
  await page.goto(`/tempo-real-publico#${"v".repeat(43)}`);
  await page.getByRole("button", { name: "Pausar apresentação", exact: true }).click();
  await expect(page.getByRole("article", { name: "Contatos de hoje", exact: true }).locator(":scope > strong")).toHaveText("1");
  await expect(page.getByRole("article", { name: "Contatos da semana", exact: true }).locator(":scope > strong")).toHaveText("2");
  const calls = page.getByRole("article", { name: "Ligações feitas hoje", exact: true });
  await expect(calls.locator(":scope > strong")).toHaveText("103");
  await expect(calls).toContainText("105 na semana");
  const today = page.getByRole("region", { name: "Métricas de hoje", exact: true });
  await expect(today.locator('[data-metric="effectiveContacts"] > strong')).toHaveText("1");
  await expect(today.locator('[data-metric="calls"] > strong')).toHaveText("103");
});

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

test("TV em tela cheia mantém números e metas separados em telas HD, Full HD e 4K", async ({ page }, testInfo) => {
  const original = rankingSnapshot();
  const snapshot = { ...original, week: { ...original.week, ranking: [...original.week.ranking,
    { ...original.week.ranking[0]!, position: 4, name: "Profissional de sobrenome composto" },
  ] } };
  await page.clock.install({ time: new Date(snapshot.generatedAt) });
  await page.route("**/api/public/tempo", route => route.fulfill({ json: { result: snapshot } }));
  await page.goto("/tempo");
  await page.getByRole("button", { name: "Pausar apresentação", exact: true }).click();
  for (const size of [
    { width: 1366, height: 768 }, { width: 1280, height: 720 },
    { width: 1920, height: 720 }, { width: 1920, height: 1080 },
    { width: 1536, height: 864 }, { width: 3840, height: 2160 },
  ]) {
    await page.setViewportSize(size);
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    for (const theme of ["escuro", "claro"]) {
      await page.getByRole("button", { name: `Tema ${theme}`, exact: true }).click();
      for (const index of [1, 2]) {
        await page.getByRole("button", { name: `Mostrar slide ${index}`, exact: true }).click();
        await page.evaluate(() => document.fonts.ready);
        const problems = await page.locator('main[aria-label="TEMPO REAL"]').evaluate(board => {
          const problems: string[] = [];
          const groups = board.querySelectorAll('[class*="metricTile"], [class*="sellerMetric"], [class*="leaderCard"], [class*="revenueRow"], [class*="summaryStrip"] > article, [class*="salesGoalCard"]');
          for (const group of groups) {
            const outer = group.getBoundingClientRect();
            const walker = document.createTreeWalker(group, NodeFilter.SHOW_TEXT);
            const texts: { text: string; rect: DOMRect }[] = [];
            while (walker.nextNode()) {
              const node = walker.currentNode;
              const parent = node.parentElement!;
              if (!node.textContent?.trim() || parent.closest("svg")) continue;
              // Names and explanatory labels intentionally ellipsize; numerical values must not.
              const style = getComputedStyle(parent);
              if (style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none") continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const rect of range.getClientRects()) {
                if (!rect.width || !rect.height) continue;
                const text = node.textContent.trim();
                if (rect.left < outer.left - 2 || rect.right > outer.right + 2 || rect.top < outer.top - 2 || rect.bottom > outer.bottom + 2) problems.push(`Cortado: ${text}`);
                texts.push({ text, rect });
              }
            }
            for (let i = 0; i < texts.length; i++) for (const other of texts.slice(i + 1)) {
              const current = texts[i]!;
              if (Math.min(current.rect.right, other.rect.right) - Math.max(current.rect.left, other.rect.left) > 2
                && Math.min(current.rect.bottom, other.rect.bottom) - Math.max(current.rect.top, other.rect.top) > 2) problems.push(`Sobreposição: ${current.text} / ${other.text}`);
            }
          }
          return problems;
        });
        await page.screenshot({ path: testInfo.outputPath(`tv-${size.width}x${size.height}-${theme}-slide-${index}.png`), animations: "disabled" });
        expect.soft(problems, `${size.width}×${size.height}, ${theme}, slide ${index}`).toEqual([]);
        expect.soft(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual(size);
      }
    }
    await page.getByRole("button", { name: "Sair da tela cheia", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  }
});
