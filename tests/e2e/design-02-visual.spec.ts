import { enterDemoCompany } from "./helpers/company-hub";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

const VIEWPORTS = [
  { height: 900, label: "1440x900", width: 1440 },
  { height: 800, label: "1280x800", width: 1280 },
  { height: 768, label: "1024x768", width: 1024 },
  { height: 844, label: "390x844", width: 390 },
] as const;

const AUTHENTICATED_ROUTES = [
  { label: "dashboard", path: "/" },
  { label: "meu-dia", path: "/meu-dia" },
  { label: "leads", path: "/leads" },
  { label: "agenda", path: "/agenda" },
  { label: "pipeline", path: "/pipeline" },
] as const;

async function login(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("E-mail").fill(DEMO_USERS[0].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

function channelToLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(foreground: readonly number[], background: readonly number[]) {
  const luminance = (color: readonly number[]) =>
    0.2126 * channelToLinear(color[0]!) +
    0.7152 * channelToLinear(color[1]!) +
    0.0722 * channelToLinear(color[2]!);
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

async function expectNoPageOverflow(page: Page, context: string) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `${context}: largura da página`).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: testInfo.outputPath(`${name}.png`),
  });
}

test("fonte, tokens e contrastes globais seguem a identidade Politizai", async ({ page }) => {
  const externalFontRequests: string[] = [];
  page.on("request", (request) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) externalFontRequests.push(request.url());
  });

  await login(page);
  await expect(page.getByRole("heading", { name: /^Olá, /, level: 1 })).toBeVisible();

  const visualSystem = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const sidebar = getComputedStyle(document.querySelector(".app-sidebar")!);
    const primaryAction = getComputedStyle(document.querySelector(".app-topbar__primary-action")!);
    const token = (name: string) => root.getPropertyValue(name).trim();

    return {
      bodyBackground: body.backgroundColor,
      bodyFontFamily: body.fontFamily,
      bodyFontWeight: body.fontWeight,
      fontsLoaded: document.fonts.status,
      primaryBackground: primaryAction.backgroundColor,
      radiusControl: token("--radius-control"),
      radiusModal: token("--radius-modal"),
      radiusPanel: token("--radius-panel"),
      sidebarBackground: sidebar.backgroundColor,
      tokens: {
        brandBlue: token("--brand-blue"),
        brandIce: token("--brand-ice"),
        brandNavy: token("--brand-navy"),
        brandSky: token("--brand-sky"),
        brandSteel: token("--brand-steel"),
      },
    };
  });

  expect(visualSystem).toMatchObject({
    bodyBackground: "rgb(246, 250, 253)",
    bodyFontWeight: "400",
    fontsLoaded: "loaded",
    primaryBackground: "rgb(26, 61, 99)",
    radiusControl: ".6875rem",
    radiusModal: "1.25rem",
    radiusPanel: "1rem",
    sidebarBackground: "rgb(10, 25, 49)",
    tokens: {
      brandBlue: "#1a3d63",
      brandIce: "#f6fafd",
      brandNavy: "#0a1931",
      brandSky: "#b3cfe5",
      brandSteel: "#4a7fa7",
    },
  });
  expect(visualSystem.bodyFontFamily).toContain("Plus Jakarta Sans");
  expect(visualSystem.bodyFontFamily).not.toContain("Inter");
  expect(externalFontRequests).toEqual([]);

  expect(contrastRatio([26, 61, 99], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio([10, 25, 49], [246, 250, 253])).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio([33, 122, 82], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio([138, 86, 0], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio([180, 35, 24], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
});

test("telas prioritárias renderizam sem overflow nas quatro resoluções", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await login(page);

  await page.goto("/leads", { waitUntil: "domcontentloaded" });
  const leadHref = await page.locator("a[href^='/leads/'][href$='/historico']").first().getAttribute("href");
  expect(leadHref).toMatch(/^\/leads\/[0-9a-f-]+\/historico$/);

  const routes = [
    ...AUTHENTICATED_ROUTES,
    { label: "lead-360", path: leadHref! },
  ];

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    for (const route of routes) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByRole("main")).toBeVisible();
      await capture(page, testInfo, `${viewport.label}-${route.label}`);
      await expectNoPageOverflow(page, `${viewport.label} ${route.label}`);
    }
  }
});

test("login preserva a identidade e não transborda nas quatro resoluções", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Entrar", level: 1 })).toBeVisible();
    await expect(page.locator(".login-shell")).toHaveCSS("background-color", "rgb(246, 250, 253)");
    if (viewport.width >= 1024) {
      await expect(page.locator(".login-context")).toHaveCSS("background-color", "rgb(10, 25, 49)");
    }
    await expectNoPageOverflow(page, `${viewport.label} login`);
    await capture(page, testInfo, `${viewport.label}-login`);
  }

  await context.close();
});
