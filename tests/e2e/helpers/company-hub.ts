import { expect, type Page } from "@playwright/test";

export async function enterDemoCompany(page: Page) {
  await expect(page).toHaveURL(/\/hub$/);
  await page.getByRole("button", { name: /^Entrar em Politizai/ }).click();
  await expect(page).toHaveURL(/\/$/);
}
