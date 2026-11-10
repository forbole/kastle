import { registerHooks } from "node:module";
import { expect, test } from "@playwright/test";
import type {
  BlockscoutTokenTransfer,
  BlockscoutTx,
} from "@/lib/history/blockscout";

// lib/layer2 imports chain logos; Node cannot parse an .svg, so stub each one
// as its own path before the modules under test load.
registerHooks({
  load(url, context, next) {
    if (!url.endsWith(".svg")) return next(url, context);
    return {
      format: "commonjs",
      source: `module.exports = ${JSON.stringify(url)};`,
      shortCircuit: true,
    };
  },
});

const {
  blockscoutApiBase,
  blockscoutPageKey,
  blockscoutPageUrl,
  blockscoutTransferToHistoryRecord,
  blockscoutTxToHistoryRecord,
  isNativeTransfer,
  isValueMove,
} = await import("@/lib/history/blockscout");
const { evmHistoryGate } = await import("@/hooks/evm/useEvmHistory");
const { findChainByHexId, kasplexTestnet } = await import("@/lib/layer2");

const KASPLEX = "0x3173b"; // 202555
const IGRA = "0x97b1"; // 38833
const UNKNOWN = "0x1";
const BASE = "https://api-explorer.kasplex.org";
const OWNER = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const OTHER = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";
const ZERO = "0x0000000000000000000000000000000000000000";
const TOKEN = "0xcccccccccccccccccccccccccccccccccccccccc";
const HASH = "0x" + "ab".repeat(32);

const tx = (over: Partial<BlockscoutTx> = {}): BlockscoutTx => ({
  hash: HASH,
  timestamp: "2026-11-01T12:34:56.000000Z",
  from: { hash: OWNER },
  to: { hash: OTHER },
  value: "1500000000000000000",
  fee: { type: "actual", value: "21000000000000" },
  status: "ok",
  result: "success",
  ...over,
});

const transfer = (
  over: Partial<BlockscoutTokenTransfer> = {},
): BlockscoutTokenTransfer => ({
  transaction_hash: HASH,
  log_index: 3,
  timestamp: "2026-11-01T12:34:56.000000Z",
  from: { hash: OWNER },
  to: { hash: OTHER },
  token: { address_hash: TOKEN, symbol: "USDC", decimals: "6", type: "ERC-20" },
  total: { decimals: "6", value: "2500000" },
  ...over,
});

test.describe("findChainByHexId", () => {
  test("resolves known ids, rejects unknown and unparseable", () => {
    expect(findChainByHexId(KASPLEX)?.name).toBe("Kasplex");
    expect(findChainByHexId(IGRA)?.name).toBe("IGRA");
    expect(findChainByHexId(UNKNOWN)).toBeUndefined();
    expect(findChainByHexId("not-hex")).toBeUndefined();
    expect(findChainByHexId(undefined)).toBeUndefined();
  });
});

test.describe("blockscoutApiBase", () => {
  test("maps chains to their apiUrl", () => {
    expect(blockscoutApiBase(KASPLEX)).toBe("https://api-explorer.kasplex.org");
    expect(blockscoutApiBase(IGRA)).toBe("https://explorer.igralabs.com");
    expect(blockscoutApiBase(UNKNOWN)).toBeNull();
    expect(blockscoutApiBase(undefined)).toBeNull();
  });

  test("strips a trailing slash", () => {
    const original = kasplexTestnet.apiUrl;
    kasplexTestnet.apiUrl = original + "/";
    try {
      const base = blockscoutApiBase("0x28c64"); // 167012
      expect(base).toBe(original);
      expect(
        blockscoutPageUrl(base!, OWNER, { family: "evm-native" }, null),
      ).toBe(`${original}/api/v2/addresses/${OWNER}/transactions`);
    } finally {
      kasplexTestnet.apiUrl = original;
    }
  });
});

