import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

function uniquePhone(label: string) {
  const hash = createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex");
  const suffix = (BigInt(`0x${hash.slice(0, 12)}`) % 100_000_000n).toString().padStart(8, "0");
  return `+55119${suffix}`;
}

async function removeActiveProspectingPipeline() {
  const database = getDatabaseClient();
  const pipeline = await database.pipeline.findFirst({
    where: { workspace: { slug: "politizai" }, entityType: "LEAD", name: "Prospecção Ativa", deletedAt: null },
    select: { id: true, workspaceId: true },
  });
  if (!pipeline) return;
  await database.$transaction([
    database.pipelineStageTransition.deleteMany({ where: { workspaceId: pipeline.workspaceId, pipelineId: pipeline.id } }),
    database.pipelineStage.deleteMany({ where: { workspaceId: pipeline.workspaceId, pipelineId: pipeline.id } }),
    database.pipeline.delete({ where: { id: pipeline.id } }),
  ]);
}

async function createManualLead(page: import("@playwright/test").Page, name: string) {
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(name));
  await page.getByLabel("Cargo ou atuação").fill("Gestor público fictício");
  await page.getByLabel("Dor ou interesse").fill("Organizar o processo comercial");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();
}

test("opera o pipeline por quadro, lista e cartão sem exigir configurações auxiliares", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  const leadName = `Lead pipeline E2E ${randomUUID().slice(0, 8)}`;
  await createManualLead(page, leadName);

  await page.goto(`/pipeline?q=${encodeURIComponent(leadName)}`);
  await expect(page.getByRole("heading", { name: "Pré-vendas", exact: true })).toBeVisible();
  const card = page.locator("article").filter({ hasText: leadName });
  await expect(card).toBeVisible();
  const pipelineNavigation = page.getByRole("navigation", { name: "Selecionar pipeline" });
  await expect(pipelineNavigation.getByText("Prospecção Ativa", { exact: true })).toHaveCount(0);
  await expect(pipelineNavigation.getByRole("link", { name: "Pré-vendasPré-vendas" })).toHaveAttribute("aria-current", "page");
  await expect(pipelineNavigation.getByRole("link", { name: "VendasVendas" })).toBeVisible();
  await expect(page.getByLabel("Etapa").getByRole("option", { name: "Novo (1)" })).toHaveCount(1);

  const dragHandle = page.getByRole("button", { name: `Arrastar ${leadName}` });
  const destination = page.getByRole("region", { name: "Etapa Tentando contato" });
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dragHandle.dispatchEvent("dragstart", { dataTransfer });
  await destination.dispatchEvent("dragenter", { dataTransfer });
  await destination.dispatchEvent("dragover", { dataTransfer });
  await destination.dispatchEvent("drop", { dataTransfer });
  await dragHandle.dispatchEvent("dragend", { dataTransfer });
  await expect(page.getByRole("status")).toContainText(`${leadName} foi movido para Tentando contato.`);

  await page.getByRole("button", { name: "Lista" }).click();
  await expect(page.getByRole("row").filter({ hasText: leadName })).toContainText("Tentando contato");
  await page.getByRole("button", { name: "Abrir lead" }).click();
  await expect(page).toHaveURL(/\/pipeline(?:\?|$)/);
  await expect(page.getByRole("table")).toBeVisible();
  const leadDialog = page.getByRole("dialog");
  await expect(leadDialog).toBeVisible();
  await expect(leadDialog.getByRole("heading", { name: leadName, exact: true })).toBeVisible();
  await expect(leadDialog.getByRole("tab", { name: "Inteligência" })).toHaveCount(0);
  await leadDialog.getByRole("tab", { name: "Resumo" }).click();
  await expect(leadDialog.getByRole("heading", { name: "Comunicações" })).toBeVisible();
  await expect(leadDialog.getByRole("heading", { name: "Atividades realizadas" })).toBeVisible();
  await expect(leadDialog.getByText("Atividades registradas", { exact: true })).toBeVisible();
  await expect(leadDialog.getByText("Retornos concluídos", { exact: true })).toBeVisible();
  await expect(leadDialog.getByRole("heading", { name: "Privacidade para contato" })).toHaveCount(0);
  await expect(leadDialog.getByRole("heading", { name: "Contexto atual" })).toHaveCount(0);
  await leadDialog.getByRole("tab", { name: "Atividades" }).click();
  await expect(leadDialog.getByRole("heading", { name: "Jornada de receita" })).toHaveCount(0);
  await expect(leadDialog.getByRole("heading", { name: "Pontuação e prioridade explicáveis" })).toHaveCount(0);
  const timeline = leadDialog.locator("details#timeline");
  await expect(timeline).not.toHaveAttribute("open", "");
  await expect(timeline.getByText("Abrir", { exact: true })).toBeVisible();
  await timeline.locator("summary").click();
  await expect(timeline).toHaveAttribute("open", "");
  await expect(timeline.getByText("Fechar", { exact: true })).toBeVisible();
  await timeline.locator("summary").click();
  await expect(timeline).not.toHaveAttribute("open", "");
  await leadDialog.getByRole("tab", { name: "Qualificação" }).click();
  await expect(leadDialog.getByText("PACTO", { exact: false })).toHaveCount(0);
  const qualificationField = leadDialog.getByLabel("Qualificação do lead");
  await qualificationField.fill("Primeiro contato: lead pediu informações sobre a proposta.");
  await leadDialog.getByRole("button", { name: "Salvar qualificação" }).click();
  await expect(leadDialog.getByText("Qualificação salva.")).toBeVisible();
  await qualificationField.fill("Retorno: lead confirmou interesse e indicou o próximo responsável.");
  await leadDialog.getByRole("button", { name: "Salvar qualificação" }).click();
  await expect(leadDialog.getByText("2 registros", { exact: true })).toBeVisible();
  await expect(leadDialog.getByText("Primeiro contato: lead pediu informações sobre a proposta.")).toBeVisible();
  await expect(leadDialog.getByText("Retorno: lead confirmou interesse e indicou o próximo responsável.")).toBeVisible();
  await expect(leadDialog.getByRole("tab", { name: "Negócios" })).toHaveCount(0);
  await expect(leadDialog.getByRole("button", { name: "Criar oportunidade" })).toHaveCount(0);
  await expect(leadDialog.getByRole("heading", { name: "Negócios", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Fechar ficha e voltar ao pipeline" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("separa a Prospecção Ativa do pipeline de pré-vendas e expõe a operação no menu lateral", async ({ page }) => {
  await removeActiveProspectingPipeline();
  await login(page, DEMO_USERS[1].email);
  const leadName = `Prospecção ativa E2E ${randomUUID().slice(0, 8)}`;
  const areaNavigation = page.getByRole("navigation", { name: "Navegação da área" });
  await expect(page.getByRole("button", { name: /^(Expandir|Recolher) menu$/ })).toHaveCount(0);
  await expect(areaNavigation.getByRole("link", { name: "Negócios", exact: true })).toHaveCount(0);
  const activeProspectingLink = areaNavigation.getByRole("link", { name: "Prospecção Ativa", exact: true });
  await expect(activeProspectingLink).toHaveAttribute("href", "/email-agente");
  await expect(page.locator("#menu-principal")).toHaveCSS("width", "208px");
  await page.goto("/pipeline");
  const pipelineNavigation = page.getByRole("navigation", { name: "Selecionar pipeline" });
  await expect(pipelineNavigation.getByText("Prospecção Ativa", { exact: true })).toHaveCount(0);
  await activeProspectingLink.click();
  await expect(page).toHaveURL(/\/email-agente(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Prospecção Ativa", exact: true })).toBeVisible();
  await expect(activeProspectingLink).toHaveAttribute("aria-current", "page");
  const prospectingAreas = page.getByRole("navigation", { name: "Áreas da Prospecção Ativa" });
  for (const label of ["Visão geral", "Pipeline", "Estoque", "Atividades", "E-mails", "Métricas", "Configurações"]) {
    await expect(prospectingAreas.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await prospectingAreas.getByRole("link", { name: "Pipeline", exact: true }).click();
  await expect(page).toHaveURL(/\/email-agente\?view=pipeline/);
  await expect(page.getByRole("navigation", { name: "Selecionar pipeline" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Quadro do pipeline" })).toBeVisible();
  for (const stage of ["Novo lead", "Abordagem inicial", "Cadência ativa", "Conversa iniciada", "Reunião marcada", "Encerrado — sem retorno", "Descartado"]) {
    await expect(page.getByRole("region", { name: `Etapa ${stage}` })).toBeVisible();
  }

  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  const addLeadDialog = page.getByRole("dialog");
  await addLeadDialog.getByLabel("Nome", { exact: true }).fill(leadName);
  await addLeadDialog.getByLabel("Telefone", { exact: true }).fill(uniquePhone(leadName));
  await addLeadDialog.getByRole("button", { name: "Adicionar lead" }).click();
  await expect(page.locator("article").filter({ hasText: leadName })).toBeVisible();

  for (const [label, heading] of [
    ["Estoque", "Estoque anterior ao Lead"],
    ["Atividades", "Atividades manuais da cadência"],
    ["E-mails", "Ordens de e-mail"],
    ["Métricas", "Taxa de resposta · 30 dias"],
    ["Configurações", "Administração operacional"],
    ["Visão geral", "Pipeline operacional"],
  ] as const) {
    await prospectingAreas.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
});

test("mantém o pipeline somente leitura para o visualizador", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/pipeline");
  await expect(page.getByRole("heading", { name: "Pré-vendas", exact: true })).toBeVisible();
  const firstTransitionButton = page.getByRole("button", { name: "Alterar etapa" }).first();
  if (await firstTransitionButton.count()) await expect(firstTransitionButton).toBeDisabled();
});

test("move leads no celular sem depender de arrastar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, DEMO_USERS[1].email);
  await page.goto("/pipeline");

  const moveButton = page.getByRole("button", { name: /^Mover .+ para outra etapa$/ }).first();
  await expect(moveButton).toBeVisible();
  const touchTarget = await moveButton.boundingBox();
  expect(touchTarget?.height).toBeGreaterThanOrEqual(40);
  expect(touchTarget?.width).toBeGreaterThan(100);

  const card = moveButton.locator("xpath=ancestor::article");
  await expect(card).toHaveAttribute("draggable", "false");
  await expect(card.getByRole("button", { name: /^Arrastar / })).toBeHidden();

  await moveButton.click();
  await expect(page).toHaveURL(/\/pipeline(?:\?|$)/);
  await expect(page.getByRole("dialog")).toBeVisible();
  const stageSelect = page.getByLabel("Etapa de destino");
  await expect(stageSelect).toBeVisible();
  await expect.poll(() => stageSelect.locator("option").count()).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Fechar painel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
