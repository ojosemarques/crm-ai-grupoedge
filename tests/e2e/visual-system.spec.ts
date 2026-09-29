import { createHash, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    // In `next dev`, the first compilation may replace the initial document.
    // Interact only after the compiled client form has hydrated.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
    await page.getByLabel("E-mail").fill(DEMO_USERS[0].email);
    await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    try {
      await expect(page).toHaveURL(/\/$/, { timeout: 8_000 });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

function uniquePhone() {
  const hash = createHash("sha256").update(randomUUID()).digest("hex");
  const suffix = (BigInt(`0x${hash.slice(0, 12)}`) % 100_000_000n)
    .toString()
    .padStart(8, "0");
  return `+55119${suffix}`;
}

async function expectBasicAccessibility(page: Page) {
  await expect(page.getByRole("status", { name: /Carregando/ })).toHaveCount(0);
  const violations = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const duplicateIds = [...document.querySelectorAll<HTMLElement>("[id]")]
      .map((element) => element.id)
      .filter((id, index, values) => values.indexOf(id) !== index);
    const unnamedButtons = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .filter(visible)
      .filter((button) => !button.textContent?.trim() && !button.getAttribute("aria-label") && !button.title);
    const unlabeledFields = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type='hidden']), select, textarea")]
      .filter(visible)
      .filter((field) => field.labels?.length === 0 && !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby"));
    return {
      duplicateIds,
      unnamedButtons: unnamedButtons.length,
      unlabeledFields: unlabeledFields.length,
      mainLandmarks: document.querySelectorAll("main").length,
      levelOneHeadings: document.querySelectorAll("h1").length,
    };
  });

  expect(violations).toEqual({
    duplicateIds: [],
    unnamedButtons: 0,
    unlabeledFields: 0,
    mainLandmarks: 1,
    levelOneHeadings: 1,
  });
}

test("shell desktop mantém hierarquia, nomes acessíveis e navegação por teclado", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page);

  await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sair" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: /^Olá, /, level: 1 })).toBeVisible();
  const brandImage = page.locator(".app-brand__mark img");
  await expect(brandImage).toBeVisible();
  expect(await brandImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.getByRole("link", { name: /^Receita/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^Vendas/ }).first()).toBeVisible();
  await expectBasicAccessibility(page);

  const skipLink = page.getByRole("link", { name: "Pular para o conteúdo" });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await skipLink.press("Enter");
  await expect(page.locator("#conteudo-principal")).toBeFocused();

  const routes = [
    ["/meu-dia", "Meu Dia"],
    ["/leads", "Leads"],
    ["/pipeline", "Pipeline de pré-vendas"],
    ["/agenda", "Agenda interna"],
    ["/oportunidades", "Pipeline de vendas"],
    ["/dashboard?preset=MONTH", "Dashboard comercial"],
    ["/copilot?preset=MONTH", "Copilot gerencial"],
  ] as const;

  for (const [route, heading] of routes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sair" })).toHaveCount(1);
    await expectBasicAccessibility(page);
    const hasBodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasBodyOverflow).toBe(false);
  }
});

test("shell responsivo abre por botão, fecha por Escape e respeita movimento reduzido", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  await page.goto("/leads");

  const menu = page.getByRole("button", { name: "Abrir menu de navegação" });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: "Meu Dia", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");

  const rendering = await page.evaluate(() => ({
    hasBodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    transitionDuration: window.getComputedStyle(document.querySelector(".app-sidebar")!).transitionDuration,
  }));
  expect(rendering.hasBodyOverflow).toBe(false);
  const transitionMilliseconds = rendering.transitionDuration.endsWith("ms")
    ? Number.parseFloat(rendering.transitionDuration)
    : Number.parseFloat(rendering.transitionDuration) * 1_000;
  expect(transitionMilliseconds).toBeLessThanOrEqual(0.01);
});

test("tabs e diálogo operacionais seguem o padrão de teclado", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page);
  await page.goto("/leads/entrada");
  const leadName = `Lead visual CRM-28 ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Nome", { exact: true }).fill(leadName);
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone());
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  const historyLink = page.getByRole("link", { name: "Abrir histórico operacional do lead" });
  const historyHref = await historyLink.getAttribute("href");
  expect(historyHref).toBeTruthy();
  await historyLink.click();

  const summary = page.getByRole("tab", { name: "Resumo" });
  await summary.focus();
  await summary.press("ArrowRight");
  const identity = page.getByRole("tab", { name: "Identidade" });
  await expect(identity).toBeFocused();
  await expect(identity).toHaveAttribute("aria-selected", "true");
  await identity.press("ArrowRight");
  const pacto = page.getByRole("tab", { name: "PACTO" });
  await expect(pacto).toBeFocused();
  await expect(pacto).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("progressbar", { name: /dimensões PACTO investigadas/ })).toBeVisible();

  await page.goto(`/pipeline?q=${encodeURIComponent(leadName)}`, { waitUntil: "domcontentloaded" });
  const card = page.locator("article").filter({ hasText: leadName });
  const opener = card.getByRole("button", { name: "Alterar etapa" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`Alterar etapa de ${leadName}`) });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/\/pipeline\?q=/);
  expect(historyHref).toMatch(/^\/leads\/[0-9a-f-]+\/historico$/);
});
