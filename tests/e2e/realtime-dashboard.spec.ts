import { expect, test, type Page } from "@playwright/test";

import { enterDemoCompany } from "./helpers/company-hub";
import { browserRequest } from "./support/browser-request";
import type { RealtimeDashboardSnapshot, RealtimeDashboardTotals } from "@/modules/realtime-dashboard/domain/realtime-dashboard-contracts";
import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

async function loginAsManager(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[1]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
}

async function expectPanelLayout(page: Page, desktop: boolean) {
  const panels = await page.locator('[class*="summaryCard"], [class*="countdownCard"], [class*="leaderCard"], [class*="rankingPanel"], [class*="lightMetrics"] > article, [class*="flowPanel"], [class*="donutCard"], [class*="chartCard"], [class*="asideMetrics"] > article, [class*="activityList"], [class*="miniPodium"], [class*="weekGoal"], footer').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { label: element.textContent?.slice(0, 35), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index]!;
    expect(panel.left, panel.label).toBeGreaterThanOrEqual(-1);
    expect(panel.right, panel.label).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    if (desktop) expect(panel.bottom, panel.label).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    for (const other of panels.slice(index + 1)) {
      const overlapX = Math.min(panel.right, other.right) - Math.max(panel.left, other.left);
      const overlapY = Math.min(panel.bottom, other.bottom) - Math.max(panel.top, other.top);
      expect(overlapX > 1 && overlapY > 1, `${panel.label} sobrepõe ${other.label}`).toBe(false);
    }
  }
  const clipped = await page.locator('[class*="rankingRow"] > *, [class*="podiumColumn"] > *').evaluateAll((elements) => elements.filter((element) => {
    const container = element.closest('[class*="rankingTable"], [class*="miniPodium"]');
    if (!container) return false;
    const rect = element.getBoundingClientRect();
    const outer = container.getBoundingClientRect();
    const header = container.querySelector("h3")?.getBoundingClientRect().height ?? 0;
    return rect.top < outer.top + header - 1 || rect.bottom > outer.bottom + 1;
  }).map((element) => element.textContent));
  expect(clipped, "Conteúdo cortado ou sobreposto ao título do painel").toEqual([]);
}

