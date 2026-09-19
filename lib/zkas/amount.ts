export const SOMPI_PER_ZKAS = 100_000_000n;
export const MAX_ZKAS_SOMPI = (1n << 64n) - 1n;

export function parseZkasAmount(value: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a positive ZKAS amount with at most 8 decimals");
  const sompi =
    BigInt(match[1]) * SOMPI_PER_ZKAS +
    BigInt((match[2] ?? "").padEnd(8, "0"));
  if (sompi <= 0n || sompi > MAX_ZKAS_SOMPI) {
    throw new Error("ZKAS amount is out of range");
  }
  return sompi;
}

export function formatZkasAmount(value: bigint): string {
  if (value < 0n || value > MAX_ZKAS_SOMPI) {
    throw new Error("ZKAS amount is out of range");
  }
  const whole = value / SOMPI_PER_ZKAS;
  const fractional = (value % SOMPI_PER_ZKAS)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

export function parseZkasSompi(value: unknown, label = "amount"): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid ZKas ${label}`);
  }
  const sompi = BigInt(value);
  if (sompi > MAX_ZKAS_SOMPI) throw new Error(`Invalid ZKas ${label}`);
  return sompi;
}
