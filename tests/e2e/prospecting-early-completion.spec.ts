import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { enterDemoCompany } from "./helpers/company-hub";
import { browserRequest } from "./support/browser-request";

for (const kind of ["CALL", "WHATSAPP"] as const) {
  test(`conclusão antecipada de ${kind} no card da Prospecção Ativa sem exigir próxima tarefa`, async ({ page }) => {
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
    const response = await browserRequest(page).post(`/api/leads/${lead.id}/operations`, {
      data: { action: "CREATE_TASK", data: { title: `Contato futuro ${kind}`, kind, priority: "MEDIUM", dueAt: dueAt.toISOString() } },
    });
    expect(response.status()).toBe(200);
    const { result: task } = await response.json() as { result: { id: string } };
    // Isola a última tarefa para não deixar uma tarefa de SLA mascarar a exigência indevida.
    await database.task.updateMany({ where: { workspaceId: workspace.id, leadId: lead.id, id: { not: task.id }, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "CANCELLED", updatedByActorId: lead.updatedByActorId } });
    await database.lead.update({ where: { id: lead.id }, data: { nextActionTaskId: task.id, nextActionAt: dueAt, nextActionDescription: `Contato futuro ${kind}` } });
    await page.getByRole("button", { name: `Abrir ficha completa de ${name}`, exact: true }).click();
    const card = page.getByRole("dialog", { name: "Ficha completa do lead", exact: true });
    await expect(card).toBeVisible();
    await card.getByRole("tab", { name: "Atividades", exact: true }).click();
    const completion = card.getByRole("article", { name: "Concluir atendimento e abrir próximo", exact: true });
    await completion.getByRole("button", { name: "Abrir fluxo", exact: true }).click();
    await expect(completion.locator('[name="nextTitle"]')).not.toHaveAttribute("required", "");
    await completion.getByRole("combobox", { name: "Resultado", exact: true }).selectOption(kind === "CALL" ? "NO_ANSWER" : "SENT");
    await completion.getByRole("button", { name: "Concluir e próximo", exact: true }).click();
    await expect.poll(async () => (await database.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("COMPLETED");
    const completed = await database.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(completed.dueAt.toISOString()).toBe(dueAt.toISOString());
    expect(completed.completedAt!.getTime()).toBeLessThan(dueAt.getTime());
    expect(completed.result).toBe(kind === "CALL" ? "NO_ANSWER" : "SENT");
    expect(await database.commercialMetricFact.count({ where: { workspaceId: workspace.id, taskId: task.id, eventType: "TASK_COMPLETED" } })).toBe(1);
    expect(await database.task.count({ where: { workspaceId: workspace.id, leadId: lead.id, status: { in: ["OPEN", "IN_PROGRESS"] } } })).toBe(0);
  });
}