test("gestor opera placar privado e bearer público revogável", async ({ context, page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await loginAsManager(page);
  await page.goto("/tempo-real");
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Slide 1 de 2" })).toBeVisible();
  await page.waitForTimeout(500);
  await expectPanelLayout(page, true);
  await page.screenshot({ path: testInfo.outputPath("tempo-real-ranking-1920x1080.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole("button", { name: "Sair da tela cheia" }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);

  await page.clock.install();
  await page.getByRole("button", { name: "Pausar apresentação" }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("region", { name: "Slide 1 de 2" })).toBeVisible();
  await page.getByRole("button", { name: "Retomar apresentação" }).click();
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("region", { name: "Slide 2 de 2" })).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("region", { name: "Slide 1 de 2" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();

  await page.getByRole("button", { name: "Mostrar slide 2" }).click();
  await expect(page.getByRole("heading", { name: /Olá,/ })).toBeVisible();
  await expect(page.getByRole("img", { name: "Ligações e mensagens por dia útil da semana" })).toBeVisible();
  await page.waitForTimeout(500);
  await expectPanelLayout(page, true);
  await page.screenshot({ path: testInfo.outputPath("tempo-real-desempenho-1920x1080.png"), fullPage: true, animations: "disabled" });

  for (const slide of [1, 0]) {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByRole("button", { name: `Mostrar slide ${slide + 1}` }).click();
    await expect(page.getByRole("region", { name: `Slide ${slide + 1} de 2` })).toBeVisible();
    await page.mouse.move(0, 0);
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual({ width: 1366, height: 768 });
    await expectPanelLayout(page, true);
    await page.screenshot({ path: testInfo.outputPath(`tempo-real-${slide === 0 ? "ranking" : "desempenho"}-1366x768.png`), fullPage: true, animations: "disabled" });
  }

  await page.getByRole("button", { name: "Compartilhar painel" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(page.locator('main[aria-label="TEMPO REAL"]')).toHaveAttribute("data-appearance", "dark");
  await page.getByRole("button", { name: "Gerar link público" }).click();
  await expect(page.getByLabel("Link público")).toBeVisible();
  const generatedUrl = await page.getByLabel("Link público").inputValue();
  await page.getByRole("button", { name: "Fechar compartilhamento" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Próxima tela em 60s", { exact: true })).toBeVisible();

  const request = browserRequest(page);
  const fragment = new URL(generatedUrl).hash;
  expect(fragment).toMatch(/^#[A-Za-z0-9_-]{43}$/);

  const publicPage = await context.newPage();
  await publicPage.setViewportSize({ width: 1366, height: 768 });
  await publicPage.goto(`/tempo-real-publico${fragment}`);
  await expect(publicPage.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
  await expect(publicPage.locator(".app-shell")).toHaveCount(0);
  expect(await publicPage.evaluate(() => window.location.hash.length)).toBe(44);
  await publicPage.waitForTimeout(500);
  await publicPage.screenshot({ path: testInfo.outputPath("tempo-real-publico-1366x768.png"), fullPage: true, animations: "disabled" });

  await page.setViewportSize({ width: 390, height: 844 });
  for (const slide of [0, 1]) {
    await page.getByRole("button", { name: `Mostrar slide ${slide + 1}` }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await expectPanelLayout(page, false);
    await page.screenshot({ path: testInfo.outputPath(`tempo-real-mobile-${slide}.png`), fullPage: true, animations: "disabled" });
  }

  await publicPage.clock.install();
  const revokeResponse = await request.post("/api/tempo-real", { data: { action: "REVOKE" } });
  expect(revokeResponse.ok()).toBe(true);
  await publicPage.clock.fastForward(16_000);
  await expect(publicPage.getByRole("heading", { name: "Placar indisponível" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("visual de TV suporta dados preenchidos, nomes longos e mais de 25 profissionais", async ({ page }, testInfo) => {
  const totals: RealtimeDashboardTotals = { calls: 180, messages: 240, effectiveContacts: 96, meetingsScheduled: 32, meetingsCompleted: 24, sales: 8, salesValueCents: "6400000" };
  const timeZone = "America/Sao_Paulo";
  const period = { from: "2026-10-19T03:00:00.000Z", to: "2026-10-23T18:00:00.000Z", fromDate: "2026-10-19", toDate: "2026-10-23", timeZone, interval: "HALF_OPEN" as const };
  const snapshot: RealtimeDashboardSnapshot = {
    workspaceName: "Grupo Edge", timeZone, generatedAt: period.to, freshnessAt: period.to, quality: { state: "LIVE", reason: "Fixture visual isolada" },
    today: { period: { ...period, from: "2026-10-23T03:00:00.000Z", fromDate: "2026-10-23" }, totals },
    week: { period, endsAt: "2026-10-24T03:00:00.000Z", totals: { ...totals, calls: 1277, messages: 1850, effectiveContacts: 638, sales: 32, salesValueCents: "25800000" }, salesGoal: { target: "40", achieved: 32, progressBasisPoints: 8000, label: "Vendas da semana" },
      daily: [180, 240, 310, 287, 260].map((calls, index) => ({ date: `2026-10-${19 + index}`, future: false, totals: { ...totals, calls, messages: [220, 340, 290, 520, 480][index]! } })),
      ranking: Array.from({ length: 32 }, (_, index) => ({ position: index + 1, name: ["Marina Costa", "Rafael Almeida", "Camila Santos"][index] ?? `Profissional de sobrenome composto ${index + 1}`, initials: ["MC", "RA", "CS"][index] ?? `P${index + 1}`, actions: 443 - index * 8, calls: 180 - index * 4, messages: 240 - index * 5, effectiveContacts: 118 - index * 3, meetingsScheduled: 36 - index, meetingsCompleted: Math.max(1, 24 - index), sales: Math.max(0, 8 - Math.floor(index / 4)), salesValueCents: String(4200000 - index * 120000) })),
    },
  };
  await page.clock.install({ time: new Date(period.to) });
  let offline = false;
  await page.route("**/api/public/tempo-real", (route) => offline ? route.abort("failed") : route.fulfill({ json: { result: snapshot } }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/tempo-real");
  await expect(page).toHaveURL(/\/login\?next=%2Ftempo-real/);
  await page.goto(`/tempo-real-publico#${"v".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const slide of [0, 1]) {
      await page.getByRole("button", { name: `Mostrar slide ${slide + 1}` }).click();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath(`fixture-${slide === 0 ? "ranking" : "desempenho"}-${size.width}x${size.height}.png`), fullPage: true, animations: "disabled" });
      await expectPanelLayout(page, size.width > 900);
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "Mostrar slide 1" }).click();
  await page.clock.fastForward(12_000);
  await expect(page.getByRole("table")).toContainText("Profissional de sobrenome composto 5");
  await page.getByRole("button", { name: "Pausar apresentação" }).click();
  await page.clock.fastForward(70_000);
  await expect(page.getByRole("table")).toContainText("Profissional de sobrenome composto 5");
  await page.getByRole("button", { name: "Retomar apresentação" }).click();
  for (let index = 0; index < 4; index += 1) await page.clock.fastForward(12_000);
  await expect(page.getByRole("table")).toContainText("Profissional de sobrenome composto 21");
  await page.clock.fastForward(12_000);
  await expect(page.getByRole("region", { name: "Slide 2 de 2" })).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("table")).toContainText("Profissional de sobrenome composto 25");
  await page.clock.fastForward(12_000);
  await expect(page.getByRole("table")).toContainText("Profissional de sobrenome composto 29");
  offline = true;
  await page.clock.fastForward(45_000);
  await expect(page.getByText("Reconectando", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Slide [12] de 2$/ })).toBeVisible();
  offline = false;
  await page.clock.fastForward(120_000);
  await expect(page.getByText("Ao vivo", { exact: true })).toBeVisible();
});
