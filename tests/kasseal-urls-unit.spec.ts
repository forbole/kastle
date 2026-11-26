// build.ts first: it pulls api.ts, which once read KASSEAL_API_URLS through
// contexts/SettingsContext.tsx and left it undefined depending on import order.
import "../lib/kasseal/build";
import { test, expect } from "@playwright/test";
import { kassealBaseUrl, kassealNetworkOf } from "../lib/kasseal/api";

test("Kasseal base URLs resolve after build.ts is imported first", () => {
  expect(kassealBaseUrl("mainnet")).toBe("https://app.kasseal.com/v1");
  expect(kassealBaseUrl("testnet-10")).toBe("https://testnet.kasseal.com/v1");
  expect(kassealNetworkOf("mainnet")).toBe("mainnet");
  expect(kassealNetworkOf("testnet-10")).toBe("testnet-10");
  expect(kassealNetworkOf(undefined)).toBeUndefined();
});
