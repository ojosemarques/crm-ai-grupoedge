import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";
import { pactoDimensions } from "@/modules/qualification/domain/pacto-contracts";
import { browserRequest } from "./support/browser-request";
import { getDatabaseClient } from "@/shared/core/database/client";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[1].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

function uniquePhone(label: string) {
  const hash = createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex");
  const suffix = (BigInt(`0x${hash.slice(0, 12)}`) % 100_000_000n).toString().padStart(8, "0");
  return `+55119${suffix}`;
}

test("Carlos gerencia reunião de outro vendedor e abre o lead na agenda", async ({ page, browser }) => {
  expect(new URL(process.env.DATABASE_URL!).searchParams.get("schema")).toMatch(/^politizai_test_e2e_/);
  const database = getDatabaseClient();
  const user = await database.user.findUniqueOrThrow({ where: { normalizedEmail: DEMO_USERS[5].email } });
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const closer = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: DEMO_USERS[6].email } } });
  const leadName = `Agenda Carlos ${randomUUID().slice(0, 8)}`;
  await login(page);
  const request = browserRequest(page);
  const created = await request.post("/api/leads/manual", { data: { idempotencyKey: `agenda-carlos:${randomUUID()}`, lead: { fullName: leadName, phone: uniquePhone(leadName), priorityBandCode: "P2" } } });
  expect(created.status(), JSON.stringify(await created.json())).toBe(201);
  const lead = await database.lead.findFirstOrThrow({ where: { workspaceId: workspace.id, fullName: leadName } });
  await database.lead.update({ where: { id: lead.id }, data: { ownerMemberId: closer.id } });
  const title = `Reunião Carlos ${randomUUID().slice(0, 8)}`;
  const scheduled = await request.post("/api/meetings", { data: { leadId: lead.id, closerId: closer.id, title, startsAtLocal: "2035-02-27T09:00", durationMinutes: 30 } });
  expect(scheduled.status(), JSON.stringify(await scheduled.json())).toBe(201);
  const carlosEmail = "carloshenrique@politizai.com";
  const context = await browser.newContext();
  try {
    await database.user.update({ where: { id: user.id }, data: { email: carlosEmail, normalizedEmail: carlosEmail } });
    const carlos = await context.newPage();
    await carlos.goto("/login");
    await carlos.getByLabel("E-mail").fill(carlosEmail);
    await carlos.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
    await carlos.getByRole("button", { name: "Entrar", exact: true }).click();
    await enterDemoCompany(carlos);
    await carlos.goto("/agenda?view=day&date=2035-02-27");
    const card = carlos.locator('button[data-status="SCHEDULED"]').filter({ hasText: title });
    await card.click();
    const dialog = carlos.getByRole("dialog", { name: title, exact: true });
    for (const name of ["Confirmar", "Remarcar", "Cancelar", "Compareceu", "No-show", "Editar reunião", "Ir ao lead"]) {
      await expect(dialog.getByRole("button", { name, exact: true })).toBeVisible();
    }
    const agendaUrl = carlos.url();
    await dialog.getByRole("button", { name: "Ir ao lead", exact: true }).click();
    const leadDialog = carlos.getByRole("dialog", { name: "Ficha completa do lead", exact: true });
    await expect(leadDialog.getByRole("heading", { name: leadName, exact: true })).toBeVisible();
    await leadDialog.getByRole("button", { name: "Fechar ficha e voltar à agenda" }).click();
    await expect(carlos).toHaveURL(agendaUrl);
    await card.click();
    await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(dialog.getByText("Confirmada", { exact: true })).toBeVisible();
    await expect(database.meeting.findFirstOrThrow({ where: { workspaceId: workspace.id, leadId: lead.id, title }, select: { status: true } })).resolves.toEqual({ status: "CONFIRMED" });
  } finally {
    await context.close();
    await database.user.update({ where: { id: user.id }, data: { email: user.email, normalizedEmail: user.normalizedEmail } });
    await database.$disconnect();
  }
});

