import { Page } from "@playwright/test";

export async function SetupPasswordScreen(page: Page, extensionId: string) {
  return {
    navigate: async () => {
      await page.goto(`chrome-extension://${extensionId}/popup.html#/setup`);

      return await page.waitForSelector("#setup-password-screen");
    },
  };
}
