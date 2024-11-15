import { Method } from "@/lib/service/extension-service.ts";

export const sendMessage = <T>(method: Method, data = {}): Promise<T> =>
  browser.runtime.sendMessage({ method, ...data });

export function formatTokenPrice(number: number) {
  const hasLongDecimals = number.toString().split(".")[1]?.length > 8;

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: hasLongDecimals ? "scientific" : "standard",
    minimumFractionDigits: hasLongDecimals ? 2 : 0,
    maximumFractionDigits: hasLongDecimals ? 2 : 8,
  });

  return formatter.format(number);
}

export function formatUSD(number: number) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
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
