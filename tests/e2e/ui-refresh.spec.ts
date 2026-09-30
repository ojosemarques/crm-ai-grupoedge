import { expect, test } from "@playwright/test";
import { DEMO_SEED_PASSWORD } from "@/modules/settings/application/demo-seed-service";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("gráficos com dados renderizam mesmo com a política de estilos restrita", async ({ page }) => {
  await page.goto("/dashboard");
  const chart = page.getByRole("img", { name: "Gráfico de Leads recebidos", exact: true });
  await expect(chart.getByRole("application")).toBeVisible();
  await expect(chart.locator(".recharts-area-curve").first()).toBeVisible();
  const height = await chart.locator(".recharts-responsive-container").evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(100);
});

test("agenda semanal mantém os sete dias em colunas", async ({ page }) => {
  await page.goto("/agenda");
  await page.getByRole("button", { name: "Semana", exact: true }).click();
  const calendar = page.locator('[data-view="week"]');
  await expect(calendar).toBeVisible();
  const columns = await calendar.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(7);
});
