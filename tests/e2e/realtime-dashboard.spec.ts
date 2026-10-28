import { expect, test, type Page } from "@playwright/test";
import { enterDemoCompany } from "./helpers/company-hub";
import { browserRequest } from "./support/browser-request";
import type { RealtimeDashboardSnapshot } from "@/modules/realtime-dashboard/domain/realtime-dashboard-contracts";
import { aggregateRealtimeDashboard, resolveRealtimeDashboardPeriods } from "@/modules/realtime-dashboard/domain/realtime-dashboard-domain";
import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

const board = (page: Page) => page.locator('main[aria-label="TEMPO REAL"]');
const slide = (page: Page, index: number) => page.getByRole("region", { name: `Slide ${index} de 4` });

async function expectPanelLayout(page: Page, desktop: boolean) {
  const logo = page.getByRole("img", { name: "Logo Politizai", exact: true });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", /^\/_next\/static\/media\/politizai-logo-vector\.[\w-]+\.svg$/);
  await expect.poll(() => logo.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await board(page).evaluate((element) => getComputedStyle(element).getPropertyValue("--brand-blue").trim())).toBe("#1f35fd");
  const theme = await board(page).getAttribute("data-appearance");
  expect(await board(page).evaluate((element) => getComputedStyle(element).getPropertyValue("--accent").trim())).toBe(theme === "light" ? "#1f35fd" : "#8c9aff");
  const panels = await page.locator('[class*="summaryStrip"] > article, [class*="periodPanel"], [class*="funnelCard"], [class*="leaderCard"], [class*="rankingPanel"]').evaluateAll((elements) => elements.map((element) => {
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

test("gestor opera modos unificados e TV sem login em /tempo com revogação e reativação", async ({ browser, page }, testInfo) => {
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
  await expect(slide(page, 3)).toBeVisible();
  await page.getByRole("button", { name: "Tema claro" }).click();
  await page.getByRole("button", { name: "Ranking", exact: true }).click();
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
  expect(generated.pathname).toBe("/tempo");
  expect(generated.hash).toBe("");
  expect(generated.search).toBe("");
  await page.getByRole("button", { name: "Fechar compartilhamento" }).click();
  await expect(page.getByText("Próxima tela em 60s", { exact: true })).toBeVisible();
  const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1366, height: 768 } });
  const publicPage = await anonymous.newPage();
  await publicPage.clock.install();
  try {
    expect((await anonymous.request.get("/api/tempo-real")).status()).toBe(401);
    expect((await anonymous.request.post("/api/tempo-real", { headers: { Origin: new URL(page.url()).origin }, data: { action: "REVOKE" } })).status()).toBe(401);
    const publicSnapshot = await anonymous.request.get("/api/public/tempo?workspaceId=outro-workspace");
    expect(publicSnapshot.status()).toBe(200);
    expect(publicSnapshot.headers()["cache-control"]).toContain("no-store");
    expect(publicSnapshot.headers()["x-robots-tag"]).toContain("noindex");
    expect(Object.keys(await publicSnapshot.json())).toEqual(["result"]);
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
    expect(new URL(publicPage.url()).pathname).toBe("/tempo");
    expect(new URL(publicPage.url()).search).toBe("");
    expect(new URL(publicPage.url()).hash).toBe("");
    const revoke = await browserRequest(page).post("/api/tempo-real", { data: { action: "REVOKE" } });
    expect(revoke.ok()).toBe(true);
    await publicPage.clock.fastForward(16_000);
    await expect(publicPage.getByRole("heading", { name: "Placar indisponível" })).toBeVisible();
    expect((await anonymous.request.get("/api/public/tempo")).status()).toBe(404);
    const activate = await browserRequest(page).post("/api/tempo-real", { data: { action: "ROTATE" } });
    expect(activate.status()).toBe(200);
    expect((await activate.json() as { result: { shareUrl: string } }).result.shareUrl).toBe(`${generated.origin}/tempo`);
    await publicPage.reload();
    await expect(board(publicPage)).toBeVisible();
    await expect(board(publicPage)).toHaveAttribute("data-appearance", "light");
  } finally { await anonymous.close(); }
  await page.goto("/anuncios?view=metrics&metricsPreset=TODAY");
  await expect(page.getByRole("region", { name: "Resumo ao vivo de Anúncios" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Metas diárias de Anúncios" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Metas semanais de Anúncios" })).toBeVisible();
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

test("anúncios recalcula metas de 50% e 60% ao receber entradas e agendamentos novos", async ({ page }) => {
  const base = visualSnapshot();
  const now = new Date("2026-10-28T18:00:00Z");
  let leads = 30, assigned = 10;
  const sellers = [{ id: "c", name: "Carlos Henrique", advertisingRole: "BOOKER" as const }, { id: "j", name: "Jhon Cunha", advertisingRole: "CLOSER" as const }, { id: "e", name: "Ede Rafael", advertisingRole: "CLOSER" as const }];
  const fact = (id: string, eventType: string, memberId = "c", quantity = 1) => ({ id, eventType, leadId: id, creditedMemberId: memberId, quantity, occurredAt: "2026-10-28T14:00:00Z", sourceEntityType: "Activity", performedByMemberId: null, bookedByMemberId: null, taskKind: null, result: null, cadenceStepKey: null, valueCents: null });
  const snapshot = (): RealtimeDashboardSnapshot => {
    const result = aggregateRealtimeDashboard([...Array.from({ length: leads }, (_, index) => fact(`lead-${index}`, "LEAD_CREATED")), { ...fact("book", "MEETING_SCHEDULED", "c", assigned), meetingOwnerMemberIdAtEvent: "j" }, fact("held", "MEETING_COMPLETED", "j", 6)], sellers, resolveRealtimeDashboardPeriods(now, "America/Sao_Paulo"), { front: "ADVERTISING", profiles: [], quotas: [] });
    return { ...base, ...result, week: { ...result.week, salesGoal: base.week.salesGoal } };
  };
  await page.clock.install({ time: now });
  await page.route("**/api/public/tempo?*", route => route.fulfill({ json: { result: new URL(route.request().url()).searchParams.get("front") === "ADVERTISING" ? snapshot() : base } }));
  await page.goto("/tempo");
  await page.getByRole("button", { name: "Pausar apresentação", exact: true }).click();
  await page.getByRole("button", { name: "Anúncios", exact: true }).click();
  const today = page.getByRole("region", { name: "Métricas de hoje", exact: true });
  await expect(page.getByRole("article", { name: "Leads hoje", exact: true }).locator(":scope > strong")).toHaveText("30");
  await expect(today.locator('[data-metric="meetingsScheduled"]')).toContainText("/ 15");
  await expect(today.locator('[data-metric="meetingsCompleted"]')).toContainText("/ 6");
  leads = 34; assigned = 12;
  await page.clock.runFor(5_100);
  await expect(page.getByRole("article", { name: "Leads hoje", exact: true }).locator(":scope > strong")).toHaveText("34");
  await expect(today.locator('[data-metric="meetingsScheduled"]')).toContainText("/ 17");
  await expect(today.locator('[data-metric="meetingsCompleted"]')).toContainText("/ 8");
  await page.getByRole("button", { name: "Ranking", exact: true }).click();
  const jhon = page.getByRole("table").getByRole("row").filter({ hasText: "Jhon Cunha" });
  await expect(jhon).toContainText("Meta 60%");
  await expect(jhon).toContainText("/ 8");
  const closer = page.locator('[class*="leaderCard"]').filter({ has: page.getByRole("heading", { name: "Jhon Cunha" }) });
  await expect(closer).toContainText("reuniões feitas hoje");
  for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 720 }]) {
    await page.setViewportSize(size);
    for (const view of ["Geral", "Ranking"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await expectPanelLayout(page, true);
    }
  }
});

test("TV alterna as quatro telas a cada 60 segundos e mantém dados de anúncios separados", async ({ page }, testInfo) => {
  const original = visualSnapshot();
  const snapshot = (sales: number, tasks: number): RealtimeDashboardSnapshot => ({
    ...original,
    today: { ...original.today, leadsReceived: 30, totals: { ...original.today.totals, sales, tasksCompleted: tasks } },
    week: { ...original.week, leadsReceived: 60, totals: { ...original.week.totals, sales, tasksCompleted: tasks }, ranking: original.week.ranking.slice(0, 3).map(row => ({ ...row, sales, tasksCompleted: tasks, today: { ...row.today, sales, tasksCompleted: tasks } })) },
  });
  await page.clock.install({ time: new Date(original.generatedAt) });
  await page.clock.pauseAt(new Date(Date.parse(original.generatedAt) + 1_000));
  const requests = new Set<string>();
  await page.route("**/api/public/tempo?*", route => {
    const front = new URL(route.request().url()).searchParams.get("front")!;
    requests.add(front);
    return route.fulfill({ json: { result: front === "ADVERTISING" ? snapshot(2, 4) : snapshot(7, 12) } });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/tempo");
  await expect(slide(page, 1)).toBeVisible();
  expect([...requests].sort()).toEqual(["ADVERTISING", "PROSPECTING"]);
  const sales = () => page.getByRole("region", { name: "Métricas de hoje" }).locator('[data-metric="sales"] > strong');
  await expect(sales()).toHaveText("7");
  for (const index of [2, 3, 4, 1]) {
    await page.clock.fastForward(59_999);
    await expect(slide(page, index === 1 ? 4 : index - 1)).toBeVisible();
    await page.clock.fastForward(1);
    await expect(slide(page, index)).toBeVisible();
    await expect(board(page)).toHaveAttribute("data-front", index < 3 ? "PROSPECTING" : "ADVERTISING");
    if (index === 3) {
      await expect(sales()).toHaveText("2");
      await expect(page.getByRole("article", { name: "Leads hoje", exact: true }).locator(":scope > strong")).toHaveText("30");
      await expect(page.getByRole("article", { name: "Reuniões agendadas", exact: true })).toBeVisible();
      await expect(page.getByRole("article", { name: "Reuniões feitas", exact: true })).toBeVisible();
      await expect(page.locator('[data-funnel-stage="leads"]')).toContainText("Leads Anúncios");
      await expect(page.locator('[data-funnel-stage="leads"]')).toContainText("60");
    }
    if (index === 4) await expect(page.getByRole("table")).toContainText("4 tarefas hoje · 4 na semana");
  }
  await expect(sales()).toHaveText("7");
  await page.getByRole("button", { name: "Pausar apresentação", exact: true }).click();
  await page.getByRole("button", { name: "Anúncios", exact: true }).click();
  await expect(slide(page, 3)).toBeVisible();
  const targetIcon = page.getByRole("button", { name: "Anúncios", exact: true }).locator("svg circle");
  await expect(targetIcon).toHaveCount(3);
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: theme === "dark" ? "Tema escuro" : "Tema claro" }).click();
      for (const view of ["Geral", "Ranking"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        await expectPanelLayout(page, size.width > 900);
        await page.screenshot({ path: testInfo.outputPath(`anuncios-${view}-${theme}-${size.width}.png`), fullPage: true, animations: "disabled" });
      }
    }
  }
  await page.getByRole("button", { name: "Prospecção Ativa", exact: true }).click();
  await expect(sales()).toHaveText("7");
  await expect(page.getByRole("article", { name: "Leads hoje", exact: true })).toHaveCount(0);
});

