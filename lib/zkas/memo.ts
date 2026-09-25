export const MAX_ZKAS_MEMO_BYTES = 512;

export function validateZKasMemo(memo?: string): string | undefined {
  if (memo === undefined || memo === "") return undefined;
  if (typeof memo !== "string") throw new Error("Invalid ZKas memo");
  const bytes = new TextEncoder().encode(memo);
  if (new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) !== memo) {
    throw new Error("ZKas memo contains invalid Unicode");
  }
  if (bytes.length > MAX_ZKAS_MEMO_BYTES) {
    throw new Error("ZKas memo must be at most 512 UTF-8 bytes");
  }
  return memo;
}
