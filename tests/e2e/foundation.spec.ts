import { enterDemoCompany } from "./helpers/company-hub";
import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

test("protege a página inicial e apresenta o login local", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Entre na sua conta" })).toBeVisible();
  await expect(page.getByLabel("Workspace")).toHaveCount(0);
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByLabel("Senha")).toBeVisible();
});

test("retorna erro seguro para login inválido", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("pessoa@example.test");
  await page.getByLabel("Senha").fill("senha-incorreta-completa");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(
    page.getByText("E-mail ou senha inválidos, ou acesso indisponível.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("todos os usuários locais entram com seus papéis", async ({ page }) => {
  for (const account of DEMO_USERS) {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(account.email);
    await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);

    await expect(page).toHaveURL(/\/$/);
    expect((await (await page.request.get("/api/auth/session")).json()).session.user.displayName).toBe(account.displayName);
    await page.goto("/hub");
    await page.getByRole("button", { name: "Sair da conta" }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("nega API de sessão sem autenticação", async ({ request }) => {
  const response = await request.get("/api/auth/session");
  const body = await response.json();

  expect(response.status()).toBe(401);
  expect(body.error).toMatchObject({
    code: "AUTHENTICATION_REQUIRED",
    message: "É necessário entrar para acessar este recurso.",
  });
});

test("exibe estados de acesso negado e sessão expirada", async ({ page }) => {
  await page.goto("/acesso-negado");
  await expect(
    page.getByRole("heading", {
      name: "Você não tem permissão para esta ação",
    }),
  ).toBeVisible();

  await page.goto("/sessao-expirada");
  await expect(
    page.getByRole("heading", { name: "Sua sessão expirou" }),
  ).toBeVisible();
});

test("liveness e readiness têm responsabilidades separadas", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = await response.json();

  expect(response.status()).toBe(200);
  expect(body).toMatchObject({
    status: "ok",
  });
  expect(body).not.toHaveProperty("checks");

  const readinessResponse = await request.get("/api/ready");
  const readinessBody = await readinessResponse.json();
  expect(readinessResponse.status()).toBe(200);
  expect(readinessBody).toMatchObject({ ready: true, checks: { database: "ok" } });
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["referrer-policy"]).toBe("same-origin");
});