test.describe("blockscoutPageUrl", () => {
  test("native transactions carry no type/token", () => {
    expect(blockscoutPageUrl(BASE, OWNER, { family: "evm-native" }, null)).toBe(
      `${BASE}/api/v2/addresses/${OWNER}/transactions`,
    );
  });

  test("ERC-20 filters by type and token", () => {
    const url = new URL(
      blockscoutPageUrl(BASE, OWNER, { family: "erc20", token: TOKEN }, null),
    );
    expect(url.pathname).toBe(`/api/v2/addresses/${OWNER}/token-transfers`);
    expect(url.searchParams.get("type")).toBe("ERC-20");
    expect(url.searchParams.get("token")).toBe(TOKEN);
  });

  test("cursor round-trips and drops null values", () => {
    const cursor = { block_number: 123, index: 4, fee: null, items_count: 50 };
    const url = new URL(
      blockscoutPageUrl(BASE, OWNER, { family: "evm-native" }, cursor),
    );
    expect(url.searchParams.get("block_number")).toBe("123");
    expect(url.searchParams.get("index")).toBe("4");
    expect(url.searchParams.get("items_count")).toBe("50");
    expect(url.searchParams.has("fee")).toBe(false);
  });

  test("page key stops without next_page_params and on unknown chains", () => {
    const key = blockscoutPageKey(KASPLEX, OWNER, { family: "evm-native" });
    expect(key(0, null)).toBe(`${BASE}/api/v2/addresses/${OWNER}/transactions`);
    expect(key(1, { items: [], next_page_params: null })).toBeNull();
    expect(
      key(1, { items: [], next_page_params: { block_number: 9 } }),
    ).toContain("block_number=9");
    expect(
      blockscoutPageKey(UNKNOWN, OWNER, { family: "evm-native" })(0, null),
    ).toBeNull();
  });
});

test.describe("blockscoutTxToHistoryRecord", () => {
  test("native send", () => {
    const r = blockscoutTxToHistoryRecord(tx(), OWNER.toLowerCase(), KASPLEX);
    expect(r.family).toBe("evm-native");
    expect(r.kind).toBe("send");
    expect(r.direction).toBe("out");
    expect(r.amount).toEqual({
      value: { raw: "1500000000000000000", decimals: 18, symbol: "KAS" },
      quality: "exact",
    });
    expect(r.counterparty.value?.address).toBe(OTHER);
    expect(r.fee.value).toEqual({ raw: "21000000000000", symbol: "KAS" });
    expect(r.time).toEqual({
      value: Date.UTC(2026, 10, 1, 12, 34, 56),
      quality: "exact",
    });
    expect(r.explorer).toEqual({
      url: `https://explorer.kasplex.org/tx/${HASH}`,
    });
  });

  test("native receive on Igra uses iKAS", () => {
    const r = blockscoutTxToHistoryRecord(
      tx({ from: { hash: OTHER }, to: { hash: OWNER } }),
      OWNER,
      IGRA,
    );
    expect(r.kind).toBe("receive");
    expect(r.direction).toBe("in");
    expect(r.counterparty.value?.address).toBe(OTHER);
    expect(r.amount.value?.symbol).toBe("iKAS");
    expect(r.explorer?.url).toBe(`https://explorer.igralabs.com/tx/${HASH}`);
  });

  test("self-send", () => {
    const r = blockscoutTxToHistoryRecord(
      tx({ to: { hash: OWNER } }),
      OWNER,
      KASPLEX,
    );
    expect(r.kind).toBe("self");
    expect(r.direction).toBe("self");
  });

  test("zero-value call is dropped, deploy and value rows kept", () => {
    expect(isNativeTransfer(tx({ value: "0" }))).toBe(false);
    expect(isNativeTransfer(tx())).toBe(true);
    expect(isNativeTransfer(tx({ to: null, value: "0" }))).toBe(true);
  });

  test("contract creation is a deploy without amount or counterparty", () => {
    const r = blockscoutTxToHistoryRecord(
      tx({ to: null, value: "0" }),
      OWNER,
      KASPLEX,
    );
    expect(r.kind).toBe("deploy");
    expect(r.direction).toBe("out");
    expect(r.amount.quality).toBe("unavailable");
    expect(r.counterparty.quality).toBe("unavailable");
  });

  test("status mapping", () => {
    const s = (over: Partial<BlockscoutTx>) =>
      blockscoutTxToHistoryRecord(tx(over), OWNER, KASPLEX).status;
    expect(s({ status: "ok" })).toBe("finalized");
    expect(
      s({ status: "error", result: "awaiting_internal_transactions" }),
    ).toBe("failed");
    expect(s({ status: null, result: "pending" })).toBe("pending");
    expect(s({ status: "weird", result: "x" })).toBe("unknown");
  });

  test("missing timestamp is unavailable; unknown chain has no explorer", () => {
    const r = blockscoutTxToHistoryRecord(
      tx({ timestamp: null }),
      OWNER,
      UNKNOWN,
    );
    expect(r.time.quality).toBe("unavailable");
    expect(r.explorer).toBeNull();
  });
});

