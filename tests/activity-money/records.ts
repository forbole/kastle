// The QA wallet's swap rows as the data layer recorded them on 2026-11-26.
import type { SwapActivityRecord } from "@/lib/activity/mappers";

export const PEPE_ID =
  "a73cdef004099b191759d320de970451be0e10423a7eb15b07d5e51d050b47cd";
export const KPEPE_ID =
  "6c5d77e7c094412389a07d1d4e96e079e24fc772a8c3e8fa3e134686da9f1a03";
const KASPLEX_CHAIN_ID = 202555;
const IGRA_CHAIN_ID = 38833;

const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).getTime();
const kcc20 = (txid: string, tokenId: string) => ({
  id: `kcc20:${txid}:0:${tokenId}`,
  txHash: txid,
  chainId: 1,
  tokenId,
  status: "completed" as const,
});

// A KaspaRocket sell of a token the wallet names (verified-list ticker) but no
// source scales — e.g. one no longer held: its amount is the unobserved sentinel.
export const GUZA_ID =
  "3cb7bd371ea2014af95f3471d2995ede8ffbde454d3a37e3b566880daf011c5a";
export const UNSCALED: SwapActivityRecord[] = [
  {
    ...kcc20("aa".repeat(32), GUZA_ID),
    timestampMs: at(2026, 11, 27, 9, 0),
    fromSymbol: "GUZA",
    toSymbol: "KAS",
    fromAmount: "0",
    toAmount: "1.5",
    providerId: "kasparocket",
  },
];

export const RECORDS: SwapActivityRecord[] = [
  {
    ...kcc20(
      "8263e13b2524df1d72d26040454d7ce9cfeb43ee8a29c9c5be18986b1bcd2a8b",
      PEPE_ID,
    ),
    timestampMs: at(2026, 11, 26, 14, 6),
    fromSymbol: "KAS",
    toSymbol: "PEPE",
    fromAmount: "2.364994",
    toAmount: "18922",
    providerId: "kron",
    feeAmount: "0.144994",
    feeSymbol: "KAS",
    kastleFeeAmount: "0.4",
    kastleFeeSymbol: "KAS",
  },
  {
    ...kcc20(
      "e095a11f124d2aabc67a859b4800b815a97a5a21066135bb68f4d89648586ce8",
      PEPE_ID,
    ),
    timestampMs: at(2026, 11, 26, 13, 17),
    fromSymbol: "KAS",
    toSymbol: "PEPE",
    fromAmount: "1.364992",
    toAmount: "8470",
    providerId: "kron",
    feeAmount: "0.144992",
    feeSymbol: "KAS",
    kastleFeeAmount: "0.4",
    kastleFeeSymbol: "KAS",
  },
  {
    id: "kasplex:0xk1ng",
    timestampMs: at(2026, 11, 25, 10, 21),
    fromSymbol: "WKAS",
    toSymbol: "KING",
    fromAmount: "5",
    toAmount: "2453.555",
    status: "completed",
    chainId: KASPLEX_CHAIN_ID,
  },
  {
    id: "igra:0x1gra",
    timestampMs: at(2026, 11, 23, 11, 31),
    fromSymbol: "IKAS",
    toSymbol: "IGRA",
    fromAmount: "3.5",
    toAmount: "43.5",
    status: "completed",
    chainId: IGRA_CHAIN_ID,
  },
  {
    ...kcc20(
      "d1de6236d75c9eaf53db01aa271efde831754c35886350c6c57990d38b89beac",
      KPEPE_ID,
    ),
    timestampMs: at(2026, 11, 9, 14, 50),
    fromSymbol: "KAS",
    toSymbol: "KPEPE",
    fromAmount: "10.25727163",
    toAmount: "77000",
    providerId: "kasseal",
    feeAmount: "0.049001",
    feeSymbol: "KAS",
  },
];

// Sheet-title cases (activity-money.spec.ts): an explorer KCC-20 row whose KAS
// leg is not yet read and whose token has no decimals carries both amounts "0",
// so only meta names the token.
const titleCase = (
  fromSymbol: string,
  toSymbol: string,
  fromAmount: string,
  toAmount: string,
): SwapActivityRecord[] => [
  {
    ...kcc20("bb".repeat(32), GUZA_ID),
    timestampMs: at(2026, 11, 27, 10, 0),
    fromSymbol,
    toSymbol,
    fromAmount,
    toAmount,
    providerId: "kasparocket",
  },
];
export const TITLE_CASES: Record<string, SwapActivityRecord[]> = {
  both: titleCase("KAS", "GUZA", "1.5", "42"),
  // A blank symbol (an EVM leg nothing indexed) is the only unnamed side.
  onlyTo: titleCase("", "GUZA", "0", "0"),
  onlyFrom: titleCase("GUZA", "", "0", "0"),
  // An unread KAS leg is still KAS.
  kasUnread: titleCase("GUZA", "KAS", "0", "0"),
  neither: titleCase("", "", "0", "0"),
};
