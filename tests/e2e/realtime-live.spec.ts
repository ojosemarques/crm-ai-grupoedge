import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { hashPassword } from "@/modules/auth/domain/password";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { enterDemoCompany } from "./helpers/company-hub";
import { aggregateRealtimeDashboard, resolveRealtimeDashboardPeriods, weeklySalesGoal } from "@/modules/realtime-dashboard/domain/realtime-dashboard-domain";

for (const scenario of ["intervalo", "retomada", "outro-endereco"] as const) {
test(`refresh completo da TV a cada 30 minutos: ${scenario}`, async ({ page }) => {
  const now = new Date("2026-10-22T18:00:00Z");
  const result = aggregateRealtimeDashboard([], [], resolveRealtimeDashboardPeriods(now, "America/Sao_Paulo"));
  const snapshot = { ...result, workspaceName: "Empresa", timeZone: "America/Sao_Paulo", generatedAt: now.toISOString(), freshnessAt: null,
    quality: { state: "LIVE", reason: "Fixture" }, week: { ...result.week, salesGoal: weeklySalesGoal(0, null, null) } };
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1_000));
  await page.addInitScript(() => {
    (window as Window & { refreshTestDocument?: string }).refreshTestDocument = crypto.randomUUID();
  });
  await page.route("**/api/public/tempo?*", route => route.fulfill({ json: { result: snapshot } }));
  await page.route("**/api/public/tempo-real?*", route => route.fulfill({ json: { result: snapshot } }));
  const documentId = () => page.evaluate(() => (window as Window & { refreshTestDocument?: string }).refreshTestDocument);
  await page.goto(scenario === "outro-endereco" ? `/tempo-real-publico#${"v".repeat(43)}` : "/tempo");
  await expect(page.getByRole("button", { name: "Pausar apresentação", exact: true })).toBeVisible();
  const initial = await documentId();
  if (scenario === "outro-endereco") {
    await page.clock.fastForward(30 * 60_000);
    expect(await documentId()).toBe(initial);
    return;
  }
  const navigation = page.waitForEvent("framenavigated", frame => frame === page.mainFrame());
  if (scenario === "retomada") {
    // Simula suspensão: o relógio avança sem disparar os timers.
    await page.clock.setSystemTime(new Date(now.getTime() + 31 * 60_000));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  } else {
    await page.clock.fastForward(30 * 60_000 - 1);
    expect(await documentId()).toBe(initial);
    await page.clock.runFor(1);
  }
  await navigation;
  await expect(page.getByRole("button", { name: "Pausar apresentação", exact: true })).toBeVisible();
  const second = await documentId();
  expect(second).not.toBe(initial);
  await expect(page).toHaveURL(/\/tempo$/);
  if (scenario === "intervalo") {
    const nextNavigation = page.waitForEvent("framenavigated", frame => frame === page.mainFrame());
    await page.clock.fastForward(30 * 60_000);
    await nextNavigation;
    await expect(page.getByRole("button", { name: "Pausar apresentação", exact: true })).toBeVisible();
    expect(await documentId()).not.toBe(second);
  }
});
}

test("consulta a cada cinco segundos e retoma imediatamente no foco, visibilidade e reconexão sem sobrepor requisições", async ({ page }) => {
  const now = new Date("2026-10-22T18:00:00Z");
  await page.clock.install({ time: now });
  let quantity = 0;
  let requests = 0;
  await page.route("**/api/public/tempo-real?*", async route => {
    requests += 1;
    const result = aggregateRealtimeDashboard([{ id: "call", eventType: "CALL_ATTEMPTED", occurredAt: "2026-10-22T17:00:00Z", sourceEntityType: "Task", leadId: null, creditedMemberId: "seller", performedByMemberId: null, bookedByMemberId: null, taskKind: null, result: null, cadenceStepKey: null, quantity, valueCents: null }], [{ id: "seller", name: "Carlos" }], resolveRealtimeDashboardPeriods(now, "America/Sao_Paulo"));
    await route.fulfill({ json: { result: { ...result, workspaceName: "Empresa", timeZone: "America/Sao_Paulo", generatedAt: now.toISOString(), freshnessAt: now.toISOString(), quality: { state: "LIVE", reason: "Fixture" }, week: { ...result.week, salesGoal: weeklySalesGoal(0, null, null) } } } });
  });
  await page.goto(`/tempo-real-publico#${"v".repeat(43)}`);
  const calls = page.getByRole("article", { name: "Ligações feitas hoje", exact: true }).locator(":scope > strong");
  await expect(calls).toHaveText("0");
  quantity = 1;
  await page.clock.runFor(5_100);
  await expect(calls).toHaveText("1", { timeout: 1_000 });
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(5_100);
  const before = requests;
  quantity = 2;
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(calls).toHaveText("2", { timeout: 1_000 });
  expect(requests).toBe(before + 2);
  quantity = 3;
  await page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
  await expect(calls).toHaveText("3", { timeout: 1_000 });
  expect(requests).toBe(before + 4);
});