test("resumo preserva os totais consolidados mesmo com profissionais fora do ranking", async ({ page }) => {
  const original = visualSnapshot();
  const snapshot: RealtimeDashboardSnapshot = {
    ...original,
    today: { ...original.today, totals: { ...original.today.totals, effectiveContacts: 999, calls: 999, tasksCompleted: 999 } },
    week: { ...original.week, totals: { ...original.week.totals, effectiveContacts: 888, calls: 888 }, ranking: original.week.ranking.slice(0, 3).map((row, index) => ({
      ...row, name: ["Carlos Henrique", "Jhon Cunha", "Ede Rafael"][index]!,
      effectiveContacts: [200, 65, 80][index]!, calls: [100, 50, 80][index]!,
      today: { ...row.today, effectiveContacts: [75, 12, 30][index]!, calls: [40, 7, 13][index]!, tasksCompleted: 500 },
    })) },
  };
  await page.route("**/api/public/tempo-real?*", (route) => route.fulfill({ json: { result: snapshot } }));
  await page.goto(`/tempo-real-publico#${"v".repeat(43)}`);
  const today = page.getByRole("article", { name: "Contatos de hoje", exact: true });
  const week = page.getByRole("article", { name: "Contatos da semana", exact: true });
  const calls = page.getByRole("article", { name: "Ligações feitas hoje", exact: true });
  await expect(today.locator(":scope > strong")).toHaveText("999");
  await expect(week.locator(":scope > strong")).toHaveText("888");
  await expect(calls.locator(":scope > strong")).toHaveText("999");
  await expect(calls).toContainText("888 na semana");
  await expect(calls).not.toContainText("tarefas");
  await expect(page.getByRole("region", { name: "Métricas de hoje" }).locator('[data-metric="effectiveContacts"] > strong')).toHaveText("999");
  await expect(page.getByRole("region", { name: "Métricas da semana" }).locator('[data-metric="effectiveContacts"] > strong')).toHaveText("888");
  await expect(page.getByRole("article", { name: "Funil de vendas da semana" })).toContainText("Valor vendido");
});

