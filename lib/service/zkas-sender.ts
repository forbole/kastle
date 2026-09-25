export function isTrustedZKasSender(
  sender: { id?: string; url?: string },
  extensionId: string,
  extensionUrl: string,
): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  try {
    const source = new URL(sender.url);
    const extension = new URL(extensionUrl);
    return (
      source.protocol === extension.protocol && source.host === extension.host
    );
  } catch {
    return false;
  }
}
