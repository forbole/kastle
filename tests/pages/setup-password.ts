import { Page } from "@playwright/test";

export async function SetupPasswordScreen(page: Page) {
  return {
    navigate: async () => {
      // ponytail: password setup is now an in-place onboarding step, no own route
      return await page.waitForSelector("#setup-password-screen");
    },
  };
}
