import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("administrador cria usuário local após revisar o impacto", async ({
  page,
}) => {
  await login(page, "admin@demo.politizai.local");
  await page.goto("/administracao");
  await expect(
    page.getByRole("heading", { name: "Usuários e equipes" }),
  ).toBeVisible();

  const createUser = page.getByRole("region", { name: "Criar usuário" });
  const suffix = Date.now();
  const email = `administracao-e2e-${suffix}@demo.politizai.local`;
  await createUser.getByLabel("Nome").fill(`Usuário E2E ${suffix}`);
  await createUser.getByLabel("E-mail").fill(email);
  await createUser.getByLabel("Senha inicial").fill("Senha-local-E2E-123!");
  await createUser.getByLabel("Papel de acesso").selectOption({
    label: "Visualizador",
  });
  await createUser.getByLabel("Equipe inicial").selectOption({
    label: "Pré-vendas",
  });
  await createUser.getByLabel("Função comercial").selectOption("SUPPORT");
  await createUser.getByRole("button", { name: "Revisar criação" }).click();

  const confirmation = page.getByRole("region", {
    name: "Confirmar alteração administrativa",
  });
  await expect(
    confirmation.getByRole("heading", { name: "Criar usuário local" }),
  ).toBeVisible();
  await confirmation.getByRole("button", { name: "Confirmar alteração" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Alteração concluída e auditada",
  );

  await page.getByLabel("Buscar usuário").fill(email);
  await expect(page.getByRole("cell", { name: email })).toBeVisible();
  await expect(page.getByText("Senha-local-E2E-123!", { exact: true })).toHaveCount(0);
});

test("gestor enxerga somente suas equipes e não administra identidades", async ({
  page,
}) => {
  await login(page, "gestor@demo.politizai.local");
  await page.goto("/administracao");

  await expect(page.getByText("Universo exibido: suas equipes.")).toBeVisible();
  await expect(
    page.getByText(
      "Seu acesso gerencial permite disponibilidade e redistribuição dentro das equipes",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Criar usuário" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Gerenciar equipes" })).toHaveCount(0);
});

test("SDR não acessa administração por URL direta", async ({ page }) => {
  await login(page, "sdr1@demo.politizai.local");
  await page.goto("/administracao");
  await expect(page).toHaveURL(/\/acesso-negado$/);
  await expect(
    page.getByRole("heading", {
      name: "Você não tem permissão para esta ação",
    }),
  ).toBeVisible();
});
