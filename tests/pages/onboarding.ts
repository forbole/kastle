import { Page } from "@playwright/test";

export async function OnboardingScreen(page: Page, extensionId: string) {
  return {
    navigate: async () => {
      await page.goto(
        `chrome-extension://${extensionId}/popup.html#/onboarding`,
      );

      return await page.waitForSelector("#onboarding");
    },
    pass: async () => {
      const passWelcomeButton = await page.waitForSelector("#pass-onboarding");
      await passWelcomeButton.click();
    },
  };
}
