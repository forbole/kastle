import { Method } from "@/lib/service/extension-service.ts";

export const isProduction = process.env.NODE_ENV === "production";

export const fetcher = (url: string) => fetch(url).then((r) => r.json());
export const emptyFetcher = (_: string) => Promise.resolve(undefined);

export const multiFetcher = (urls: string[]) =>
  Promise.all(urls.map((url) => fetcher(url)));

export const POPUP_WINDOW_WIDTH = 375;
export const POPUP_WINDOW_HEIGHT = 600;

export const sendMessage = <T>(method: Method, data = {}): Promise<T> =>
  browser.runtime.sendMessage({ method, ...data });

export function formatTokenPrice(number: number) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "standard",
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });

  return formatter.format(number);
}

export function formatCurrency(number: number, code: string = "USD") {
  const mappings: Record<string, "narrowSymbol" | "symbol" | "code" | "name"> =
    {
      CNY: "narrowSymbol",
      EUR: "symbol",
      HKD: "symbol",
      JPY: "narrowSymbol",
      RUB: "narrowSymbol",
      TWD: "symbol",
      USD: "symbol",
    } as const;

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    currencyDisplay: mappings[code] ?? "symbol",
  });

  return formatter.format(number);
}

export function formatToken(
  number: number,
  maximumFractionDigits: number = 20,
) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "decimal",
    notation: "standard",
    maximumFractionDigits,
  });

  return formatter.format(number);
}

export function walletAddressEllipsis(address: string) {
  const start = address.substring(0, 8);
  const end = address.substring(address.length - 5, address.length);

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
