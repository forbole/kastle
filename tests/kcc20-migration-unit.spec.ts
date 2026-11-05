import { registerHooks } from "node:module";
import { test, expect } from "@playwright/test";
import {
  MAX_TOKENS,
  isMigratableTick,
  parseMigrationPayload,
} from "../lib/kcc20/migration";

// bridge.ts imports provider logos Node can't load.
registerHooks({
  load: (url, ctx, next) =>
    /\.(png|svg)$/.test(url)
      ? { format: "module", source: "export default ''", shortCircuit: true }
      : next(url, ctx),
});
const { bridgeDirectionsFrom } = await import("../lib/bridge/bridge");

const COVENANT = "ab".repeat(32);
const URL_OK = "https://migrate.example.org/kcc20";

test.describe("parseMigrationPayload", () => {
  test("keeps the url and normalises the ticks", () => {
    const config = parseMigrationPayload({
      url: URL_OK,
      tokens: [{ tick: " nacho ", covenantId: COVENANT }],
    });
    expect(config).toEqual({
      url: URL_OK,
      tokens: [{ tick: "NACHO", covenantId: COVENANT }],
    });
    expect(isMigratableTick(config, "nacho")).toBe(true);
    expect(isMigratableTick(config, "KAS")).toBe(false);
  });

  test("drops entries with a bad covenant id", () => {
    const config = parseMigrationPayload({
      url: URL_OK,
      tokens: [
        { tick: "NACHO", covenantId: "AB".repeat(32) },
        { tick: "ZEAL", covenantId: "ab".repeat(31) },
        { tick: "KACHI", covenantId: `0x${"ab".repeat(31)}` },
        { tick: "", covenantId: COVENANT },
        "NACHO",
      ],
    });
    expect(config?.tokens).toEqual([]);
  });

  test("caps the token list at MAX_TOKENS", () => {
    const tokens = Array.from({ length: MAX_TOKENS + 5 }, (_, i) => ({
      tick: `T${i}`,
      covenantId: COVENANT,
    }));
    const config = parseMigrationPayload({ url: URL_OK, tokens });
    expect(config?.tokens.length).toBe(MAX_TOKENS);
  });

  test("rejects a non-https url, falling back to the default", () => {
    expect(
      parseMigrationPayload({ url: "http://migrate.example.org", tokens: [] }),
    ).toBeUndefined();
    expect(
      parseMigrationPayload({ url: "javascript:alert(1)", tokens: [] }),
    ).toBeUndefined();
    expect(
      parseMigrationPayload({ url: "http://migrate.example.org" }, URL_OK)?.url,
    ).toBe(URL_OK);
    expect(parseMigrationPayload(undefined)).toBeUndefined();
  });

  test("rejects a host outside the allowlist", () => {
    const allow = ["example.org"];
    expect(parseMigrationPayload({ url: URL_OK }, undefined, allow)?.url).toBe(
      URL_OK,
    );
    expect(
      parseMigrationPayload({ url: "https://example.org" }, undefined, allow)
        ?.url,
    ).toBe("https://example.org");
    for (const url of [
      "https://example.org.evil.io",
      "https://notexample.org",
      "https://evil.io/?example.org",
    ])
      expect(
        parseMigrationPayload({ url }, undefined, allow),
        url,
      ).toBeUndefined();
  });
});

test.describe("bridgeDirectionsFrom krc20-kcc20", () => {
  const config = parseMigrationPayload({
    url: URL_OK,
    tokens: [{ tick: "NACHO", covenantId: COVENANT }],
  });
  const nacho = { id: "nacho", balance: "100000000" };

  test("is listed with the flag on and a migratable tick held", () => {
    expect(
      bridgeDirectionsFrom("kaspa", true, {
        enabled: true,
        config,
        held: [nacho],
      }),
    ).toContain("krc20-kcc20");
  });

  test("is not listed without every condition", () => {
    const cases = [
      undefined,
      { enabled: false, config, held: [nacho] },
      { enabled: true, config: undefined, held: [nacho] },
      { enabled: true, config, held: [] },
      { enabled: true, config, held: [{ id: "ZEAL", balance: "5" }] },
      { enabled: true, config, held: [{ ...nacho, balance: "0" }] },
      { enabled: true, config, held: [{ ...nacho, balance: "x" }] },
    ];
    for (const migration of cases)
      expect(
        bridgeDirectionsFrom("kaspa", true, migration),
        JSON.stringify(migration),
      ).not.toContain("krc20-kcc20");
  });

  test("is mainnet-only and only from Kaspa", () => {
    const migration = { enabled: true, config, held: [nacho] };
    expect(bridgeDirectionsFrom("kaspa", false, migration)).not.toContain(
      "krc20-kcc20",
    );
    expect(bridgeDirectionsFrom("igra", true, migration)).not.toContain(
      "krc20-kcc20",
    );
  });
});
