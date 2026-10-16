import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";
import { pactoDimensions } from "@/modules/qualification/domain/pacto-contracts";
import { browserRequest } from "./support/browser-request";

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
  await panel.getByLabel("Observação").fill("Revisar PACTO antes da reunião.");
  await panel.getByRole("button", { name: "Agendar reunião" }).click();
  await expect(panel.getByText("Reunião agendada e contexto encaminhado ao closer.")).toBeVisible();
  await expect(panel.getByText("Diagnóstico comercial E2E")).toBeVisible();
  await expect(panel.getByText("Agendada", { exact: true })).toBeVisible();

  await page.goto("/agenda?view=day&date=2035-02-11");
  await expect(page.getByRole("heading", { name: "Agenda interna" })).toBeVisible();
  const meetingCard = page.locator('button[data-status="SCHEDULED"]').filter({ hasText: "Diagnóstico comercial E2E" });
  await expect(meetingCard).toContainText(leadName);
  await expect(meetingCard).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await meetingCard.click();
  const meetingDialog = page.getByRole("dialog", { name: "Diagnóstico comercial E2E" });
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
