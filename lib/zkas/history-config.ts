import type { Settings } from "@/contexts/SettingsContext";

export const ZKAS_MAINNET_GENESIS =
  "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f";

function canonicalHistoryOrigin(value: string): string {
  if (typeof value !== "string" || value.length > 256) {
    throw new Error("Invalid configured history origin");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid configured history origin");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const port = Number(url.port);
  if (
    value !== url.origin ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        loopback &&
        /^[1-9][0-9]{0,4}$/.test(url.port) &&
        port <= 65535 &&
        port !== 80)
    )
  ) {
    throw new Error("Invalid configured history origin");
  }
  return value;
}

export function requireHistoryIndexOrigin(settings: Settings): string {
  const value = settings.zkasHistoryIndexUrls?.mainnet;
  if (!value) throw new Error("Configure a history index in Kastle first");
  return canonicalHistoryIndexOrigin(value);
}

export function canonicalHistoryIndexOrigin(value: string): string {
  return canonicalHistoryOrigin(value);
}

export function canonicalHistoryDaemonOrigin(value: string): string {
  return canonicalHistoryOrigin(value);
}

export function historyIndexHostPattern(value: string): string {
  const url = new URL(canonicalHistoryOrigin(value));
  return `${url.protocol}//${url.hostname}/*`;
}

export function assertHistoryGenesis(value: string): void {
  if (value !== ZKAS_MAINNET_GENESIS) {
    throw new Error("History network genesis changed");
  }
}
