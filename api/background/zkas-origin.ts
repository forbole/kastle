import { isAllowedZKasDappOrigin } from "@/lib/zkas/connection";

export function isTrustedZKasPageRequest(
  origin: string | undefined,
  sender: { id?: string; url?: string },
  extensionId: string,
): boolean {
  if (
    !origin ||
    !isAllowedZKasDappOrigin(origin) ||
    sender.id !== extensionId ||
    !sender.url
  ) {
    return false;
  }
  try {
    return new URL(sender.url).origin === origin;
  } catch {
    return false;
  }
}
