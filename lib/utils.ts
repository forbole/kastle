import { Method } from "@/lib/service/extension-service.ts";
import { CURRENCIES } from "@/contexts/SettingsContext.tsx";
import * as secp from "@noble/secp256k1";
import { bytesToHex } from "viem";
import { publicKeyToAddress } from "viem/accounts";

export const isProduction = process.env.NODE_ENV === "production";

export const fetcher = (url: string) => fetch(url).then((r) => r.json());
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

export function convertIPFStoHTTP(url: string) {
  return url.replace("ipfs://", "https://ipfs.io/ipfs/");
}

export function toLegacyEvmAddress(publicKey: string) {
  const uncompressed =
    secp.ProjectivePoint.fromHex(publicKey).toRawBytes(false);
  const uncompressedHex = bytesToHex(uncompressed);
  return publicKeyToAddress(uncompressedHex);
}
