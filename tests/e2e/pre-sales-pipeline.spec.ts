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

async function createManualLead(page: import("@playwright/test").Page, name: string) {
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(name));
  await page.getByLabel("Cargo ou atuação").fill("Gestor público fictício");
  await page.getByLabel("Dor ou interesse").fill("Organizar o processo comercial");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();
}

function countDocumentNavigations(page: import("@playwright/test").Page) {
  let count = 0;
  const listener = (request: import("@playwright/test").Request) => {
    if (request.isNavigationRequest() && request.resourceType() === "document") count += 1;
  };
  page.on("request", listener);
  return {
    current: () => count,
    stop: () => page.off("request", listener),
  };
}

test("filtra os pipelines de leads automaticamente sem recarregar o documento", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  const preSalesLeadName = `Filtro pré-vendas ${randomUUID().slice(0, 8)}`;
  await createManualLead(page, preSalesLeadName);
  await page.goto("/pipeline?q=resultado-inexistente");

  const preSalesNavigations = countDocumentNavigations(page);
  await page.getByRole("searchbox", { name: "Pesquisar negócios por nome ou telefone" }).fill(preSalesLeadName);
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(preSalesLeadName).replaceAll("%20", "(?:%20|\\+)")}`));
  await expect(page.locator("article").filter({ hasText: preSalesLeadName })).toBeVisible();
  expect(preSalesNavigations.current()).toBe(0);
  preSalesNavigations.stop();

  await page.goto("/email-agente?view=pipeline");
  const prospectingLeadName = `Filtro prospecção ${randomUUID().slice(0, 8)}`;
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  const addLeadDialog = page.getByRole("dialog");
  await addLeadDialog.getByLabel("Nome", { exact: true }).fill(prospectingLeadName);
  await addLeadDialog.getByLabel("Telefone", { exact: true }).fill(uniquePhone(prospectingLeadName));
  await addLeadDialog.getByRole("button", { name: "Adicionar lead" }).click();
  await expect(page.locator("article").filter({ hasText: prospectingLeadName })).toBeVisible();

  const prospectingNavigations = countDocumentNavigations(page);
  const prospectingSearch = page.getByRole("searchbox", { name: "Pesquisar negócios por nome ou telefone" });
  await prospectingSearch.fill("resultado-inexistente");
  await expect(page.locator("article").filter({ hasText: prospectingLeadName })).toHaveCount(0);
  await expect(prospectingSearch).toBeFocused();
  await prospectingSearch.fill(prospectingLeadName);
  await expect(page.locator("article").filter({ hasText: prospectingLeadName })).toBeVisible();
  await expect(prospectingSearch).toBeFocused();
  expect(prospectingNavigations.current()).toBe(0);
  prospectingNavigations.stop();
});

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
  const board = page.getByRole("region", { name: "Quadro do pipeline" });
  await expect.poll(() => board.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const boardBox = await board.boundingBox();
  if (!boardBox) throw new Error("O quadro do pipeline não possui dimensões visíveis.");
  const edgeDataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dragHandle.dispatchEvent("dragstart", { dataTransfer: edgeDataTransfer });
  for (let index = 0; index < 4; index += 1) {
    await board.dispatchEvent("dragover", {
      clientX: boardBox.x + boardBox.width - 2,
      clientY: boardBox.y + boardBox.height / 2,
      dataTransfer: edgeDataTransfer,
    });
  }
  await expect.poll(() => board.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await dragHandle.dispatchEvent("dragend", { dataTransfer: edgeDataTransfer });
  await board.evaluate((element) => { element.scrollLeft = 0; });

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
  for (const label of ["Pipeline", "Estoque", "Atividades", "Métricas"]) {
    await expect(prospectingAreas.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  for (const removedLabel of ["Visão geral", "E-mails", "Configurações"]) {
    await expect(prospectingAreas.getByRole("link", { name: removedLabel, exact: true })).toHaveCount(0);
  }
  await expect(prospectingAreas.getByRole("link", { name: "Pipeline", exact: true })).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("navigation", { name: "Selecionar pipeline" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Quadro do pipeline" })).toBeVisible();
  for (const stage of ["Novo lead", "Abordagem inicial", "Cadência ativa", "Conversa iniciada", "Reunião marcada", "Noshow", "Reunião feita", "Encerrado — sem retorno", "Descartado"]) {
    await expect(page.getByRole("region", { name: `Etapa ${stage}` })).toBeVisible();
  }

  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  const addLeadDialog = page.getByRole("dialog");
  await addLeadDialog.getByLabel("Nome", { exact: true }).fill(leadName);
  await addLeadDialog.getByLabel("Telefone", { exact: true }).fill(uniquePhone(leadName));
  await addLeadDialog.getByRole("button", { name: "Adicionar lead" }).click();
  const leadCard = page.locator("article").filter({ hasText: leadName });
  await expect(leadCard).toBeVisible();
  const database = getDatabaseClient();
  const createdLead = await database.lead.findFirstOrThrow({
    where: { workspace: { slug: "politizai" }, fullName: leadName },
    select: { id: true, workspaceId: true, contactId: true },
  });
  expect(createdLead.contactId).not.toBeNull();
  const whatsapp = uniquePhone(`${leadName}:whatsapp`);
  const instagram = `@lead_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await leadCard.click();
  await expect(page).toHaveURL(/\/email-agente(?:\?|$)/);
  const prospectingLeadDialog = page.getByRole("dialog");
  await expect(prospectingLeadDialog).toBeVisible();
  await expect(prospectingLeadDialog.getByRole("heading", { name: leadName, exact: true })).toBeVisible();
  await expect(prospectingLeadDialog.getByRole("heading", { name: "Informações do contato", exact: true })).toBeVisible();
  await expect(prospectingLeadDialog.getByRole("tab", { name: "Atividades", exact: true })).toBeVisible();
  await expect(prospectingLeadDialog.getByRole("tab", { name: "Resumo", exact: true })).toBeVisible();
  await prospectingLeadDialog.getByRole("tab", { name: "Contato", exact: true }).click();
  await prospectingLeadDialog.getByLabel("WhatsApp", { exact: true }).fill(whatsapp);
  await prospectingLeadDialog.getByLabel("Instagram", { exact: true }).fill(instagram);
  await prospectingLeadDialog.getByRole("button", { name: "Salvar contatos" }).click();
  await expect(prospectingLeadDialog.getByText("Pontos de contato salvos.")).toBeVisible();
  await expect(prospectingLeadDialog.getByText("WhatsApp principal", { exact: true })).toBeVisible();
  await expect(prospectingLeadDialog.getByText(whatsapp, { exact: true })).toBeVisible();
  await expect(prospectingLeadDialog.getByText("Instagram principal", { exact: true })).toBeVisible();
  await expect(prospectingLeadDialog.getByRole("tabpanel", { name: "Contato" }).getByText(instagram, { exact: true })).toBeVisible();
  const contactSidebar = prospectingLeadDialog
    .getByRole("heading", { name: "Informações do contato", exact: true })
    .locator("..");
  await expect(contactSidebar.getByText("Instagram", { exact: true })).toBeVisible();
  await expect(contactSidebar.getByText(instagram, { exact: true })).toBeVisible();
  const commercialActions = contactSidebar.locator('#vendedor-do-lead + [aria-label="Ações comerciais do lead"]');
  await expect(commercialActions.getByRole("button", { name: "Marcar vendido", exact: true })).toBeVisible();
  await expect.poll(() => database.contactPoint.count({
    where: { workspaceId: createdLead.workspaceId, contactId: createdLead.contactId!, type: { in: ["WHATSAPP", "INSTAGRAM"] }, deletedAt: null },
  })).toBe(2);
  await prospectingLeadDialog.getByRole("tab", { name: "Atividades", exact: true }).click();
  await expect(prospectingLeadDialog.getByRole("tab", { name: "Inteligência" })).toHaveCount(0);
  await expect(prospectingLeadDialog.getByRole("tab", { name: "Negócios" })).toHaveCount(0);
  await expect(prospectingLeadDialog.getByRole("button", { name: "Criar oportunidade" })).toHaveCount(0);
  await expect(prospectingLeadDialog.getByRole("heading", { name: "Tarefas", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fechar ficha e voltar ao pipeline" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Prospecção Ativa", exact: true })).toBeVisible();

  const seller = await database.workspaceMember.findFirstOrThrow({
    where: { workspace: { slug: "politizai" }, user: { normalizedEmail: DEMO_USERS[1].email } },
    select: { id: true },
  });
  await database.lead.update({
    where: { id: createdLead.id },
    data: { ownerMemberId: seller.id, awaitingHumanResponse: true, lastInboundResponseAt: new Date() },
  });

  await page.goto(`/leads?q=${encodeURIComponent(leadName)}`);
  await expect(page.getByRole("row").filter({ hasText: leadName })).toContainText("Prospecção Ativa · Novo lead");

  await page.goto("/meu-dia");
  await expect(page.locator("article").filter({ hasText: leadName })).toHaveCount(0);

  for (const [label, heading] of [
    ["Estoque", "Estoque anterior ao Lead"],
    ["Atividades", "Atividades manuais da cadência"],
    ["Métricas", "Indicadores da Prospecção Ativa"],
  ] as const) {
    await page.goto("/email-agente");
    const currentNavigation = page.getByRole("navigation", { name: "Áreas da Prospecção Ativa" });
    await currentNavigation.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Abrir Indicadores", exact: true })).toHaveAttribute("href", "/dashboard?preset=MONTH");
});

