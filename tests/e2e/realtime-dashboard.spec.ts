import { expect, test, type Page } from "@playwright/test";
import { enterDemoCompany } from "./helpers/company-hub";
import { browserRequest } from "./support/browser-request";
import type { RealtimeDashboardSnapshot } from "@/modules/realtime-dashboard/domain/realtime-dashboard-contracts";
import { aggregateRealtimeDashboard, resolveRealtimeDashboardPeriods } from "@/modules/realtime-dashboard/domain/realtime-dashboard-domain";
import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

const board = (page: Page) => page.locator('main[aria-label="TEMPO REAL"]');
const slide = (page: Page, index: number) => page.getByRole("region", { name: `Slide ${index} de 2` });

async function expectPanelLayout(page: Page, desktop: boolean) {
  const panels = await page.locator('[class*="summaryStrip"] > article, [class*="periodPanel"], [class*="salesGoalCard"], [class*="chartCard"], [class*="leaderCard"], [class*="rankingPanel"]').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { label: element.textContent?.slice(0, 40), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
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
  const clipped = await page.locator('[class*="metricTile"] > *, [class*="rankingRow"] > *, [class*="leaderCard"] > *').evaluateAll((elements) => elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    const outer = element.parentElement!.getBoundingClientRect();
    return rect.top < outer.top - 1 || rect.bottom > outer.bottom + 1;
  }).map((element) => element.textContent));
  expect(clipped, "Conteúdo verticalmente cortado").toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
  if (desktop) {
    expect((await board(page).boundingBox())!.height).toBe(page.viewportSize()!.height);
    // Next dev's overlay adds a positioned script after the board; production must have no document overflow.
    if (await page.locator("script[data-nextjs-dev-overlay]").count() === 0) {
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(page.viewportSize()!.height);
    }
  }
}

