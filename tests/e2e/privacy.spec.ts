import { createHash, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

function uniquePhone() {
  const suffix = (BigInt(`0x${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 12)}`) % 100_000_000n).toString().padStart(8, "0");
  return `+55119${suffix}`;
}

test("gestor consulta governança e configuração pendente sem alegar aprovação jurídica", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/privacidade");
  await expect(page.getByRole("heading", { name: "Privacidade e retenção", level: 1 })).toBeVisible();
  await expect(page.getByText("Pendente de jurídico", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/não representa parecer jurídico nem autoriza contato real/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Solicitações de titulares" })).toBeVisible();
});

test("decisão negativa aparece no Lead 360 e bloqueia tentativa humana", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill("Titular opt-out E2E");
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone());
  await page.getByLabel("Não contatar").check();
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await page.getByRole("link", { name: "Abrir histórico operacional do lead" }).click();
  await expect(page.getByText("Contato bloqueado", { exact: true })).toBeVisible();
  const pathname = new URL(page.url()).pathname;
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url.replace("/leads/", "/api/leads/").replace("/historico", "/operations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RECORD_ACTIVITY", data: { type: "CALL_UNANSWERED", direction: "OUTBOUND", subject: "Tentativa indevida" } }),
    });
    return { status: response.status, body: await response.json() };
  }, pathname);
  expect(result.status).toBe(409);
  expect(result.body.error).toMatchObject({ code: "PRIVACY_CONTACT_DENIED" });
});

test("visualizador não abre a central administrativa de privacidade", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/privacidade");
  await expect(page).toHaveURL(/\/acesso-negado$/);
});