test("abre o fechamento integrado pelo card da Prospecção Ativa", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  const leadName = `Venda no card ${randomUUID().slice(0, 8)}`;
  await page.goto("/email-agente?view=pipeline");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  const addLeadDialog = page.getByRole("dialog");
  await addLeadDialog.getByLabel("Nome", { exact: true }).fill(leadName);
  await addLeadDialog.getByLabel("Telefone", { exact: true }).fill(uniquePhone(leadName));
  await addLeadDialog.getByRole("button", { name: "Adicionar lead" }).click();
  await expect(page.locator("article").filter({ hasText: leadName })).toBeVisible();

  const database = getDatabaseClient();
  const lead = await database.lead.findFirstOrThrow({
    where: { workspace: { slug: "politizai" }, fullName: leadName },
    select: { id: true, workspaceId: true, createdByActorId: true },
  });
  const salesPipeline = await database.pipeline.findFirstOrThrow({
    where: { workspaceId: lead.workspaceId, entityType: "OPPORTUNITY", isDefault: true, deletedAt: null },
    include: { stages: { where: { opportunityStageCode: "NEGOTIATION", deletedAt: null } } },
  });
  const stage = salesPipeline.stages[0]!;
  const closer = await database.workspaceMember.findFirstOrThrow({
    where: {
      workspaceId: lead.workspaceId,
      status: "ACTIVE",
      deletedAt: null,
      teamMemberships: { some: { function: "CLOSER", deletedAt: null } },
    },
    select: { id: true },
  });
  const opportunity = await database.opportunity.create({
    data: {
      workspaceId: lead.workspaceId,
      leadId: lead.id,
      pipelineId: salesPipeline.id,
      currentStageId: stage.id,
      ownerMemberId: closer.id,
      name: `Negócio de ${leadName}`,
      interestDescription: "Fechamento iniciado pelo card do lead.",
      amountCents: 500000n,
      mrrCents: 500000n,
      tcvCents: 500000n,
      probabilityBps: 8000,
      createdByActorId: lead.createdByActorId,
      updatedByActorId: lead.createdByActorId,
    },
  });
  await database.stageHistory.create({
    data: {
      workspaceId: lead.workspaceId,
      pipelineId: salesPipeline.id,
      stageId: stage.id,
      opportunityId: opportunity.id,
      enteredAt: new Date(),
      enteredByActorId: lead.createdByActorId,
      transitionOrigin: "OPPORTUNITY_CARD",
      transitionReason: "Cenário E2E do fechamento pelo card do lead.",
    },
  });

  await page.goto(`/email-agente?view=pipeline&q=${encodeURIComponent(leadName)}`);
  await page.reload();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/leads/${lead.id}/opportunities`);
    const body = await response.json() as { result: { opportunities: unknown[] } };
    return body.result.opportunities.length;
  }).toBe(1);
  await page.locator("article").filter({ hasText: leadName }).click();
  const leadDialog = page.getByRole("dialog");
  const saleButton = leadDialog.getByRole("button", { name: "Marcar vendido", exact: true });
  await expect(saleButton).toBeEnabled();
  await saleButton.click();
  const salePanel = leadDialog.getByRole("tabpanel", { name: "Marcar vendido" });
  await expect(salePanel).toBeVisible();
  await expect(salePanel.getByRole("combobox", { name: "Modelo de contrato", exact: true })).toBeEnabled();
});

test("carrega todos os cards ao rolar e preserva os carregados ao mover um lead", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/email-agente?view=pipeline");

  const pipelineId = await page.locator('input[name="pipelineId"]').inputValue();
  const prefix = `Paginação pipeline ${randomUUID().slice(0, 8)}`;
  const leads = Array.from({ length: 14 }, (_, index) => ({
    name: `${prefix} ${String(index + 1).padStart(2, "0")}`,
    phone: uniquePhone(`${prefix}:${index}`),
  }));
  await Promise.all(leads.map(async (lead) => {
    const response = await page.request.post("/api/leads/manual", {
      data: {
        idempotencyKey: randomUUID(),
        pipelineId,
        lead: {
          fullName: lead.name,
          phone: lead.phone,
          priorityBandCode: "P3",
        },
      },
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(response.ok()).toBe(true);
  }));

  await page.goto(`/email-agente?view=pipeline&q=${encodeURIComponent(prefix)}`);
  const source = page.getByRole("region", { name: "Etapa Novo lead" });
  await expect(source.locator("article")).toHaveCount(12);
  await source.getByRole("button", { name: "Carregar mais (12 de 14)" }).evaluate((button) => {
    const scroller = button.parentElement;
    if (!scroller) throw new Error("Coluna rolável do pipeline não encontrada.");
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(source.locator("article")).toHaveCount(14);

  await source.getByRole("button", { name: `Alterar etapa de ${leads[0]!.name}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Etapa de destino").selectOption({ label: "Abordagem inicial" });
  await dialog.getByRole("button", { name: "Confirmar transição" }).click();
  await expect(page.getByRole("status")).toContainText(`${leads[0]!.name} foi movido para Abordagem inicial.`);
  await page.waitForLoadState("networkidle");

  await expect(source.locator("article")).toHaveCount(13);
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
