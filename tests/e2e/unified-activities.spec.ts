import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

import { enterDemoCompany } from "./helpers/company-hub";

test("SDR executa tarefas de lead pela fila unificada de atividades", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[1].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);

  await page.goto("/atividades");
  await expect(
    page.getByRole("heading", { name: "Fila única de trabalho" }),
  ).toBeVisible();
  await expect(page.getByText("Pendentes", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Origem")).toContainText("Tarefa do lead");

  await page.getByLabel("Origem").selectOption("LEAD");
  const activities = page.locator("article");
  await expect(activities.first()).toBeVisible();
  await expect(activities.first()).toContainText("Tarefa do lead");
  await expect(
    activities.first().getByRole("link", { name: "Abrir atividade" }),
  ).toHaveAttribute("href", /\/leads\/[0-9a-f-]+\/historico#tarefas/);
});
