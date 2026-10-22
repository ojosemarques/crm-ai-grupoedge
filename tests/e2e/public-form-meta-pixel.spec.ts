import { expect, test, type Page } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

import { enterDemoCompany } from "./helpers/company-hub";

const PIXEL_ID = "26525824360406160";
const META_EVENT_ID = "a".repeat(64);

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
}

test("Meta Pixel registra PageView e Lead somente após o cadastro aceito", async ({ context, page }) => {
  await login(page);
  await page.goto("/formularios");

  const suffix = Date.now().toString(36);
  const slug = `qa-meta-pixel-${suffix}`;
  await page.getByRole("button", { name: "Novo formulário" }).click();
  const dialog = page.getByRole("dialog", { name: "Comece pelo nome e endereço" });
  await dialog.getByLabel("Nome").fill(`QA Meta Pixel ${suffix}`);
  await dialog.locator("input").nth(1).fill(slug);
  await dialog.getByRole("button", { name: "Criar e editar" }).click();

  await page.getByRole("button", { name: "Métricas" }).click();
  await page.getByLabel("Ativar Meta Pixel/CAPI").check();
  await page.getByLabel("Pixel ID").fill(PIXEL_ID);
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("status")).toHaveText("Nova versão publicada.");

  const publicPage = await context.newPage();
  await publicPage.addInitScript(() => {
    (window as Window & { __capturedMetaEvents?: unknown[][] }).__capturedMetaEvents = [];
  });
  await publicPage.route("https://connect.facebook.net/**", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `(() => {
      window.__capturedMetaEvents ??= [];
      const queued = window.fbq?.queue ? [...window.fbq.queue] : [];
      if (window.fbq) {
        window.fbq.callMethod = (...args) => window.__capturedMetaEvents.push(args);
        window.fbq.queue.length = 0;
      }
      for (const args of queued) window.__capturedMetaEvents.push(args);
    })();`,
  }));
  await publicPage.route(`**/api/public/forms/${slug}/events`, (route) => route.fulfill({ status: 204 }));
  await publicPage.route(`**/api/public/forms/${slug}/submit`, (route) => route.fulfill({
    contentType: "application/json",
    status: 201,
    body: JSON.stringify({
      result: {
        receiptPublicId: "00000000-0000-4000-8000-000000000001",
        outcome: "ACCEPTED",
        redirect: null,
        providerEventIds: { meta: META_EVENT_ID },
      },
    }),
  }));
  await publicPage.goto(`/f/${slug}`);

  await expect.poll(() => publicPage.evaluate(() =>
    (window as Window & { __capturedMetaEvents?: unknown[][] }).__capturedMetaEvents,
  )).toContainEqual(["init", PIXEL_ID]);
  await expect.poll(() => publicPage.evaluate(() =>
    (window as Window & { __capturedMetaEvents?: unknown[][] }).__capturedMetaEvents,
  )).toContainEqual(["track", "PageView"]);

  await publicPage.waitForTimeout(900);
  await publicPage.getByRole("textbox").fill("Lead QA Meta Pixel");
  await publicPage.getByRole("textbox").press("Enter");
  const phone = publicPage.getByRole("textbox");
  await phone.fill(`+55119${suffix.slice(-8).padStart(8, "7").replace(/[^0-9]/g, "7")}`);
  await publicPage.getByRole("button", { name: /Enviar/ }).click();
  await expect(publicPage.getByRole("heading", { name: "Obrigado!" })).toBeVisible();

  await expect.poll(() => publicPage.evaluate(() =>
    (window as Window & { __capturedMetaEvents?: unknown[][] }).__capturedMetaEvents,
  )).toContainEqual(["track", "Lead", {}, { eventID: META_EVENT_ID }]);
});
