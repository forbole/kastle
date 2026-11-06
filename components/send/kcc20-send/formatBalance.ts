import { formatUnits } from "viem";

// Exact base units → "1,234.000000000000000001"; a float would drop digits.
export const formatBalance = (units: bigint, decimals: number) => {
  const [int, frac] = formatUnits(units, decimals).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
};
