import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { PrismaClient } from "@/generated/prisma/client";
import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";
import { pactoDimensions } from "@/modules/qualification/domain/pacto-contracts";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { browserRequest } from "./support/browser-request";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for opportunity E2E tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString) });

test.afterAll(async () => database.$disconnect());

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

test("fluxo crítico percorre entrada, SLA, IA local, PACTO, reunião, venda, dashboard e auditoria", async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  await login(page);
  const leadName = `Lead oportunidade E2E ${randomUUID().slice(0, 8)}`;
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(leadName);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(leadName));
  await page.getByLabel("Cargo ou atuação").fill("Gestor público fictício");
  await page.getByLabel("Dor ou interesse").fill("Precisa estruturar uma operação comercial permanente");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  const historyLink = page.getByRole("link", { name: "Abrir histórico operacional do lead" });
  const href = await historyLink.getAttribute("href");
  expect(href).toBeTruthy();
  const leadId = href!.split("/")[2]!;
  const request = browserRequest(page);

  let response = await request.get(`/api/leads/${leadId}/operations`);
  let operations = await response.json() as {
    result: {
      lead: {
        normalizedPhone: string;
        operationalOwner: string;
        score: number | null;
        priorityCode: string;
        nextAction: { title: string } | null;
        sla: { policyName: string; firstHumanAttemptAt: string | null; firstHumanAttemptSeconds: number | null };
      };
    };
  };
  expect(operations.result.lead).toMatchObject({
    normalizedPhone: expect.stringMatching(/^\+55/),
    priorityCode: expect.stringMatching(/^P[123]$/),
    nextAction: { title: "Ligar agora" },
  });
  expect(operations.result.lead.operationalOwner).not.toBe("Responsável operacional indisponível");
  expect(operations.result.lead.score).not.toBeNull();
  expect(operations.result.lead.sla).toMatchObject({
    policyName: "SLA imediato — 0 minutos",
    firstHumanAttemptAt: null,
  });

  response = await request.post(`/api/leads/${leadId}/operations`, {
    data: {
      action: "RECORD_ACTIVITY",
      data: {
        type: "CALL_CONNECTED",
        direction: "OUTBOUND",
        result: "CONNECTED",
        subject: "Ligação de diagnóstico do fluxo crítico",
        durationSeconds: 600,
        nextTask: {
          title: "Validar PACTO",
          kind: "FOLLOW_UP",
          priority: "HIGH",
          dueAt: "2037-04-09T13:00:00.000Z",
        },
      },
    },
  });
  expect(response.ok()).toBe(true);
  response = await request.get(`/api/leads/${leadId}/operations`);
  operations = await response.json() as typeof operations;
  expect(operations.result.lead.sla.firstHumanAttemptAt).not.toBeNull();
  expect(operations.result.lead.sla.firstHumanAttemptSeconds).not.toBeNull();

  response = await request.post(`/api/leads/${leadId}/intelligence`, {
    data: { action: "RUN", data: { useCase: "CALL_PREPARATION" } },
  });
  expect(response.ok()).toBe(true);
  const intelligence = await response.json() as {
    result: { modeNotice: string; insights: Array<{ provider: { mode: string }; output: { confidence: number } }> };
  };
  expect(intelligence.result.modeNotice).toContain("Modo local determinístico");
  expect(intelligence.result.insights[0]?.provider.mode).toBe("LOCAL_DETERMINISTIC");
  expect(intelligence.result.insights[0]?.output.confidence).toBeGreaterThan(0);

  response = await request.get(`/api/leads/${leadId}/stage`);
  let stage = await response.json() as {
    result: { updatedAt: string; transitions: { stageId: string; code: string }[] };
  };
  let target = stage.result.transitions.find((item) => item.code === "IN_QUALIFICATION")!;
  response = await request.post(`/api/leads/${leadId}/stage`, {
    data: {
      targetStageId: target.stageId,
      expectedUpdatedAt: stage.result.updatedAt,
      reason: "Preparar cenário E2E da oportunidade.",
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
          evidence: `Evidência comercial E2E para ${dimension}`,
          origin: "SDR",
        })),
      },
    },
  });
  expect(response.ok()).toBe(true);
  response = await request.get(`/api/leads/${leadId}/stage`);
  stage = await response.json() as typeof stage;
  target = stage.result.transitions.find((item) => item.code === "QUALIFIED")!;
  response = await request.post(`/api/leads/${leadId}/stage`, {
    data: {
      targetStageId: target.stageId,
      expectedUpdatedAt: stage.result.updatedAt,
      reason: "PACTO completo e reunião autorizada.",
      origin: "LEAD_CARD",
      managerCorrection: false,
      confirmed: true,
      disqualificationReasonId: null,
    },
  });
  expect(response.ok()).toBe(true);

  response = await request.get(`/api/leads/${leadId}/meetings`);
  const meetingOptions = await response.json() as { result: { closerOptions: { id: string }[] } };
  const closerId = meetingOptions.result.closerOptions[0]!.id;
  response = await request.post("/api/meetings", {
    data: {
      leadId,
      closerId,
      title: "Diagnóstico para oportunidade E2E",
      startsAtLocal: "2037-04-10T09:00",
      durationMinutes: 30,
      observation: "Reunião fictícia da CRM-16.",
    },
  });
  expect(response.ok()).toBe(true);
  const scheduled = await response.json() as { result: { meetingId: string } };

  await page.goto(`/agenda/reunioes/${scheduled.result.meetingId}`);
  await expect(page.getByRole("heading", { name: "Briefing do closer" })).toBeVisible();
  await expect(page.getByText("Resumo em três linhas")).toBeVisible();

  await page.goto(`/leads/${leadId}/historico#oportunidade`);
  await page.getByRole("tab", { name: "Negócios" }).click();
  const panel = page.getByRole("tabpanel", { name: "Negócios" });
  await panel.locator("summary").filter({ hasText: "Novo negócio" }).click();
  const createForm = panel;
  await createForm.getByRole("combobox", { name: "Reunião vinculada", exact: true }).selectOption(scheduled.result.meetingId);
  await createForm.getByRole("combobox", { name: "Closer responsável", exact: true }).selectOption(closerId);
  await createForm.getByLabel("Nome", { exact: true }).fill("Contrato anual E2E");
  await createForm.locator('select[name="productId"]').selectOption({ index: 1 });
  await createForm.getByLabel("Valor estimado (R$)").fill("6.500,00");
  await createForm.getByLabel("MRR (R$)").fill("500,00");
  await createForm.getByLabel("TCV (R$)").fill("6.500,00");
  await createForm.getByLabel("Probabilidade manual (%)").fill("60");
  await createForm.getByLabel("Fechamento previsto").fill("2037-04-30");
  await createForm.getByLabel("Próxima ação", { exact: true }).fill("Realizar diagnóstico comercial");
  await createForm.getByLabel("Prazo da próxima ação").fill("2037-04-11T10:00");
  await createForm.getByRole("button", { name: "Criar oportunidade" }).click();
  await expect(panel.getByText("Oportunidade criada e vinculada à reunião.")).toBeVisible();
  const leadOpportunity = panel.getByRole("article").filter({ hasText: "Contrato anual E2E" });
  await expect(leadOpportunity).toContainText("Reunião agendada");

  const attendedAt = new Date();
  await database.meeting.update({
    where: { id: scheduled.result.meetingId },
    data: {
      startsAt: new Date(attendedAt.getTime() - 60 * 60 * 1_000),
      endsAt: new Date(attendedAt.getTime() - 30 * 60 * 1_000),
    },
  });

  response = await request.post(`/api/meetings/${scheduled.result.meetingId}`, {
    data: {
      action: "ATTENDED",
      expectedRevision: 1,
      outcome: "Lead compareceu e validou o cenário.",
      nextAction: { title: "Confirmar oportunidade E2E", dueAtLocal: "2037-04-12T10:00" },
    },
  });
  expect(response.ok()).toBe(true);
  response = await request.get(`/api/leads/${leadId}/opportunities`);
  let opportunityScreen = await response.json() as {
    result: { opportunities: Array<{ id: string; revision: number; stageCode: string; transitions: Array<{ stageId: string; code: string }>; offers: Array<{ totalCents: string }>; status: string; nextActionAt: string | null }> };
  };
  let opportunity = opportunityScreen.result.opportunities[0]!;
  expect(opportunity.stageCode).toBe("MEETING_HELD");
  target = opportunity.transitions.find((item) => item.code === "OPPORTUNITY_CONFIRMED")!;
  response = await request.post(`/api/opportunities/${opportunity.id}`, {
    data: {
      action: "TRANSITION",
      targetStageId: target.stageId,
      expectedRevision: opportunity.revision,
      reason: "Oportunidade confirmada após diagnóstico.",
      origin: "OPPORTUNITY_CARD",
      confirmed: false,
      lossReasonId: null,
    },
  });
  expect(response.ok()).toBe(true);

  await page.goto("/oportunidades");
  await expect(page.getByRole("region", { name: "Pipeline de vendas" })).toBeVisible();
  const card = page
    .getByRole("article")
    .filter({ hasText: "Contrato anual E2E" })
    .filter({ hasText: leadName });
  await expect(card).toContainText(leadName);
  await expect(card).toContainText("R$ 6.500,00");
  await card.getByRole("button", { name: `Abrir detalhes de ${leadName}` }).click();
  await expect(page).toHaveURL(/\/oportunidades(?:\?|$)/);
  await expect(page.getByRole("region", { name: "Pipeline de vendas" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Trabalhar Contrato anual E2E" })).toBeVisible();
  await page.getByRole("button", { name: "Fechar painel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card.getByRole("button", { name: "Trabalhar oportunidade Contrato anual E2E", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const proposalForm = dialog;
  await proposalForm.locator('select[name="productId"]').selectOption({ index: 1 });
  await proposalForm.getByLabel("Nome da proposta").fill("Plano anual validado E2E");
  await proposalForm.getByLabel("Valor unitário (R$)").fill("6.500,00");
  await proposalForm.getByLabel("Desconto (R$)").fill("500,00");
  await proposalForm.getByLabel("Validade").fill("2037-04-25");
  await proposalForm.getByText("Confirmo o registro desta proposta.").click();
  await proposalForm.getByRole("button", { name: "Registrar proposta" }).click();
  await expect(page.getByText("Proposta registrada com valores persistidos.")).toBeVisible();

  response = await request.get(`/api/leads/${leadId}/opportunities`);
  opportunityScreen = await response.json() as typeof opportunityScreen;
  opportunity = opportunityScreen.result.opportunities[0]!;
  expect(opportunity.stageCode).toBe("PROPOSAL");
  expect(opportunity.offers[0]?.totalCents).toBe("600000");
  target = opportunity.transitions.find((item) => item.code === "NEGOTIATION")!;
  response = await request.post(`/api/opportunities/${opportunity.id}`, {
    data: {
      action: "TRANSITION",
      targetStageId: target.stageId,
      expectedRevision: opportunity.revision,
      reason: "Condições em negociação.",
      origin: "OPPORTUNITY_LIST",
      confirmed: false,
      lossReasonId: null,
    },
  });
  expect(response.ok()).toBe(true);
  response = await request.get(`/api/leads/${leadId}/opportunities`);
  opportunityScreen = await response.json() as typeof opportunityScreen;
  opportunity = opportunityScreen.result.opportunities[0]!;
  target = opportunity.transitions.find((item) => item.code === "WON")!;
  response = await request.post(`/api/opportunities/${opportunity.id}`, {
    data: {
      action: "TRANSITION",
      targetStageId: target.stageId,
      expectedRevision: opportunity.revision,
      reason: "Contrato fictício aceito.",
      origin: "OPPORTUNITY_LIST",
      confirmed: true,
      lossReasonId: null,
    },
  });
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "INTEGRATED_SALE_REQUIRED" } });

  await page.goto("/oportunidades");
  const wonStage = await database.pipelineStage.findUniqueOrThrow({ where: { id: target.stageId } });
  await page.getByRole("button", { name: "Arrastar Contrato anual E2E", exact: true }).dragTo(page.getByRole("region", { name: `Etapa ${wonStage.name}`, exact: true }));
  const closing = page.getByRole("dialog").getByRole("region", { name: "Fechar venda integrada" });
  await expect(closing.getByRole("combobox", { name: "Modelo de contrato", exact: true })).toBeEnabled();
  await closing.getByRole("combobox", { name: "Cadastro do cliente", exact: true }).selectOption("CREATE");
  const customerName = `Cliente integrado E2E ${randomUUID()}`;
  await closing.getByLabel("Nome confirmado do cliente").fill(customerName);
  await closing.getByRole("combobox", { name: "Modelo de contrato", exact: true }).selectOption({ index: 1 });
  await closing.getByLabel("Total do contrato (R$)").fill("6000,00");
  await closing.getByLabel("Entrada (R$)").fill("0,00");
  await closing.getByLabel("Mensalidade (R$)").fill("500,00");
  await closing.getByLabel("Quantidade de meses").fill("12");
  await closing.getByLabel("Início de vigência").fill(new Date().toISOString().slice(0, 10));
  await closing.getByLabel("Já existe aceite real do cliente, com evidência para registrar.").check();
  await closing.getByLabel("Quem aceitou", { exact: true }).fill("Cliente sintético E2E");
  await closing.getByLabel("Cargo ou papel de quem aceitou").fill("Diretor");
  await closing.getByLabel("Evidência do aceite").fill("Aceite sintético documentado exclusivamente no schema de teste E2E.");
  await closing.getByRole("button", { name: "Revisar fechamento", exact: true }).click();
  await expect(closing.getByRole("heading", { name: "Revise antes de confirmar" })).toBeVisible();
  expect((await database.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).status).toBe("OPEN");
  expect(await database.account.count({ where: { name: customerName } })).toBe(0);
  await closing.getByLabel("Revisei os dados e confirmo este fechamento.").check();
  await closing.getByRole("button", { name: "Confirmar fechamento integrado" }).click();
  await expect(page.getByRole("region", { name: "Resultado do fechamento integrado" })).toContainText("Venda registrada");
  const customer = await database.account.findFirstOrThrow({ where: { name: customerName } });
  const contract = await database.commercialContract.findFirstOrThrow({ where: { opportunityId: opportunity.id } });
  expect(contract).toMatchObject({ accountId: customer.id, status: "ACCEPTED" });
  const invoices = await database.invoice.findMany({ where: { contractId: contract.id } });
  expect(invoices).toHaveLength(12);
  expect(invoices.every((invoice) => invoice.accountId === customer.id && invoice.status === "OPEN" && invoice.paidCents === 0n)).toBe(true);
  expect((await database.subscription.findFirstOrThrow({ where: { contractId: contract.id } })).currentMrrCents).toBe(50000n);
  response = await request.get(`/api/leads/${leadId}/opportunities`);
  opportunityScreen = await response.json() as typeof opportunityScreen;
  opportunity = opportunityScreen.result.opportunities[0]!;
  expect(opportunity).toMatchObject({ status: "WON", stageCode: "WON", nextActionAt: null });

  await page.goto("/dashboard?preset=MONTH");
  await expect(page.getByRole("heading", { name: /^Bom trabalho,/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Indicadores principais" })).toBeVisible();

  await page.goto("/auditoria?auditAction=opportunity.won");
  await expect(page.getByRole("heading", { name: "Auditoria e saúde do processo" })).toBeVisible();
  await expect(page.locator("tbody code").filter({ hasText: "opportunity.won" }).first()).toBeVisible();
  await expect(page.getByText("Contrato anual E2E", { exact: false }).first()).toBeVisible();
});
