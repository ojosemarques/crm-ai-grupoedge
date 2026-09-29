import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";
import { pactoDimensions } from "@/modules/qualification/domain/pacto-contracts";
import { browserRequest } from "./support/browser-request";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(DEMO_USERS[1].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
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
  const meetingCard = page.locator("li").filter({ hasText: "Diagnóstico comercial E2E" });
  await expect(meetingCard).toContainText(leadName);
  await meetingCard.getByRole("button", { name: "Confirmar" }).click();
  await expect(meetingCard.getByText("Confirmada", { exact: true })).toBeVisible();
  await meetingCard.getByRole("link", { name: "Abrir briefing do closer" }).click();
  await expect(page.getByRole("heading", { name: "Briefing do closer" })).toBeVisible();
  await expect(page.getByText("Resumo em três linhas")).toBeVisible();
  await expect(page.getByText("Dor nas palavras do lead")).toBeVisible();
  await expect(page.getByText("Evidência E2E para AFFLICTION").first()).toBeVisible();
  await expect(page.getByText("Perguntas sem resposta")).toBeVisible();
});