test("agenda, ciclo da reunião e briefing funcionam sobre dados persistidos", async ({ page }) => {
  await login(page);
  const leadName = `Lead agenda E2E ${randomUUID().slice(0, 8)}`;
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(leadName);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(leadName));
  await page.getByLabel("Cargo ou atuação").fill("Gestor público fictício");
  await page.getByLabel("Dor ou interesse").fill("Precisa organizar o processo comercial permanente");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  const leadLink = page.getByRole("link", { name: "Abrir histórico operacional do lead" });
  const href = await leadLink.getAttribute("href");
  expect(href).toBeTruthy();
  const leadId = href!.split("/")[2]!;
  const request = browserRequest(page);

  let stageResponse = await request.get(`/api/leads/${leadId}/stage`);
  let stageBody = await stageResponse.json() as {
    result: { updatedAt: string; transitions: { stageId: string; code: string }[] };
  };
  let target = stageBody.result.transitions.find((item) => item.code === "IN_QUALIFICATION")!;
  let response = await request.post(`/api/leads/${leadId}/stage`, {
    data: {
      targetStageId: target.stageId,
      expectedUpdatedAt: stageBody.result.updatedAt,
      reason: "Correção gerencial para preparar o cenário E2E da agenda.",
      origin: "LEAD_CARD",
      managerCorrection: true,
      confirmed: true,
      disqualificationReasonId: null,
    },
  });
  expect(response.ok()).toBe(true);

  response = await request.post(`/api/leads/${leadId}/qualification`, {
    data: {
      action: "VALIDATE",
      data: {
        expectedRevision: 0,
        dimensions: pactoDimensions.map((dimension) => ({
          dimension,
          status: "POSITIVE",
          evidence: `Evidência E2E para ${dimension}`,
          origin: "SDR",
        })),
      },
    },
  });
  expect(response.ok()).toBe(true);
  stageResponse = await request.get(`/api/leads/${leadId}/stage`);
  stageBody = await stageResponse.json() as typeof stageBody;
  target = stageBody.result.transitions.find((item) => item.code === "QUALIFIED")!;
  response = await request.post(`/api/leads/${leadId}/stage`, {
    data: {
      targetStageId: target.stageId,
      expectedUpdatedAt: stageBody.result.updatedAt,
      reason: "PACTO validado e passagem explícita para reunião.",
      origin: "LEAD_CARD",
      managerCorrection: false,
      confirmed: true,
      disqualificationReasonId: null,
    },
  });
  expect(response.ok()).toBe(true);

  await page.goto(`/leads/${leadId}/historico`);
  await page.getByRole("tab", { name: "Reuniões" }).click();
  const panel = page.getByRole("tabpanel", { name: "Reuniões" });
  await panel.getByLabel("Closer").selectOption({ index: 1 });
  await panel.getByLabel("Título").fill("Diagnóstico comercial E2E");
  await panel.getByLabel("Data e horário").fill("2035-02-11T09:30");
  await panel.getByLabel("Duração").selectOption("40");
  await panel.getByLabel("E-mail do participante (opcional)").fill("convidado-aba-lead@example.test");
  await panel.getByRole("button", { name: "Adicionar convidado" }).click();
  await panel.getByLabel("E-mail do convidado 2", { exact: true }).fill("segundo-aba-lead@example.test");
  await panel.getByLabel("Observação").fill("Revisar PACTO antes da reunião.");
  await panel.getByRole("button", { name: "Agendar reunião" }).click();
  await expect(panel.getByText("Reunião agendada. Convite e lembretes do participante foram enfileirados.")).toBeVisible();
  await expect(panel.getByText("Participante: convidado-aba-lead@example.test")).toBeVisible();
  await expect(panel.getByText("Participante: segundo-aba-lead@example.test")).toBeVisible();
  await expect(panel.getByText("Diagnóstico comercial E2E")).toBeVisible();
  await expect(panel.getByText("Agendada", { exact: true })).toBeVisible();

  await page.goto("/agenda?view=day&date=2035-02-11");
  await expect(page.getByRole("heading", { name: "Agenda", exact: true })).toBeVisible();
  const meetingCard = page.locator('button[data-status="SCHEDULED"]').filter({ hasText: "Diagnóstico comercial E2E" });
  await expect(meetingCard).toContainText(leadName);
  await expect(meetingCard).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await meetingCard.click();
  const meetingDialog = page.getByRole("dialog", { name: "Diagnóstico comercial E2E" });
  await expect(meetingDialog.getByText(/Participante: convidado-aba-lead@example.test/)).toBeVisible();
  await expect(meetingDialog.getByText(/Participante: segundo-aba-lead@example.test/)).toBeVisible();
  await meetingDialog.getByRole("button", { name: "Editar reunião" }).click();
  await expect(meetingDialog.getByLabel("E-mail do convidado 2", { exact: true })).toHaveValue("segundo-aba-lead@example.test");
  await meetingDialog.getByRole("button", { name: "Remover convidado 2" }).click();
  await meetingDialog.getByRole("button", { name: "Adicionar convidado" }).click();
  await meetingDialog.getByLabel("E-mail do convidado 2", { exact: true }).fill("novo-aba-lead@example.test");
  await meetingDialog.getByLabel("Motivo da correção").fill("Troca de convidado para validar a edição persistida.");
  await meetingDialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(meetingDialog.getByText(/Participante: novo-aba-lead@example.test/)).toBeVisible();
  await expect(meetingDialog.getByText(/Participante: segundo-aba-lead@example.test/)).not.toBeVisible();
  const agendaUrl = page.url();
  const agendaDocumentId = randomUUID();
  await page.evaluate(value => { (window as Window & { agendaDocumentId?: string }).agendaDocumentId = value; }, agendaDocumentId);
  await meetingDialog.getByRole("button", { name: "Ir ao lead", exact: true }).click();
  const leadDialog = page.getByRole("dialog", { name: "Ficha completa do lead", exact: true });
  await expect(leadDialog).toBeVisible();
  await expect(leadDialog.getByRole("heading", { name: leadName, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agenda", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(await page.evaluate(() => (window as Window & { agendaDocumentId?: string }).agendaDocumentId)).toBe(agendaDocumentId);
  await leadDialog.getByRole("button", { name: "Fechar ficha e voltar à agenda" }).click();
  await expect(page).toHaveURL(agendaUrl);
  await expect(leadDialog).not.toBeVisible();
  await expect(meetingCard).toBeVisible();
  // A ficha também abre na visualização de lista, sem perder a agenda ao fechar com Escape.
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await page.getByRole("button", { name: "Ir ao lead", exact: true }).click();
  await expect(leadDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(agendaUrl);
  await expect(leadDialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Lista", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Dia", exact: true }).click();
  await meetingCard.click();
  await meetingDialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(meetingDialog.getByText("Confirmada", { exact: true })).toBeVisible();
  const confirmedCard = page.locator('button[data-status="CONFIRMED"]').filter({ hasText: "Diagnóstico comercial E2E" });
  await expect(confirmedCard).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await meetingDialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await meetingDialog.getByLabel("Motivo").fill("Lead cancelou antes da reunião E2E.");
  await meetingDialog.getByLabel("Próxima ação", { exact: true }).fill("Retomar contato após cancelamento");
  await meetingDialog.getByLabel("Prazo da próxima ação").fill("2035-02-11T11:00");
  await meetingDialog.getByRole("button", { name: "Confirmar ação" }).click();
  await expect(meetingDialog.getByText("Cancelada", { exact: true })).toBeVisible();
  await expect(page.locator('button[data-status="CANCELLED"]').filter({ hasText: "Diagnóstico comercial E2E" })).toHaveCSS("background-color", "rgb(185, 28, 28)");
  await meetingDialog.getByRole("button", { name: "Editar reunião" }).click();
  await meetingDialog.getByLabel("Título").fill("Diagnóstico comercial E2E corrigido");
  await meetingDialog.getByLabel("Status").selectOption("NO_SHOW");
  await meetingDialog.getByLabel("Resultado ou motivo final").fill("Lead não compareceu à reunião E2E.");
  await meetingDialog.getByLabel("Motivo da correção").fill("Cancelamento lançado por engano no teste E2E.");
  await meetingDialog.getByRole("button", { name: "Salvar alterações" }).click();
  const correctedDialog = page.getByRole("dialog", { name: "Diagnóstico comercial E2E corrigido" });
  await expect(correctedDialog.getByText("No-show", { exact: true })).toBeVisible();
  await expect(page.locator('button[data-status="NO_SHOW"]').filter({ hasText: "Diagnóstico comercial E2E corrigido" })).toHaveCSS("background-color", "rgb(194, 24, 91)");
  await correctedDialog.getByRole("button", { name: "Editar reunião" }).click();
  await correctedDialog.getByLabel("Status").selectOption("COMPLETED");
  await correctedDialog.getByLabel("Resultado ou motivo final").fill("Reunião realizada com sucesso no teste E2E.");
  await correctedDialog.getByLabel("Motivo da correção").fill("Resultado ajustado para validar a cor de reunião realizada.");
  await correctedDialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(correctedDialog.getByText("Realizada", { exact: true })).toBeVisible();
  await expect(page.locator('button[data-status="COMPLETED"]').filter({ hasText: "Diagnóstico comercial E2E corrigido" })).toHaveCSS("background-color", "rgb(22, 133, 91)");
  await correctedDialog.getByRole("button", { name: "Editar reunião" }).click();
  await correctedDialog.getByLabel("Status").selectOption("SCHEDULED");
  await correctedDialog.getByLabel("Data e hora").fill("2020-02-11T09:30");
  await correctedDialog.getByLabel("Motivo da correção").fill("Reabertura em período anterior para validar o alerta visual.");
  await correctedDialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(correctedDialog).not.toBeVisible();
  await page.goto("/agenda?view=day&date=2020-02-11");
  const overdueCard = page.locator('button[data-status="PENDING_STATUS"]').filter({ hasText: "Diagnóstico comercial E2E corrigido" });
  await expect(overdueCard).toHaveCSS("background-color", "rgb(194, 65, 12)");
  await overdueCard.click();
  const overdueDialog = page.getByRole("dialog", { name: "Diagnóstico comercial E2E corrigido" });
  await overdueDialog.getByRole("button", { name: "Editar reunião" }).click();
  await overdueDialog.getByLabel("Data e hora").fill("2035-02-11T09:30");
  await overdueDialog.getByLabel("Motivo da correção").fill("Reagendamento futuro após validar o horário passado.");
  await overdueDialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(overdueDialog).not.toBeVisible();
  await page.goto("/agenda?view=day&date=2035-02-11");
  const reopenedCard = page.locator('button[data-status="SCHEDULED"]').filter({ hasText: "Diagnóstico comercial E2E corrigido" });
  await expect(reopenedCard).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await reopenedCard.click();
  const reopenedDialog = page.getByRole("dialog", { name: "Diagnóstico comercial E2E corrigido" });
  await reopenedDialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(reopenedDialog.getByText("Confirmada", { exact: true })).toBeVisible();
  await expect(page.locator('button[data-status="CONFIRMED"]').filter({ hasText: "Diagnóstico comercial E2E corrigido" })).toHaveCSS("background-color", "rgb(29, 78, 216)");
  await reopenedDialog.getByRole("link", { name: "Abrir briefing do closer" }).click();
  await expect(page.getByRole("heading", { name: "Briefing do closer" })).toBeVisible();
  await expect(page.getByText("Resumo em três linhas")).toBeVisible();
  await expect(page.getByText("Dor nas palavras do lead")).toBeVisible();
  await expect(page.getByText("Evidência E2E para AFFLICTION").first()).toBeVisible();
  await expect(page.getByText("Perguntas sem resposta")).toBeVisible();
});

test("cria tarefa de reunião no card com participante persistido na Agenda", async ({ page }) => {
  await login(page);
  const leadName = `Lead tarefa reunião ${randomUUID().slice(0, 8)}`;
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(leadName);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(leadName));
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await page.getByRole("link", { name: "Abrir histórico operacional do lead" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+\/historico$/);
  const leadId = new URL(page.url()).pathname.split("/")[2]!;

  const task = page.locator("#criar-tarefa");
  await task.locator("summary").click();
  await task.getByRole("combobox", { name: "Tipo", exact: true }).selectOption("MEETING");
  await task.getByLabel("Título", { exact: true }).fill("Reunião com convidado pelo card");
  await task.getByRole("combobox", { name: "Closer", exact: true }).selectOption({ index: 1 });
  await task.getByLabel("Data e horário da reunião").fill("2035-02-12T14:00");
  await task.getByLabel("E-mail do participante (opcional)").fill("convidado-tarefa@example.test");
  await task.getByRole("button", { name: "Adicionar convidado" }).click();
  await task.getByLabel("E-mail do convidado 2", { exact: true }).fill("segundo-tarefa@example.test");

  const saved = page.waitForResponse((response) =>
    response.url().endsWith(`/api/leads/${leadId}/operations`) && response.request().method() === "POST");
  await task.getByRole("button", { name: "Criar tarefa e agendar reunião" }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toMatchObject({
    action: "CREATE_TASK",
    data: { kind: "MEETING", participantEmails: ["convidado-tarefa@example.test", "segundo-tarefa@example.test"] },
  });
  const body = await response.json() as { result: { meetingId: string; taskId: string } };
  await expect(page.getByRole("status")).toContainText("Reunião criada na Agenda. Convite e lembretes do participante foram enfileirados.");

  const persisted = await browserRequest(page).get(`/api/leads/${leadId}/meetings`);
  expect(persisted.ok()).toBe(true);
  expect(await persisted.json()).toMatchObject({ result: { meetings: expect.arrayContaining([
    expect.objectContaining({ id: body.result.meetingId, participantEmail: "convidado-tarefa@example.test" }),
  ]) } });

  await page.goto(`/agenda?view=day&date=2035-02-12&meetingId=${body.result.meetingId}`);
  await page.locator('button[data-status="SCHEDULED"]').filter({ hasText: "Reunião com convidado pelo card" }).click();
  const meetingDialog = page.getByRole("dialog", { name: "Reunião com convidado pelo card" });
  await expect(meetingDialog).toBeVisible();
  await expect(meetingDialog.getByText(/Participante: convidado-tarefa@example.test/)).toBeVisible();
  await expect(meetingDialog.getByText(/Participante: segundo-tarefa@example.test/)).toBeVisible();
});

test("agenda permite adicionar e remover convidados antes de salvar", async ({ page }) => {
  await login(page);
  const leadName = `Lead convidados agenda ${randomUUID().slice(0, 8)}`;
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(leadName);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(leadName));
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByRole("link", { name: "Abrir histórico operacional do lead" })).toBeVisible();
  await page.goto("/agenda?view=day&date=2035-02-13");
  await page.getByRole("button", { name: "Agendar reunião", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Agendar reunião" });
  await dialog.getByRole("combobox", { name: "Pesquisar lead" }).fill(leadName);
  await dialog.getByRole("option", { name: new RegExp(leadName) }).click();
  await dialog.getByRole("combobox", { name: "Closer", exact: true }).selectOption({ index: 1 });
  await dialog.getByLabel("Título", { exact: true }).fill("Reunião com dois convidados pela Agenda");
  await dialog.getByLabel("E-mail do participante (opcional)").fill("primeiro-agenda@example.test");
  await dialog.getByRole("button", { name: "Adicionar convidado" }).click();
  await dialog.getByLabel("E-mail do convidado 2", { exact: true }).fill("removido-agenda@example.test");
  await dialog.getByRole("button", { name: "Adicionar convidado" }).click();
  await dialog.getByLabel("E-mail do convidado 3", { exact: true }).fill("segundo-agenda@example.test");
  await dialog.getByRole("button", { name: "Remover convidado 2" }).click();
  await expect(dialog.getByLabel("E-mail do convidado 2", { exact: true })).toHaveValue("segundo-agenda@example.test");
  await dialog.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button").filter({ hasText: "Reunião com dois convidados pela Agenda" }).click();
  const saved = page.getByRole("dialog", { name: "Reunião com dois convidados pela Agenda" });
  await expect(saved.getByText(/Participante: primeiro-agenda@example.test/)).toBeVisible();
  await expect(saved.getByText(/Participante: segundo-agenda@example.test/)).toBeVisible();
  await expect(saved.getByText(/removido-agenda@example.test/)).not.toBeVisible();
});