test("visual de TV unificado suporta dois temas e paginação de 32 profissionais", async ({ page }, testInfo) => {
  const snapshot = visualSnapshot();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date(snapshot.generatedAt) });
  let offline = false;
  await page.route("**/api/public/tempo-real?*", (route) => offline ? route.abort("failed") : route.fulfill({ json: { result: snapshot } }));
  await page.goto("/tempo-real");
  await expect(page).toHaveURL(/\/login\?next=%2Ftempo-real/);
  await page.goto(`/tempo-real-publico#${"v".repeat(43)}`);
  await expect(board(page)).toHaveAttribute("data-appearance", "dark");
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const theme of ["dark", "light"]) {
      await page.getByRole("button", { name: theme === "dark" ? "Tema escuro" : "Tema claro" }).click();
      for (const index of [1, 2]) {
        await page.getByRole("group", { name: "Visualização", exact: true }).getByRole("button", { name: index === 1 ? "Geral" : "Ranking", exact: true }).click();
        await expect(slide(page, index)).toBeVisible();
        await expect(board(page)).toHaveAttribute("data-appearance", theme);
        await page.screenshot({ path: testInfo.outputPath(`fixture-${index === 1 ? "geral" : "ranking"}-${theme}-${size.width}x${size.height}.png`), fullPage: true, animations: "disabled" });
        await expectPanelLayout(page, size.width > 900);
      }
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "Geral", exact: true }).click();
  await page.getByRole("button", { name: "Ranking", exact: true }).click();
  await page.clock.fastForward(12_000);
  await expect(page.getByRole("table")).toContainText("Contatos-dia");
  await expect(page.getByRole("table")).toContainText("Meta × 5");
  await expect(page.getByRole("table")).toContainText(snapshot.week.ranking[4]!.name);
  await page.getByRole("button", { name: "Pausar apresentação" }).click();
  await page.clock.fastForward(70_000);
  await expect(page.getByRole("table")).toContainText(snapshot.week.ranking[4]!.name);
  await page.getByRole("button", { name: "Retomar apresentação" }).click();
  for (let index = 0; index < 4; index += 1) await page.clock.fastForward(12_000);
  await expect(page.getByRole("table")).toContainText(snapshot.week.ranking[20]!.name);
  await page.clock.fastForward(12_000);
  await expect(slide(page, 3)).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("table")).toContainText(snapshot.week.ranking[0]!.name);
  await page.clock.fastForward(12_000);
  await expect(page.getByRole("table")).toContainText(snapshot.week.ranking[4]!.name);
  offline = true;
  await page.clock.fastForward(45_000);
  await expect(page.getByText("Reconectando", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Slide [1-4] de 4$/ })).toBeVisible();
  offline = false;
  await page.clock.fastForward(120_000);
  await expect(page.getByText("Ao vivo", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
