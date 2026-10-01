import { expect, test, type Page } from "@playwright/test";
import { DEMO_SEED_PASSWORD } from "@/modules/settings/application/demo-seed-service";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await expect(page.getByLabel("Workspace")).toHaveCount(0);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hub$/);
  await expect(page.getByRole("heading", { name: "Onde vamos trabalhar?" })).toBeVisible();
}

test("admin cria empresas, compartilha acesso, troca contexto e mantém módulos isolados", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await login(page, "admin@demo.politizai.local");
  const name = `Authentico ${Date.now()}`;
  for (const company of [name, `${name} Filial`]) {
    await page.getByRole("button", { name: "+ Nova empresa", exact: true }).click();
    const form = page.getByRole("form", { name: "Nova empresa" });
    await form.getByLabel("Nome da empresa", { exact: true }).fill(company);
    await form.getByRole("button", { name: "Revisar criação" }).click();
    const preview = page.getByRole("region", { name: "Confirmar alteração" });
    await expect(preview).toContainText(company);
    await expect(page.getByRole("button", { name: `Entrar em ${company}`, exact: true })).toHaveCount(0);
    await preview.getByRole("button", { name: "Confirmar alteração" }).click();
    await expect(page.getByRole("button", { name: `Entrar em ${company}`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Configurar ${company}`, exact: true })).toBeVisible();
  }
  const screen = (await (await page.request.get("/api/hub")).json()).result;
  const target = screen.companies.find((c: { name: string }) => c.name === name);
  const source = screen.companies.find((c: { slug: string }) => c.slug === "politizai");
  expect(screen.companies).toHaveLength(3);
  await page.getByRole("button", { name: "Compartilhar acesso de usuário" }).click();
  const access = page.getByRole("form", { name: "Compartilhar acesso" });
  await access.getByRole("combobox", { name: "Empresa de origem", exact: true }).selectOption(source.id);
  await access.getByRole("combobox", { name: "Usuário", exact: true }).selectOption(source.members.find((m: { email: string }) => m.email === "sdr1@demo.politizai.local").id);
  await access.getByRole("combobox", { name: "Empresa de destino", exact: true }).selectOption(target.id);
  await access.getByRole("combobox", { name: "Papel na empresa de destino", exact: true }).selectOption({ label: "SDR" });
  await access.getByRole("button", { name: "Revisar acesso" }).click();
  await page.getByRole("region", { name: "Confirmar alteração" }).getByRole("button", { name: "Confirmar alteração" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: `Entrar em ${name}`, exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Trocar empresa" })).toContainText(name);
  for (const path of ["/api/leads", "/api/finance", "/api/marketing/performance", "/api/onboarding"]) {
    const response = await page.request.get(path); expect(response.status(), path).toBe(200);
    expect(await response.text()).not.toContain("Marina Ribeiro");
  }
  const leads = (await (await page.request.get("/api/leads")).json()).result;
  expect(JSON.stringify(leads)).not.toContain("@demo.politizai");
  for (const path of ["/pipeline", "/financeiro", "/aquisicao/midia", "/contas"]) {
    await page.goto(path); await expect(page.locator("h1").filter({ hasNotText: /^Carregando/ })).toBeVisible();
    await expect(page.getByText("Algo deu errado", { exact: true })).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "Trocar empresa" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  const oldTab = await page.context().newPage(); await oldTab.goto("/financeiro");
  await expect(oldTab.getByRole("link", { name: "Trocar empresa" })).toContainText(name);
  await page.getByRole("link", { name: "Trocar empresa" }).click();
  await page.getByRole("button", { name: /^Entrar em Politizai/ }).click();
  await expect(oldTab).toHaveURL(/\/hub$/); await oldTab.close();
  await page.goto("/hub");
  await expect(page.getByRole("heading", { name: "Onde vamos trabalhar?" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("company-hub-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const sellerContext = await browser.newContext(); const seller = await sellerContext.newPage();
  await login(seller, "sdr1@demo.politizai.local");
  expect((await (await seller.request.get("/api/hub")).json()).result.companies).toHaveLength(2);
  await expect(seller.getByRole("button", { name: "+ Nova empresa", exact: true })).toHaveCount(0);
  const denied = await seller.request.post("/api/auth/workspace", { data: { workspaceId: screen.companies.find((c: { name: string }) => c.name.endsWith("Filial")).id } });
  expect(denied.status()).toBe(403);
  await seller.getByRole("button", { name: `Entrar em ${name}`, exact: true }).click(); await expect(seller).toHaveURL(/\/$/);
  expect((await seller.request.get("/api/finance")).status()).toBe(403);
  await sellerContext.close();
  expect(errors).toEqual([]);
});

test("usuário com uma empresa passa pelo hub e entra com seu próprio papel", async ({ page }) => {
  await login(page, "closer1@demo.politizai.local");
  expect((await (await page.request.get("/api/hub")).json()).result.companies).toHaveLength(1);
  await expect(page.getByRole("button", { name: "+ Nova empresa", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Entrar em Politizai/ }).click(); await expect(page).toHaveURL(/\/$/);
  expect((await (await page.request.get("/api/auth/session")).json()).session.user.role.key).toBe("closer");
});
