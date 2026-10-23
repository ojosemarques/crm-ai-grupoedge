import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { enterDemoCompany } from "./helpers/company-hub";
import { browserRequest } from "./support/browser-request";

for (const { kind, entry } of [
  { kind: "CALL", entry: "rápida" }, { kind: "WHATSAPP", entry: "rápida" },
  { kind: "CALL", entry: "individual" }, { kind: "WHATSAPP", entry: "individual" },
  { kind: "MESSAGE", entry: "rápida" }, { kind: "INSTAGRAM_MESSAGE", entry: "individual" },
  { kind: "EMAIL", entry: "rápida" }, { kind: "GENERAL", entry: "rápida" },
  { kind: "IMMEDIATE_CALL", entry: "rápida" },
  { kind: "IMMEDIATE_CALL", entry: "individual" },
] as const) {
  test(`conclusão antecipada de ${kind} via ${entry} no card sem exigir próxima tarefa`, async ({ page }) => {
    expect(new URL(process.env.DATABASE_URL!).searchParams.get("schema")).toMatch(/^politizai_test_e2e_/);
    const database = getDatabaseClient();
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(DEMO_USERS[1].email);
    await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await enterDemoCompany(page);
    await page.goto("/email-agente?view=pipeline");
    await page.getByRole("button", { name: "Adicionar", exact: true }).click();
    const name = `Antecipar ${kind} ${randomUUID().slice(0, 8)}`;
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel("Nome", { exact: true }).fill(name);
    await createDialog.getByLabel("Telefone", { exact: true }).fill(`+55119${String(Date.now()).slice(-8)}`);
    await createDialog.getByRole("button", { name: "Adicionar lead" }).click();
    await expect(createDialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: `Abrir ficha completa de ${name}`, exact: true })).toBeVisible();
    const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
    const lead = await database.lead.findFirstOrThrow({ where: { workspaceId: workspace.id, fullName: name } });
    const dueAt = new Date(Date.now() + 48 * 3_600_000);
    let task: { id: string };
    if (kind === "IMMEDIATE_CALL") {
      task = await database.task.findFirstOrThrow({ where: { workspaceId: workspace.id, leadId: lead.id, kind, status: "OPEN" } });
      await database.task.update({ where: { id: task.id }, data: { dueAt } });
    } else {
      const response = await browserRequest(page).post(`/api/leads/${lead.id}/operations`, {
        data: { action: "CREATE_TASK", data: { title: `Contato futuro ${kind}`, kind, priority: "MEDIUM", dueAt: dueAt.toISOString() } },
      });
      expect(response.status()).toBe(200);
      task = (await response.json() as { result: { id: string } }).result;
    }
    // Isola a última tarefa para não deixar uma tarefa de SLA mascarar a exigência indevida.
    await database.task.updateMany({ where: { workspaceId: workspace.id, leadId: lead.id, id: { not: task.id }, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "CANCELLED", updatedByActorId: lead.updatedByActorId } });
    await database.lead.update({ where: { id: lead.id }, data: { nextActionTaskId: task.id, nextActionAt: dueAt, nextActionDescription: `Contato futuro ${kind}` } });
    await page.getByRole("button", { name: `Abrir ficha completa de ${name}`, exact: true }).click();
    const card = page.getByRole("dialog", { name: "Ficha completa do lead", exact: true });
    await expect(card).toBeVisible();
    await card.getByRole("tab", { name: "Atividades", exact: true }).click();
    await expect(card.locator("#tarefas").getByText("Cancelada", { exact: true })).toHaveCount(0);
    const result = kind === "CALL" ? "NO_ANSWER" : kind === "GENERAL" ? "COMPLETED" : "SENT";
    let completion = entry === "rápida"
      ? card.getByRole("article", { name: "Concluir atendimento e abrir próximo", exact: true })
      : card.locator("#tarefas li").filter({ hasText: kind === "IMMEDIATE_CALL" ? "Ligar agora" : `Contato futuro ${kind}` });
    if (entry === "rápida") await completion.getByRole("button", { name: "Abrir fluxo", exact: true }).click();
    else await completion.locator("summary").click();
    if (kind === "IMMEDIATE_CALL" && entry === "individual") {
      await completion.getByRole("button", { name: "Registrar ligação e concluir", exact: true }).click();
      completion = card.locator("#registrar-atividade");
      await completion.locator('[name="subject"]').fill("Ligação registrada antes do prazo.");
    }
    await expect(completion.locator('[name="nextTitle"]')).not.toHaveAttribute("required", "");
    if (kind === "IMMEDIATE_CALL" && entry === "rápida") {
      await completion.locator('[name="activityType"]').selectOption("CALL_UNANSWERED");
      await completion.locator('[name="resultDescription"]').fill("Ligação registrada antes do prazo.");
    } else if (kind !== "IMMEDIATE_CALL") await completion.getByRole("combobox", { name: entry === "rápida" ? "Resultado" : "Resultado da conclusão", exact: true }).selectOption(result);
    const submit = completion.getByRole("button", { name: entry === "rápida" ? "Concluir e próximo" : kind === "IMMEDIATE_CALL" ? "Registrar atividade" : "Concluir tarefa", exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(async () => (await database.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("COMPLETED");
    const completed = await database.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(completed.dueAt.toISOString()).toBe(dueAt.toISOString());
    expect(completed.completedAt!.getTime()).toBeLessThan(dueAt.getTime());
    expect(completed.result).toBe(kind === "IMMEDIATE_CALL" ? "Tentativa humana registrada." : result);
    if (kind !== "IMMEDIATE_CALL") expect(await database.commercialMetricFact.count({ where: { workspaceId: workspace.id, taskId: task.id, eventType: "TASK_COMPLETED" } })).toBe(1);
    expect(await database.task.count({ where: { workspaceId: workspace.id, leadId: lead.id, status: { in: ["OPEN", "IN_PROGRESS"] } } })).toBe(0);
  });
}
