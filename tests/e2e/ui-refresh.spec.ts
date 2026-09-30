import { expect, test } from "@playwright/test";
import { DEMO_SEED_PASSWORD } from "@/modules/settings/application/demo-seed-service";

test.beforeEach(async ({ page }) => {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("E-mail").fill("admin@demo.politizai.local");
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("navegação contextual mantém quadro, lista e alteração de etapa acessíveis", async ({ page }) => {
  await page.goto("/pipeline");
  await expect(page.getByRole("navigation", { name: "Módulos do CRM" })).toBeVisible();
  await page.getByRole("button", { name: /Alterar etapa de/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page.locator("main table")).toBeVisible();
  await page.getByRole("button", { name: "Quadro", exact: true }).click();
  await expect(page.getByRole("region", { name: "Quadro do pipeline" })).toBeVisible();
});

test("configurações conserva prévia de impacto e cancelamento em modal", async ({ page }) => {
  await page.goto("/configuracoes");
  await page.getByRole("button", { name: /Catálogo comercial/ }).click();
  await expect(page.getByRole("region", { name: "Produtos" })).toBeVisible();
  await page.getByRole("button", { name: /Operação Qualificação/ }).click();
  await page.getByRole("button", { name: "Revisar impacto", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("filtros do histórico de automações preservam a aba após navegar", async ({ page }) => {
  await page.goto("/automacoes");
  await page.getByRole("button", { name: "Histórico de execuções", exact: true }).click();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("SUCCEEDED");
  await page.getByRole("button", { name: "Filtrar", exact: true }).click();
  await expect(page).toHaveURL(/tab=history/);
  await expect(page.getByRole("heading", { name: "Histórico de execuções", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Histórico de execuções", exact: true })).toHaveAttribute("aria-current", "page");
});

test("composer de e-mail permanece dentro do painel em notebook", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 768 });
  await page.goto("/inbox");
  await page.locator(".inbox-conversation-row").filter({ hasText: "E-mail" }).first().click();
  const send = page.getByRole("button", { name: "Enviar", exact: true });
  await expect(send).toBeVisible();
  const buttonBox = await send.boundingBox();
  const threadBox = await page.locator(".inbox-thread").boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(threadBox).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(threadBox!.y + threadBox!.height);
});

test("menu móvel fecha por Escape e não expande a largura da página", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pipeline");
  const trigger = page.getByRole("button", { name: /Negócios/ });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("aside[inert]")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("gráficos com dados renderizam mesmo com a política de estilos restrita", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/dashboard");
  const chart = page.getByRole("img", { name: "Gráfico de Leads recebidos", exact: true });
  await expect(chart.getByRole("application")).toBeVisible();
  await expect(chart.locator(".recharts-area-curve").first()).toBeVisible();
  const height = await chart.locator(".recharts-responsive-container").evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(100);
  await expect(page.getByRole("img", { name: /leads distribuídos por etapa/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("agenda semanal mantém os sete dias em colunas", async ({ page }) => {
  await page.goto("/agenda");
  await page.getByRole("button", { name: "Semana", exact: true }).click();
  const calendar = page.locator('[data-view="week"]');
  await expect(calendar).toBeVisible();
  const columns = await calendar.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(7);
});

test("indicadores de receita preservam corte, gráficos e navegação entre análises", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/metricas-receita");
  await expect(page.locator('svg[aria-label^="Evolução de"]').first()).toBeVisible();
  await page.getByRole("link", { name: "Receita recorrente", exact: true }).click();
  await expect(page).toHaveURL(/section=mrr/);
  const cutoff = new URL(page.url()).searchParams.get("asOf");
  expect(cutoff).toBeTruthy();
  await page.getByRole("link", { name: "Retenção", exact: true }).click();
  await expect(page).toHaveURL(/section=retention/);
  expect(new URL(page.url()).searchParams.get("asOf")).toBe(cutoff);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("login não coloca credenciais na URL quando JavaScript está indisponível", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/login`);
    await page.getByLabel("E-mail").fill("synthetic@example.test");
    await page.getByLabel("Senha").fill("SyntheticTestOnly123!");
    await page.route(`${baseURL}/login**`, (route) => route.fulfill({ status: 403, body: "JavaScript necessário" }));
    const submission = page.waitForRequest((request) => request.isNavigationRequest());
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    const request = await submission;
    expect(request.method()).toBe("POST");
    expect(new URL(request.url()).search).toBe("");
  } finally {
    await context.close();
  }
});
