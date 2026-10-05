import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

async function logout(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Abrir menu do usuário" }).click();
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

function uniquePhone(): string {
  const hash = createHash("sha256").update(randomUUID()).digest("hex");
  const suffix = (BigInt(`0x${hash.slice(0, 12)}`) % 100_000_000n)
    .toString()
    .padStart(8, "0");
  return `+55119${suffix}`;
}

test("registra atividade e tarefa no histórico operacional persistido", async ({
  page,
}) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill("Lead histórico E2E");
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone());
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await page
    .getByRole("link", { name: "Abrir histórico operacional do lead" })
    .click();

  await expect(page.getByRole("heading", { name: "Lead histórico E2E", exact: true })).toBeVisible();
  await expect(page.getByText(/^Ligar agora ·/).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Atividades" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Lead histórico E2E", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Resumo" }).click();
  await expect(page.getByRole("heading", { name: "Comunicações" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Atividades realizadas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contexto atual" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Contato" }).click();
  await expect(
    page
      .getByRole("tabpanel", { name: "Contato" })
      .getByRole("heading", { name: "Lead histórico E2E", level: 2 }),
  ).toBeVisible();
  await expect(page.getByText("Contato canônico", { exact: true })).toBeVisible();
  await expect(page.getByText("Campos antigos preservados", { exact: true })).toBeVisible();
  await expect(page.getByText("Nenhuma pendência aberta para este contato.")).toBeVisible();

  await page.locator("summary").filter({ hasText: "Ações do contato" }).click();
  await page.getByRole("button", { name: "Adicionar nota" }).click();

  const activity = page.locator("#registrar-atividade");
  await expect(activity).toBeVisible();
  await expect(activity.locator('select[name="type"]')).toHaveValue("NOTE");
  await activity.getByLabel("Direção").selectOption("INTERNAL");
  await activity.getByLabel("Assunto").fill("Nota persistida no E2E");
  await activity.getByLabel("Observação").fill("Fato operacional de demonstração.");
  await activity.getByRole("button", { name: "Registrar atividade" }).click();
  await expect(page.getByRole("status")).toContainText("Operação registrada com sucesso.");
  await page.locator("#timeline > summary").click();
  await expect(page.getByText("Nota persistida no E2E", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Criar tarefa", exact: true }).first().click();
  const task = page.locator("#criar-tarefa");
  await task.getByLabel("Título").fill("Retornar no E2E");
  await task.getByLabel("Prazo").fill("2035-01-15T10:30");
  await task.getByRole("button", { name: "Criar tarefa" }).click();
  await expect(page.getByRole("status")).toContainText("Operação registrada com sucesso.");
  await expect(page.getByText("Retornar no E2E", { exact: true }).first()).toBeVisible();
});

test("exibe estados seguro de inexistência e negação de mutação", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto(`/leads/${randomUUID()}/historico`);
  await expect(page.getByRole("heading", { name: "Lead não encontrado" })).toBeVisible();

  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill("Lead permissão E2E");
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone());
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await page
    .getByRole("link", { name: "Abrir histórico operacional do lead" })
    .click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+\/historico$/);
  await expect(
    page.getByRole("heading", { name: "Lead permissão E2E", exact: true }),
  ).toBeVisible();
  const historyPath = new URL(page.url()).pathname;
  await logout(page);

  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto(historyPath);
  await page.locator("summary").filter({ hasText: "Ações do contato" }).click();
  await expect(page.getByText("Seu perfil possui acesso somente para leitura neste lead.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar ligação" })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "Auditoria" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Qualificação" }).click();
  await expect(page.getByText("Seu perfil possui acesso somente para leitura neste lead.").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar qualificação" })).toHaveCount(0);

  const denied = await page.evaluate(async () => {
    const response = await fetch(`${window.location.pathname.replace("/historico", "/operations").replace("/leads/", "/api/leads/")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "RECORD_ACTIVITY",
        data: { type: "NOTE", direction: "INTERNAL", subject: "Tentativa do visualizador" },
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(denied.status).toBe(403);
  expect(denied.body.error.message).toBe("Você não tem permissão para realizar esta ação.");

  await logout(page);
  await login(page, DEMO_USERS[0].email);
  await page.goto(historyPath);
  await expect(page.getByRole("heading", { name: "Lead permissão E2E", exact: true })).toBeVisible();
});

test("edita o resumo, registra qualificações livres e mantém integrações futuras honestas", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill("Lead cartão CRM-11");
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone());
  await page.getByLabel("E-mail", { exact: true }).fill("cartao.crm11@example.com");
  await page.getByLabel("Cargo ou atuação", { exact: true }).fill("Diretor");
  await page.getByLabel("Organização", { exact: true }).fill("Organização CRM-11");
  await page.getByLabel("Dor ou interesse", { exact: true }).fill("Organizar o processo comercial.");
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await page.getByRole("link", { name: "Abrir histórico operacional do lead" }).click();

  const scoring = page.locator('section[aria-labelledby="score-title"]');
  await expect(scoring.getByText("50 · P2", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Contato" }).click();
  const summary = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Editar informações" }),
  });
  await summary.getByLabel("Cargo ou atuação").fill("");
  await summary.getByLabel("Partido, mandato ou equipe").fill("Organização atualizada");
  await summary.getByRole("button", { name: "Salvar informações" }).click();
  await expect(page.getByRole("status")).toContainText("Operação registrada com sucesso.");
  await expect(page.getByText(/Organização atualizada/).first()).toBeVisible();

  await page.getByRole("tab", { name: "Qualificação" }).click();
  await expect(page.getByText("PACTO", { exact: false })).toHaveCount(0);

  const assignment = page.locator("#vendedor-do-lead");
  await assignment.getByText("Vendedor", { exact: true }).click();
  const destination = assignment.getByLabel("Vendedor dono do card");
  const currentDestination = await destination.inputValue();
  const alternative = await destination.locator("option").evaluateAll(
    (options, current) => options
      .map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: option.textContent ?? "",
      }))
      .find((option) => option.value && option.value !== current),
    currentDestination,
  );
  expect(alternative).toBeTruthy();
  await destination.selectOption(alternative!.value);
  await assignment.getByRole("button", { name: "Alterar vendedor" }).click();
  await expect(page.getByRole("status")).toContainText("Operação registrada com sucesso.");
  await expect(page.getByText(alternative!.label, { exact: true }).first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "Nova qualificação" })).toBeVisible();
  const qualification = page.getByLabel("Qualificação do lead");
  await qualification.fill("Primeira qualificação livre com contexto da prospecção.");
  await page.getByRole("button", { name: "Salvar qualificação" }).click();
  await expect(page.getByText("Qualificação salva.")).toBeVisible();
  await qualification.fill("Segunda qualificação livre com o retorno do lead.");
  await page.getByRole("button", { name: "Salvar qualificação" }).click();
  await expect(page.getByText("2 registros", { exact: true })).toBeVisible();
  await expect(page.getByText("Primeira qualificação livre com contexto da prospecção.")).toBeVisible();
  await expect(page.getByText("Segunda qualificação livre com o retorno do lead.")).toBeVisible();
  await page.getByRole("tab", { name: "Atividades" }).click();
  await expect(scoring.getByText("50 · P2", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Pontuação (0 a 100)").fill("35");
  await page.getByLabel("Motivo obrigatório").fill("Gestor validou prioridade menor no cenário E2E.");
  await page.getByRole("button", { name: "Aplicar override" }).click();
  await expect(scoring.getByText("35 · P3", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Prioridade alterada com motivo e auditoria.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Inteligência" })).toHaveCount(0);
});
