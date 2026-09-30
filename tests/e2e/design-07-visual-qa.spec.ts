import { enterDemoCompany } from "./helpers/company-hub";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

const viewports = [
  { height: 900, label: "1440x900", width: 1440 },
  { height: 800, label: "1280x800", width: 1280 },
  { height: 768, label: "1024x768", width: 1024 },
  { height: 1024, label: "768x1024", width: 768 },
  { height: 844, label: "390x844", width: 390 },
] as const;

function workspaceDateAfter(days: number) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).format(new Date(Date.now() + days * 24 * 60 * 60 * 1_000));
}

async function login(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("E-mail").fill(DEMO_USERS[0].email);
    await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
    try {
      await expect(page).toHaveURL(/\/$/, { timeout: 8_000 });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

async function expectNoPageOverflow(page: Page, context: string) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `${context}: largura total`).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectAccessibleStructure(page: Page) {
  const result = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    return {
      duplicateIds: [...document.querySelectorAll<HTMLElement>("[id]")]
        .map(({ id }) => id)
        .filter((id, index, ids) => ids.indexOf(id) !== index),
      h1: document.querySelectorAll("h1").length,
      main: document.querySelectorAll("main").length,
      unlabeledControls: [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type='hidden']), select, textarea")]
        .filter(visible)
        .filter((control) => !control.labels?.length && !control.getAttribute("aria-label") && !control.getAttribute("aria-labelledby"))
        .length,
      unnamedButtons: [...document.querySelectorAll<HTMLButtonElement>("button")]
        .filter(visible)
        .filter((button) => !button.textContent?.trim() && !button.getAttribute("aria-label") && !button.title)
        .length,
    };
  });
  expect(result).toEqual({ duplicateIds: [], h1: 1, main: 1, unlabeledControls: 0, unnamedButtons: 0 });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ animations: "disabled", fullPage: false, path: testInfo.outputPath(`${name}.png`) });
}

test("telas operacionais e administrativas permanecem consistentes nas cinco resoluções", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  await login(page);

  await page.goto("/leads", { waitUntil: "domcontentloaded" });
  const leadHref = await page.locator("a[href^='/leads/'][href$='/historico']").first().getAttribute("href");
  expect(leadHref).toMatch(/^\/leads\/[0-9a-f-]+\/historico$/);

  // O seed mantém as reuniões operacionais futuras no dia seguinte ao anchor.
  // Consultar esse recorte torna o briefing independente de mutações de testes anteriores.
  await page.goto(`/agenda?view=day&date=${workspaceDateAfter(1)}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Agenda interna", level: 1 })).toBeVisible();
  const meetingHref = await page.locator("a[href^='/agenda/reunioes/']").first().getAttribute("href");
  expect(meetingHref).toMatch(/^\/agenda\/reunioes\/[0-9a-f-]+$/);

  const routes = [
    { label: "dashboard", path: "/" },
    { label: "meu-dia", path: "/meu-dia" },
    { label: "leads", path: "/leads" },
    { label: "entrada", path: "/leads/entrada" },
    { label: "lead-360", path: leadHref! },
    { label: "pipeline", path: "/pipeline" },
    { label: "agenda", path: "/agenda" },
    { label: "reuniao", path: meetingHref! },
    { label: "oportunidades", path: "/oportunidades" },
    { label: "copilot", path: "/copilot?preset=MONTH" },
    { label: "notificacoes", path: "/notificacoes" },
    { label: "pessoas", path: "/administracao" },
    { label: "automacoes", path: "/automacoes" },
    { label: "auditoria", path: "/auditoria" },
    { label: "configuracoes", path: "/configuracoes" },
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status", { name: /Carregando/ })).toHaveCount(0);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toBeVisible();
      await expectNoPageOverflow(page, `${viewport.label} ${route.label}`);
      await expectAccessibleStructure(page);
      if (viewport.width === 1440 || viewport.width === 390) await capture(page, testInfo, `${viewport.label}-${route.label}`);
    }
  }
});

test("PACTO e Inteligência preservam tabs, foco e adaptação mobile", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/leads", { waitUntil: "domcontentloaded" });
  const leadHref = await page.locator("a[href^='/leads/'][href$='/historico']").first().getAttribute("href");
  expect(leadHref).toBeTruthy();

  for (const viewport of [viewports[0], viewports[4]]) {
    await page.setViewportSize(viewport);
    await page.goto(leadHref!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("status", { name: /Carregando/ })).toHaveCount(0);
    const summary = page.getByRole("tab", { name: "Resumo" });
    const identity = page.getByRole("tab", { name: "Identidade" });
    const pacto = page.getByRole("tab", { name: "PACTO" });
    await summary.focus();
    await summary.press("ArrowRight");
    await expect(identity).toBeFocused();
    await expect(identity).toHaveAttribute("aria-selected", "true");
    await identity.press("ArrowRight");
    await expect(pacto).toBeFocused();
    await expect(pacto).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("progressbar", { name: /dimensões PACTO investigadas/ })).toBeVisible();
    await expectNoPageOverflow(page, `${viewport.label} PACTO`);
    await capture(page, testInfo, `${viewport.label}-pacto`);

    const intelligence = page.getByRole("tab", { name: "Inteligência" });
    await intelligence.click();
    await expect(intelligence).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Inteligência aplicada ao lead" })).toBeVisible();
    await expectNoPageOverflow(page, `${viewport.label} Inteligência`);
    await capture(page, testInfo, `${viewport.label}-inteligencia`);
  }
});

test("login, acesso negado e sessão expirada refluem nas cinco resoluções", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of [
      { label: "login", path: "/login" },
      { label: "acesso-negado", path: "/acesso-negado" },
      { label: "sessao-expirada", path: "/sessao-expirada" },
    ]) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1")).toBeVisible();
      await expectNoPageOverflow(page, `${viewport.label} ${route.label}`);
      await expectAccessibleStructure(page);
      if (viewport.width === 1440 || viewport.width === 390) await capture(page, testInfo, `${viewport.label}-${route.label}`);
    }
  }
  await context.close();
});

test("zoom equivalente a 200% mantém os fluxos principais sem overflow de página", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ height: 450, width: 720 });
  await login(page);
  for (const route of ["/", "/meu-dia", "/leads", "/agenda", "/automacoes"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("status", { name: /Carregando/ })).toHaveCount(0);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toBeVisible();
    await expectNoPageOverflow(page, `zoom 200% ${route}`);
  }
});
