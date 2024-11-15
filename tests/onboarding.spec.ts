import { expect } from "@playwright/test";
import { test } from "@/tests/fixtures.ts";
import { OnboardingScreen } from "@/tests/pages/onboarding.ts";
import { SetupPasswordScreen } from "@/tests/pages/setup-password.ts";
import { openPopup } from "./helpers";

test("can reach password setup", async ({ page, extensionId }) => {
  await openPopup(page, extensionId);
  const onboarding = await OnboardingScreen(page, extensionId);
  await onboarding.navigate();
  await onboarding.pass();

  const setupPassword = await SetupPasswordScreen(page, extensionId);

  expect(await setupPassword.navigate()).toBeDefined();
});
