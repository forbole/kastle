export function isTrustedZKasPageMessage(
  source: MessageEventSource | null,
  origin: string,
  pageWindow: Window,
): boolean {
  return source === pageWindow && origin === pageWindow.location.origin;
}
