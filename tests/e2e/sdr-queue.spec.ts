import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { PrismaClient } from "@/generated/prisma/client";
import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for SDR queue E2E tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString) });

test.afterAll(async () => database.$disconnect());

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

function uniquePhone(label: string): string {
  const hex = createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex");
  const suffix = (BigInt(`0x${hex.slice(0, 12)}`) % 100_000_000n)
    .toString()
    .padStart(8, "0");
  return `+55119${suffix}`;
}

test("Meu Dia explica a prioridade, abre o drilldown e reflete a ação concluída", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  const leadName = `Lead Meu Dia E2E ${randomUUID().slice(0, 8)}`;
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill(leadName);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone(leadName));
  await page.getByLabel("Cargo ou atuação").fill("Secretário municipal fictício");
  await page.getByLabel("Organização").fill("Organização fictícia");
  await page.getByLabel("Dor ou interesse").fill("Precisa organizar o atendimento comercial");
  await page.getByLabel("Orçamento (R$)").fill("12000,00");
  await page.getByLabel("Prioridade").selectOption("P1");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();
  const historyHref = await page
    .getByRole("link", { name: "Abrir histórico operacional do lead" })
    .getAttribute("href");
  const leadId = historyHref?.split("/")[2];
  expect(leadId).toBeTruthy();
  const assigned = await database.lead.findUniqueOrThrow({
    where: { id: leadId! },
    select: { ownerMemberId: true, nextActionTaskId: true },
  });
  expect(assigned.ownerMemberId).not.toBeNull();
  expect(assigned.nextActionTaskId).not.toBeNull();

  await Promise.all([
    database.lead.update({
      where: { id: leadId! },
      data: {
        awaitingHumanResponse: true,
        lastInboundResponseAt: new Date(Date.now() + 60_000),
      },
    }),
    database.task.update({
      where: { id: assigned.nextActionTaskId! },
      data: { slaCycleId: null },
    }),
  ]);

  await page.goto(`/meu-dia?memberId=${assigned.ownerMemberId}`);
  await expect(page.getByRole("heading", { name: "Meu Dia", exact: true })).toBeVisible();
  for (const section of [
    "Agora",
    "Novos",
    "P1",
    "Aguardando ligação",
    "Responderam",
    "Retorno para hoje",
    "Atrasados",
    "Reuniões de hoje",
    "Sem contato recente",
    "Sem próxima ação",
  ]) {
    await expect(page.getByRole("tab", { name: new RegExp(`^${section} \\d+$`) })).toBeVisible();
  }
  await expect(page.getByRole("tab", { name: /^Agora \d+$/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Agora", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "P1", exact: true })).toHaveCount(0);

  await expect(page.getByText("Atenda agora", { exact: true })).toHaveCount(0);
  await expect(page.getByText("SLA em tempo real", { exact: true })).toHaveCount(0);
  const queueLead = page.getByRole("tabpanel").locator(`[data-lead-id="${leadId}"]`);
  await expect(queueLead).toBeVisible();
  await expect(queueLead).toContainText("P1");
  await expect(queueLead.locator("[data-sla-band]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "SLA crítico" })).toHaveCount(0);
  await expect(queueLead.getByRole("link", { name: "Responder agora" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plano e produção de hoje" })).toBeVisible();
  await expect(page.getByText("Ligações para fazer", { exact: true })).toBeVisible();
  await expect(page.getByText("Mensagens para enviar", { exact: true })).toBeVisible();
  await expect(page.getByText("Acompanhamentos atrasados", { exact: true })).toBeVisible();
  await expect(page.getByText("Sem contato recente", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /da meta diária concluída/ })).toBeVisible();

  await page.getByRole("tab", { name: /^P1 \d+$/ }).click();
  await expect(page).toHaveURL(/queue=P1/);
  await expect(page.getByRole("tab", { name: /^P1 \d+$/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "P1", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Abrir lista de P1:/ }).click();
  await expect(page).toHaveURL(/operationalBucket=P1/);
  await expect(page.getByText(leadName, { exact: true })).toBeVisible();

  await page.goto(`/meu-dia?memberId=${assigned.ownerMemberId}`);
  await page.getByRole("tabpanel").locator(`[data-lead-id="${leadId}"]`).getByRole("link", { name: "Responder agora" }).click();
  await expect(page.getByRole("heading", { name: "Meu Dia", exact: true })).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(leadName, { exact: true }).first()).toBeVisible();
  const activity = dialog.locator("#registrar-atividade");
  await activity.locator('select[name="type"]').selectOption("CALL_UNANSWERED");
  await activity.getByLabel("Assunto").fill("Primeira tentativa pelo Meu Dia");
  await activity.locator('input[name="nextTitle"]').fill("Retornar amanhã");
  await activity.locator('input[name="nextDueAt"]').fill("2035-01-15T10:30");
  await activity.getByRole("button", { name: "Registrar atividade" }).click();
  await expect(dialog.getByRole("status")).toContainText("Operação registrada com sucesso.");
  await expect(
    page.getByRole("tabpanel").locator(`[data-lead-id="${leadId}"]`),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Tarefa concluída e removida do Meu Dia. A próxima etapa já foi atualizada.",
      { exact: true },
    ),
  ).toBeAttached();
  await expect(page.getByRole("heading", { name: "Meu Dia", exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar ficha e voltar ao Meu Dia" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/meu-dia\\?memberId=${assigned.ownerMemberId}$`));

  const updatedCard = page.getByRole("tabpanel").locator(`[data-lead-id="${leadId}"]`).first();
  await expect(updatedCard).toContainText("Última atividade");
  await expect(updatedCard).toContainText(/Primeira tentativa pelo Meu Dia|Retornar amanhã/);
  await expect(updatedCard.getByRole("link", { name: "Responder agora" })).toBeVisible();
  await expect(page.getByLabel("Visualizar fila por SDR")).toBeVisible();
});

test("SDR usa uma fila por vez com teclado e o layout responde sem transbordar", async ({ page }) => {
  await login(page, DEMO_USERS[2].email);
  await page.goto("/meu-dia");

  await expect(page.getByText(/Prioridades de SDR 1 de demonstração/)).toBeVisible();
  await expect(page.getByLabel("Visualizar fila por SDR")).toHaveCount(0);

  const nowTab = page.getByRole("tab", { name: /^Agora \d+$/ });
  await nowTab.focus();
  await page.keyboard.press("ArrowRight");
  const newTab = page.getByRole("tab", { name: /^Novos \d+$/ });
  await expect(newTab).toBeFocused();
  await expect(newTab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/queue=NEW/);

  await page.keyboard.press("End");
  const missingTab = page.getByRole("tab", { name: /^Sem próxima ação \d+$/ });
  await expect(missingTab).toBeFocused();
  await expect(missingTab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/queue=MISSING_NEXT_ACTION/);

  await page.getByRole("button", { name: /^Responderam \d+/ }).click();
  await expect(page.getByRole("tab", { name: /^Responderam \d+$/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Responderam", exact: true })).toBeVisible();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/meu-dia");
    await expect(page.getByRole("heading", { name: "Meu Dia" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

    const queueBox = await page.getByRole("region", { name: "Navegador de filas" }).boundingBox();
    const sideBox = await page.getByRole("complementary", { name: "Riscos e compromissos de hoje" }).boundingBox();
    expect(queueBox).not.toBeNull();
    expect(sideBox).not.toBeNull();
    if (viewport.width >= 1280) {
      expect(sideBox!.x).toBeGreaterThan(queueBox!.x);
    } else {
      expect(sideBox!.y).toBeGreaterThan(queueBox!.y);
    }
  }
});

test("Meu Dia mantém atualização automática dos dados persistidos", async ({ page }) => {
  test.setTimeout(55_000);
  await login(page, DEMO_USERS[1].email);
  await page.goto("/meu-dia");
  await expect(page.getByText(/Atualização automática em até/)).toBeVisible();

  const refreshRequest = page.waitForRequest(
    (request) => {
      const url = new URL(request.url());
      return request.method() === "GET" && url.pathname === "/meu-dia" && url.searchParams.has("_rsc");
    },
    { timeout: 40_000 },
  );
  await refreshRequest;
  await expect(page.getByText(/Atualizado às/)).toBeVisible();
});
