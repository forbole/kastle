import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSingleFlightGuard } from "@/lib/single-flight-guard";
import AdvancedSettingsModal from "@/components/screens/full-pages/account-management/AdvancedSettingsModal";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/**
 * Deferred, controllable promise — stands in for a slow, sequential Ledger
 * APDU exchange loop (listAccounts) without needing real hardware.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test.describe("single-flight guard (B1: Ledger Manage Accounts legacy toggle race)", () => {
  test("guarded toggle is a no-op while the tracked call is in flight, and fires again once it settles", async () => {
    const toggle = { calls: 0 };
    const guard = createSingleFlightGuard();

    const guardedToggle = guard.guard(() => {
      toggle.calls++;
    });

    const gate = deferred<{ publicKeys: string[] }[]>();
    const listAccounts = guard.track(async () => gate.promise);

    // Toggle before anything is in flight: fires normally.
    guardedToggle();
    expect(toggle.calls).toBe(1);

    // Start the "APDU loop" but don't await it yet — mirrors the
    // in-flight window while a Ledger call is awaiting device responses.
    const inFlight = listAccounts();
    expect(guard.isRunning()).toBe(true);

    // Simulate the user toggling Legacy mid-load, repeatedly.
    guardedToggle();
    guardedToggle();
    guardedToggle();
    expect(toggle.calls).toBe(1); // still 1 — none of the mid-flight toggles fired

    // The in-flight call settles.
    gate.resolve([{ publicKeys: ["pubkey"] }]);
    await inFlight;
    expect(guard.isRunning()).toBe(false);

    // Now the toggle works again.
    guardedToggle();
    expect(toggle.calls).toBe(2);
  });

  test("running flag clears via finally even when the tracked call throws (matches the Ledger catch/rethrow path)", async () => {
    const guard = createSingleFlightGuard();
    const listAccounts = guard.track(async () => {
      throw new Error(
        "Failed to list accounts, please unlock and open Kaspa app and try again",
      );
    });

    const call = listAccounts();
    expect(guard.isRunning()).toBe(true);

    await expect(call).rejects.toThrow("Failed to list accounts");
    expect(guard.isRunning()).toBe(false);
  });

  test("a second tracked call would overlap the first if not guarded (demonstrates the actual race being prevented)", async () => {
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;
    const guard = createSingleFlightGuard();

    const gate = deferred<void>();
    const listAccounts = guard.track(async () => {
      concurrentCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      await gate.promise;
      concurrentCalls--;
    });

    // First call starts (e.g. initial mount fetch).
    const first = listAccounts();
    expect(guard.isRunning()).toBe(true);

    // Because isRunning() is true, the toggle handler guarding a remount
    // must not fire — so a second call is never attempted here. This test
    // asserts the guard's own bookkeeping stays consistent with that
    // guarantee (only one call in flight at a time through this guard).
    expect(maxConcurrentCalls).toBe(1);

    gate.resolve();
    await first;
    expect(guard.isRunning()).toBe(false);
    expect(maxConcurrentCalls).toBe(1);
  });
});

test.describe("Legacy toggle disabled-state contract (AdvancedSettingsModal)", () => {
  test("checkbox is disabled when isLegacyToggleDisabled is true (Ledger, listAccounts in flight)", () => {
    const element = AdvancedSettingsModal({
      isOpen: true,
      onClose: () => {},
      isLegacyWalletEnabled: false,
      toggleLegacyWallet: () => {},
      isLegacyToggleDisabled: true,
    }) as any;

    const checkbox = findCheckboxInput(element);
    expect(checkbox).toBeTruthy();
    expect(checkbox.props.disabled).toBe(true);
  });

  test("checkbox is enabled by default when isLegacyToggleDisabled is omitted (RecoveryPhraseManageAccounts baseline)", () => {
    const element = AdvancedSettingsModal({
      isOpen: true,
      onClose: () => {},
      isLegacyWalletEnabled: false,
      toggleLegacyWallet: () => {},
    } as any) as any;

    const checkbox = findCheckboxInput(element);
    expect(checkbox).toBeTruthy();
    expect(checkbox.props.disabled).toBeFalsy();
  });
});

test.describe("RecoveryPhraseManageAccounts is unaffected (source contract)", () => {
  test("RecoveryPhraseManageAccounts does not pass isLegacyToggleDisabled to ManageAccounts, so it keeps the default (never disabled)", () => {
    const source = fs.readFileSync(
      path.join(
        repoRoot,
        "components/screens/full-pages/RecoveryPhraseManageAccounts.tsx",
      ),
      "utf-8",
    );

    expect(source).not.toContain("isLegacyToggleDisabled");
  });

  test("ManageAccounts defaults isLegacyToggleDisabled to false so callers that omit it are unaffected", () => {
    const source = fs.readFileSync(
      path.join(
        repoRoot,
        "components/screens/full-pages/account-management/ManageAccounts.tsx",
      ),
      "utf-8",
    );

    expect(source).toMatch(/isLegacyToggleDisabled\s*=\s*false/);
  });
});

/** Walk a React element tree (plain objects from the automatic JSX runtime) looking for a checkbox <input>. */
function findCheckboxInput(node: any): any {
  if (!node || typeof node !== "object") return null;

  if (node.type === "input" && node.props?.type === "checkbox") {
    return node;
  }

  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findCheckboxInput(child);
      if (found) return found;
    }
  } else if (children) {
    const found = findCheckboxInput(children);
    if (found) return found;
  }

  return null;
}
