import { Method } from "@/lib/service/extension-service.ts";
import { CURRENCIES } from "@/contexts/SettingsContext.tsx";
import * as secp from "@noble/secp256k1";
import { bytesToHex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { sha256 } from "hash-wasm";

export const isProduction = process.env.NODE_ENV === "production";

// A non-ok response is an error, not data. Without this a 500 whose body is
// JSON resolves as data -- SWR reports success and the caller reads fields off
// an error envelope (KNS returns `{success:false,data:null}`, so `page.data.assets`
// throws with no ErrorBoundary to catch it).
export const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json();
};
export const emptyFetcher = (_: string) => Promise.resolve(undefined);

export const multiFetcher = (urls: string[]) =>
  Promise.all(urls.map((url) => fetcher(url)));

export const POPUP_WINDOW_WIDTH = 375;
export const POPUP_WINDOW_HEIGHT = 600;

export const sendMessage = <T>(method: Method, data = {}): Promise<T> =>
  browser.runtime.sendMessage({ method, ...data });

const CURRENCY_SYMBOL_MAPPING: Record<
  string,
  "narrowSymbol" | "symbol" | "code" | "name"
> = {
  CNY: "narrowSymbol",
  EUR: "symbol",
  HKD: "symbol",
  JPY: "narrowSymbol",
  RUB: "narrowSymbol",
  TWD: "symbol",
  USD: "symbol",
} as const;

export function formatTokenPrice(number: number, code: string = "USD") {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    notation: "standard",
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
    currencyDisplay: CURRENCY_SYMBOL_MAPPING[code] ?? "symbol",
  });

  return formatter.format(number);
}

export function formatCurrency(number: number, code: string = "USD") {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    currencyDisplay: CURRENCY_SYMBOL_MAPPING[code] ?? "symbol",
  });

  return formatter.format(number);
}

export function symbolForCurrencyCode(currencyCode: string): string {
  return CURRENCIES.find((value) => value[0] === currencyCode)?.[2] ?? "$";
}

export function formatToken(number: number, maximumFractionDigits: number = 8) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "decimal",
    notation: "standard",
    maximumFractionDigits,
  });

  return formatter.format(number);
}

// Rounding to maximumFractionDigits alone turns a nonzero fee below that
// resolution into "0", which reads as free. Floor it to "<0.00001" instead.
export function formatFeeInKas(
  amount: number,
  maximumFractionDigits: number = 5,
) {
  const floor = 1 / 10 ** maximumFractionDigits;
  if (amount > 0 && amount < floor) {
    return `<${floor}`;
  }
  return formatToken(amount, maximumFractionDigits);
}

export function truncToDecimals(number: number, decimals: number) {
  const factor = Math.pow(10, decimals);
  return Math.floor(number * factor) / factor;
}

export function textEllipsis(text: string, startPos = 8, endPos = 5) {
  if (text.length <= startPos + endPos + 3) {
    return text;
  }

  const start = text.substring(0, startPos);
  const end = text.substring(text.length - endPos, text.length);

  return `${start}...${end}`;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function setPopupPath(path?: `/${string}`, cb: () => void = () => {}) {
  browser.action.setPopup(
    { popup: path ? `popup.html#${path}` : "popup.html" },
    cb,
  );
}

export function openFullPage(path: `/${string}`) {
  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = path;
  browser.tabs.create({ url: url.toString() });
}

export function convertIPFStoHTTP(url: string) {
  return url.replace("ipfs://", "https://gateway.pinata.cloud/ipfs/");
}

export function toLegacyEvmAddress(publicKey: string) {
  const uncompressed =
    secp.ProjectivePoint.fromHex(publicKey).toRawBytes(false);
  const uncompressedHex = bytesToHex(uncompressed);
  return publicKeyToAddress(uncompressedHex);
}

export function hashAddress(address: string): Promise<string> {
  return sha256(address);
}