test("recupera a atualização quando uma requisição fica sem resposta", async ({ page }) => {
  const now = new Date("2026-10-22T18:00:00Z");
  await page.clock.install({ time: now });
  let requests = 0;
  let stalled = false;
  let quantity = 1;
  const pending: (() => Promise<void>)[] = [];
  await page.route("**/api/public/tempo-real?*", async route => {
    requests += 1;
    if (stalled) { pending.push(() => route.abort().catch(() => {})); return; }
    const result = aggregateRealtimeDashboard([{ id: "call", eventType: "CALL_ATTEMPTED", occurredAt: "2026-10-22T17:00:00Z", sourceEntityType: "Task", leadId: null, creditedMemberId: "seller", performedByMemberId: null, bookedByMemberId: null, taskKind: null, result: null, cadenceStepKey: null, quantity, valueCents: null }], [{ id: "seller", name: "Carlos" }], resolveRealtimeDashboardPeriods(now, "America/Sao_Paulo"));
    await route.fulfill({ json: { result: { ...result, workspaceName: "Empresa", timeZone: "America/Sao_Paulo", generatedAt: now.toISOString(), freshnessAt: now.toISOString(), quality: { state: "LIVE", reason: "Fixture" }, week: { ...result.week, salesGoal: weeklySalesGoal(0, null, null) } } } });
  });
  try {
    await page.goto(`/tempo-real-publico#${"v".repeat(43)}`);
    const calls = page.getByRole("article", { name: "Ligações feitas hoje", exact: true }).locator(":scope > strong");
    await expect(calls).toHaveText("1");
    stalled = true;
    await page.clock.runFor(5_100);
    await expect.poll(() => requests).toBe(4);
    await page.clock.runFor(30_100);
    await expect(page.getByText("Reconectando", { exact: true })).toBeVisible({ timeout: 1_000 });
    await expect(calls).toHaveText("1");
    stalled = false;
    quantity = 2;
    await page.clock.runFor(6_500);
    await expect(calls).toHaveText("2", { timeout: 1_000 });
    await expect(page.getByText("Conexão interrompida.", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Ao vivo", { exact: true })).toBeVisible();
  } finally { await Promise.all(pending.map(abort => abort())); }
});

test("Tempo Real acompanha outro cliente alterando tarefas, card e reunião sem recarregar a página", async ({ page, playwright, baseURL }) => {
  test.setTimeout(120_000);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  expect(databaseUrl.searchParams.get("schema")).toMatch(/^politizai_test_e2e_/);
  const database = getDatabaseClient();
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId: workspace.id, name: "Prospecção Ativa", deletedAt: null } });
  const system = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, type: "SYSTEM", key: "system" } });
  const role = await database.role.findFirstOrThrow({ where: { workspaceId: workspace.id, key: DEMO_USERS[1]!.roleKey } });
  const user = await database.user.create({ data: { email: "carloshenrique@politizai.com", normalizedEmail: "carloshenrique@politizai.com", displayName: "Carlos Henrique" } });
  await database.localCredential.create({ data: { userId: user.id, passwordHash: await hashPassword(DEMO_SEED_PASSWORD) } });
  const member = await database.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, roleId: role.id, status: "ACTIVE", createdByActorId: system.id, updatedByActorId: system.id } });
  const manager = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: DEMO_USERS[1]!.email } }, include: { teamMemberships: { where: { deletedAt: null } } } });
  await database.teamMember.createMany({ data: manager.teamMemberships.map(team => ({ workspaceId: workspace.id, teamId: team.teamId, workspaceMemberId: member.id, function: team.function, createdByActorId: system.id, updatedByActorId: system.id })) });
  await database.actor.create({ data: { workspaceId: workspace.id, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: "Carlos Henrique" } });
  const client = await playwright.request.newContext({ baseURL: baseURL!, extraHTTPHeaders: { Origin: baseURL! } });
  try {
    expect((await client.post("/api/auth/login", { data: { email: user.email, password: DEMO_SEED_PASSWORD, workspace: "politizai" } })).status()).toBe(200);
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(DEMO_USERS[1]!.email);
    await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await enterDemoCompany(page);
    await page.clock.install();
    await page.goto("/tempo-real");
    await expect(page.getByRole("heading", { name: "TEMPO REAL", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pausar apresentação", exact: true }).click();
    const documentId = randomUUID();
    await page.evaluate(value => { (window as Window & { realtimeTestDocument?: string }).realtimeTestDocument = value; }, documentId);
    const calls = page.getByRole("article", { name: "Ligações feitas hoje", exact: true }).locator(":scope > strong");
    const contacts = page.getByRole("article", { name: "Contatos de hoje", exact: true }).locator(":scope > strong");
    await expect(calls).toHaveText("0");
    const createLead = async () => {
      const name = `Sincronia ${randomUUID()}`;
      const response = await client.post("/api/leads/manual", { data: { pipelineId: pipeline.id, idempotencyKey: `live:${randomUUID()}`, lead: { fullName: name, phone: `+55119${String(Date.now()).slice(-8)}`, priorityBandCode: "P2" } } });
      expect(response.status(), await response.text()).toBe(201);
      return database.lead.findFirstOrThrow({ where: { workspaceId: workspace.id, fullName: name } });
    };
    const lead = await createLead();
    const operations = async (action: string, data: Record<string, unknown>) => {
      const response = await client.post(`/api/leads/${lead.id}/operations`, { data: { action, data } });
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()).result;
    };
    const dueAt = new Date(Date.now() + 3_600_000).toISOString();
    const task = await operations("CREATE_TASK", { title: "Ligação sincronizada", kind: "CALL", priority: "MEDIUM", dueAt });
    await operations("COMPLETE_TASK", { taskId: task.id, result: "CONNECTED" });
    await page.clock.runFor(5_100);
    await expect(calls).toHaveText("1");
    await expect(contacts).toHaveText("1");
    const stored = await database.task.findUniqueOrThrow({ where: { id: task.id } });
    await operations("UPDATE_COMPLETED_TASK", { taskId: task.id, expectedUpdatedAt: stored.updatedAt.toISOString(), title: stored.title, description: null, priority: stored.priority, dueAt, status: "COMPLETED", result: "NO_ANSWER", reason: "Resultado corrigido no outro cliente" });
    await page.clock.runFor(5_100);
    await expect(calls).toHaveText("1");
    await expect(contacts).toHaveText("0");
    const message = await operations("CREATE_TASK", { title: "Mensagem sincronizada", kind: "WHATSAPP", priority: "MEDIUM", dueAt });
    await operations("COMPLETE_TASK", { taskId: message.id, result: "SENT" });
    await page.clock.runFor(5_100);
    await expect(contacts).toHaveText("1");
    await expect(page.getByRole("region", { name: "Métricas de hoje" }).locator('[data-metric="messages"] > strong')).toHaveText("1");
    const current = await database.lead.findUniqueOrThrow({ where: { id: lead.id } });
    const target = await database.pipelineStage.findFirstOrThrow({ where: { pipelineId: current.pipelineId, leadStageCode: "MEETING_SCHEDULED", deletedAt: null } });
    const move = await client.post(`/api/leads/${lead.id}/stage`, { data: { targetStageId: target.id, expectedUpdatedAt: current.updatedAt.toISOString(), origin: "PIPELINE_BOARD", confirmed: true } });
    expect(move.status(), await move.text()).toBe(200);
    await page.clock.runFor(5_100);
    const booked = page.getByRole("region", { name: "Métricas de hoje" }).locator('[data-metric="meetingsScheduled"] > strong');
    await expect(booked).toHaveText("1");
    const next = await createLead();
    const closer = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, status: "ACTIVE", teamMemberships: { some: { function: "CLOSER", deletedAt: null } } } });
    const meeting = await client.post("/api/meetings", { data: { leadId: next.id, closerId: closer.id, title: "Reunião sincronizada", startsAtLocal: "2035-01-15T10:00", durationMinutes: 30 } });
    expect(meeting.status(), await meeting.text()).toBe(201);
    await page.clock.runFor(5_100);
    await expect(booked).toHaveText("2");
    await page.getByRole("button", { name: "Ranking", exact: true }).click();
    await expect(page.locator('[class*="leaderResult"] > strong')).toHaveText(["2"]);
    expect(await page.evaluate(() => (window as Window & { realtimeTestDocument?: string }).realtimeTestDocument)).toBe(documentId);
  } finally {
    await client.dispose();
    await database.$disconnect();
  }
});