test("gestor opera modos unificados, tema independente e bearer público revogável", async ({ browser, page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[1]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
  await page.clock.install();
  await page.goto("/tempo-real");
  await expect(page.getByRole("heading", { name: "TEMPO REAL", exact: true })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(slide(page, 1)).toBeVisible();
  await expect(board(page)).toHaveAttribute("data-appearance", "dark");
  await expect(page.getByRole("region", { name: "Métricas de hoje" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Métricas da semana" })).toBeVisible();
  await expectPanelLayout(page, true);
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole("button", { name: "Sair da tela cheia" }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.getByRole("button", { name: "Pausar apresentação" }).click();
  await page.clock.fastForward(61_000);
  await expect(slide(page, 1)).toBeVisible();
  await page.getByRole("button", { name: "Retomar apresentação" }).click();
  await page.clock.fastForward(60_000);
  await expect(slide(page, 2)).toBeVisible();
  await expect(board(page)).toHaveAttribute("data-appearance", "dark");
  await page.clock.fastForward(60_000);
  await expect(slide(page, 1)).toBeVisible();
  await page.getByRole("button", { name: "Tema claro" }).click();
  await page.getByRole("button", { name: "Mostrar slide 2" }).click();
  await expect(board(page)).toHaveAttribute("data-appearance", "light");
  await page.reload();
  await expect(board(page)).toHaveAttribute("data-appearance", "light");
  await page.goto("/tempo-real");
  await expect(board(page)).toHaveAttribute("data-appearance", "light");
  await page.getByRole("button", { name: "Tema escuro" }).click();
  await page.getByRole("button", { name: "Compartilhar painel" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(slide(page, 1)).toBeVisible();
  await page.getByRole("button", { name: "Gerar link público" }).click();
  const field = page.getByLabel("Link público");
  await expect(field).toBeVisible();
  const generated = new URL(await field.inputValue());
  expect(generated.hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);
  expect(generated.searchParams.get("theme")).toBe("dark");
  await page.getByRole("button", { name: "Fechar compartilhamento" }).click();
  await expect(page.getByText("Próxima tela em 60s", { exact: true })).toBeVisible();
  const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1366, height: 768 } });
  const publicPage = await anonymous.newPage();
  await publicPage.clock.install();
  try {
    await publicPage.goto(`${generated.pathname}${generated.search}${generated.hash}`);
    await expect(board(publicPage)).toHaveAttribute("data-appearance", "dark");
    await expect(publicPage.getByRole("button", { name: "Compartilhar painel" })).toHaveCount(0);
    await expect(publicPage.locator(".app-shell")).toHaveCount(0);
    await expectPanelLayout(publicPage, true);
    await publicPage.screenshot({ path: testInfo.outputPath("publico-dark.png"), animations: "disabled" });
    await publicPage.clock.fastForward(60_000);
    await expect(slide(publicPage, 2)).toBeVisible();
    await expect(board(publicPage)).toHaveAttribute("data-appearance", "dark");
    await publicPage.getByRole("button", { name: "Tema claro" }).click();
    expect(await publicPage.evaluate(() => window.location.hash)).toBe(generated.hash);
    const revoke = await browserRequest(page).post("/api/tempo-real", { data: { action: "REVOKE" } });
    expect(revoke.ok()).toBe(true);
    await publicPage.clock.fastForward(16_000);
    await expect(publicPage.getByRole("heading", { name: "Placar indisponível" })).toBeVisible();
  } finally { await anonymous.close(); }
  expect(errors).toEqual([]);
});

function visualSnapshot(): RealtimeDashboardSnapshot {
  const timeZone = "America/Sao_Paulo";
  const now = new Date("2026-10-23T18:00:00.000Z");
  const sellers = Array.from({ length: 32 }, (_, index) => ({ id: `seller-${index}`, name: ["Marina Costa", "Rafael Almeida", "Camila Santos"][index] ?? `Profissional de sobrenome composto ${index + 1}`, functions: ["CLOSER"] }));
  const facts: IntegratedActivityFact[] = sellers.flatMap((seller, index) => Array.from({ length: 5 }, (_, day) => (["CALL_ATTEMPTED", "WHATSAPP_MESSAGE_SENT", "CALL_CONNECTED", "MEETING_SCHEDULED", "MEETING_COMPLETED", "SALE_WON", "TASK_COMPLETED"] as const).map((eventType, eventIndex) => ({
    id: `${seller.id}-${day}-${eventType}`, sourceEntityType: "Task", leadId: `${seller.id}-${day}`, creditedMemberId: seller.id, performedByMemberId: null, bookedByMemberId: null, taskKind: null, result: null, cadenceStepKey: null, eventType,
    quantity: eventIndex < 2 ? 40 - index : 1, valueCents: eventType === "SALE_WON" ? "500000" : null, occurredAt: `2026-10-${19 + day}T14:00:00.000Z`,
  }))).flat());
  const result = aggregateRealtimeDashboard(facts, sellers, resolveRealtimeDashboardPeriods(now, timeZone), {
    profiles: sellers.map((seller) => ({ memberId: seller.id, callsTarget: 50, messagesTarget: 60, effectiveContactsTarget: 10, meetingsScheduledTarget: 3, salesValueTargetCents: 1000000n })),
    quotas: [{ targetType: "FUNCTION", function: "CLOSER", memberId: null, teamId: null, metricKey: "OPPORTUNITIES_WON", targetValue: 200n }], planName: "Vendas da semana",
  });
  return { workspaceName: "Grupo Edge", timeZone, generatedAt: now.toISOString(), freshnessAt: now.toISOString(), quality: { state: "LIVE", reason: "Fixture visual isolada" }, ...result, week: { ...result.week, salesGoal: { target: "200", achieved: 160, progressBasisPoints: 8000, label: "Vendas da semana" } } };
}

test("visual de TV unificado suporta dois temas e paginação de 32 profissionais", async ({ page }, testInfo) => {
  const snapshot = visualSnapshot();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date(snapshot.generatedAt) });
  let offline = false;
  await page.route("**/api/public/tempo-real", (route) => offline ? route.abort("failed") : route.fulfill({ json: { result: snapshot } }));
  await page.goto("/tempo-real");
  await expect(page).toHaveURL(/\/login\?next=%2Ftempo-real/);
  await page.goto(`/tempo-real-publico#${"v".repeat(43)}`);
  await expect(board(page)).toHaveAttribute("data-appearance", "dark");
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: theme === "dark" ? "Tema escuro" : "Tema claro" }).click();
      for (const index of [1, 2]) {
        await page.getByRole("button", { name: `Mostrar slide ${index}` }).click();
        await expect(slide(page, index)).toBeVisible();
        await expect(board(page)).toHaveAttribute("data-appearance", theme);
        await page.screenshot({ path: testInfo.outputPath(`fixture-${index === 1 ? "geral" : "ranking"}-${theme}-${size.width}x${size.height}.png`), fullPage: true, animations: "disabled" });
        await expectPanelLayout(page, size.width > 900);
      }
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "Mostrar slide 1" }).click();
  await page.getByRole("button", { name: "Mostrar slide 2" }).click();
  await page.clock.fastForward(12_000);
  await expect(page.getByRole("table")).toContainText("Profissional de sobrenome composto 5");
  await page.getByRole("button", { name: "Pausar apresentação" }).click();
  await page.clock.fastForward(70_000);
  await expect(page.getByRole("table")).toContainText("Profissional de sobrenome composto 5");
  await page.getByRole("button", { name: "Retomar apresentação" }).click();
  for (let index = 0; index < 4; index += 1) await page.clock.fastForward(12_000);
  await expect(page.getByRole("table")).toContainText("Profissional de sobrenome composto 21");
  await page.clock.fastForward(12_000);
  await expect(slide(page, 1)).toBeVisible();
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
  expect(errors).toEqual([]);
});