test.describe("blockscoutTransferToHistoryRecord", () => {
  test("ERC-20 out with 6 decimals", () => {
    const r = blockscoutTransferToHistoryRecord(transfer(), OWNER, KASPLEX);
    expect(r.id).toBe(`${HASH}:3`);
    expect(r.family).toBe("erc20");
    expect(r.kind).toBe("send");
    expect(r.amount.value).toEqual({
      raw: "2500000",
      decimals: 6,
      symbol: "USDC",
    });
    expect(r.fee.quality).toBe("unavailable");
    expect(r.status).toBe("finalized");
    expect(r.explorer?.url).toBe(`https://explorer.kasplex.org/tx/${HASH}`);
  });

  test("ERC-20 in with 18 decimals from token when total lacks them", () => {
    const r = blockscoutTransferToHistoryRecord(
      transfer({
        from: { hash: OTHER },
        to: { hash: OWNER },
        token: {
          address_hash: TOKEN,
          symbol: "WKAS",
          decimals: "18",
          type: "ERC-20",
        },
        total: { decimals: null, value: "1000000000000000000" },
      }),
      OWNER,
      KASPLEX,
    );
    expect(r.kind).toBe("receive");
    expect(r.amount.value).toEqual({
      raw: "1000000000000000000",
      decimals: 18,
      symbol: "WKAS",
    });
  });

  test("mint from the zero address", () => {
    const r = blockscoutTransferToHistoryRecord(
      transfer({ from: { hash: ZERO }, to: { hash: OWNER } }),
      OWNER,
      KASPLEX,
    );
    expect(r.kind).toBe("mint");
    expect(r.direction).toBe("in");
  });

  test("ERC-721 row", () => {
    const r = blockscoutTransferToHistoryRecord(
      transfer({
        from: { hash: OTHER },
        to: { hash: OWNER },
        token: {
          address_hash: TOKEN,
          symbol: "PUNK",
          decimals: null,
          type: "ERC-721",
        },
        total: { token_id: "7" },
      }),
      OWNER,
      KASPLEX,
    );
    expect(r.family).toBe("erc721");
    expect(r.amount.value).toEqual({ raw: "1", decimals: 0, symbol: "PUNK" });
    expect(r.counterparty.value).toEqual({
      address: OTHER,
      label: "#7 · 0xbBbBBB...bBBbB",
    });
  });

  test("missing total is unavailable, never 0", () => {
    const r = blockscoutTransferToHistoryRecord(
      transfer({ total: null }),
      OWNER,
      KASPLEX,
    );
    expect(r.amount).toEqual({ value: null, quality: "unavailable" });
  });

  test("zero-value transfer (address poisoning) dropped, 1 wei kept", () => {
    const zero = transfer({
      from: { hash: OWNER },
      to: { hash: OTHER },
      total: { decimals: "6", value: "0" },
    });
    const oneWei = transfer({ total: { decimals: "18", value: "1" } });
    expect([zero, oneWei].filter(isValueMove)).toEqual([oneWei]);
    expect(isValueMove(transfer({ total: null }))).toBe(true);
    expect(isValueMove(transfer({ total: { token_id: "7" } }))).toBe(true);
  });

  test("unknown chain has no explorer", () => {
    expect(
      blockscoutTransferToHistoryRecord(transfer(), OWNER, UNKNOWN).explorer,
    ).toBeNull();
  });
});

test.describe("pending fee and wallet-load gate", () => {
  test("a pending tx's maximum fee is approximate, an actual fee exact", () => {
    const pending = blockscoutTxToHistoryRecord(
      tx({
        status: null,
        result: "pending",
        fee: { type: "maximum", value: "9" },
      }),
      OWNER,
      KASPLEX,
    );
    expect(pending.fee.quality).toBe("approximate");
    expect(blockscoutTxToHistoryRecord(tx(), OWNER, KASPLEX).fee.quality).toBe(
      "exact",
    );
  });

  test("addressPending with no address is loading, not the no-address reason", () => {
    expect(evmHistoryGate(KASPLEX, undefined, true)).toEqual({
      unavailable: null,
      waiting: true,
    });
    expect(evmHistoryGate(KASPLEX, undefined, false).unavailable).toEqual({
      reason: "History needs an EVM address on this account",
    });
    expect(evmHistoryGate(KASPLEX, OWNER, true)).toEqual({
      unavailable: null,
      waiting: false,
    });
    expect(evmHistoryGate(UNKNOWN, undefined, true).unavailable).toEqual({
      reason: "History is not available for this network",
    });
  });
});
