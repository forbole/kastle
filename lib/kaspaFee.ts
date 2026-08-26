const SIGNATURE_SIZE = 66n;

export function calcRevealInputMass(scriptHex: string): bigint {
  const N = BigInt(scriptHex.length / 2);
  const pushPrefixLen = N > 75n ? 2n : 1n;
  const sigScriptLen = SIGNATURE_SIZE + pushPrefixLen + N;
  return 52n + sigScriptLen;
}

export function calcRevealInputFee(scriptHex: string): bigint {
  return calcRevealInputMass(scriptHex) * 100n;
}
