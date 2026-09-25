import { expect, test } from "@playwright/test";
import { browserApiPopupDeadline } from "@/components/layouts/browser-api-timeout";

test("payment approval near idle expiry gets a fresh bounded execution window", () => {
  const opened = 1_000;
  const idleDeadline = browserApiPopupDeadline("/zkas-send", opened, {
    kind: "idle",
    at: opened,
  });
  const approved = idleDeadline - 1;
  const busyDeadline = browserApiPopupDeadline("/zkas-send", opened, {
    kind: "busy",
    at: approved,
  });
  expect(idleDeadline - opened).toBe(5 * 60_000);
  expect(busyDeadline - approved).toBe(10 * 60_000);
  expect(busyDeadline).toBeGreaterThan(idleDeadline);
  expect(busyDeadline - opened).toBeLessThan(20 * 60_000);
  expect(
    browserApiPopupDeadline("/zkas-send", opened, {
      kind: "done",
      at: busyDeadline - 1,
    }),
  ).toBe(busyDeadline - 1 + 3 * 60_000);
  expect(
    browserApiPopupDeadline("/zkas-connect", opened, {
      kind: "busy",
      at: approved,
    }),
  ).toBe(opened + 180_000);
});
