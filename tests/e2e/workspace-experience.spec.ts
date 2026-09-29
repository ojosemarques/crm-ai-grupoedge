import { expect, test, type Page } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";

async function login(page: Page, email: string = DEMO_USERS[0].email) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("home por função oferece uma prioridade e alternância autorizada", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Olá, Administrador" })).toBeVisible();
  await expect(page.getByLabel("Visão da home")).toHaveValue("ADMIN");
  await page.getByLabel("Visão da home").selectOption("MANAGER");
  await expect(page).toHaveURL(/view=MANAGER/);
  await expect(page.getByText("Home operacional · WORKSPACE")).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumo da função" }).getByRole("link")).toHaveCount(3);
});

test("busca global usa teclado, mascara contexto e abre Account e Contact 360", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("button", { name: /Buscar/ })).toBeVisible();
  await page.keyboard.press("Control+K");
  const dialog = page.getByRole("dialog", { name: "Busca global" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Buscar contas, contatos, leads e oportunidades")).toBeFocused();
  await page.getByLabel("Buscar contas, contatos, leads e oportunidades").fill("Instituto Horizonte");
  const account = dialog.getByRole("link", { name: /Instituto Horizonte Cívico/ });
  await expect(account).toBeVisible();
  await account.click();
  await expect(page.getByRole("heading", { name: "Instituto Horizonte Cívico", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline da conta" })).toBeVisible();

  const contact = page.locator("a[href^='/contatos/']").first();
  await expect(contact).toBeVisible();
  await contact.click();
  await expect(page.getByText("Contact 360", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline do contato" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/@demo\.politizai\.local/);

  await page.getByRole("button", { name: /Buscar/ }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /Buscar/ })).toBeFocused();
});

test("home e busca não criam overflow no mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, DEMO_USERS[2].email);
  await expect(page.getByRole("heading", { name: "Olá, SDR" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await expect(page.getByRole("button", { name: /Buscar/ })).toBeVisible();
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Busca global" })).toBeVisible();
});
