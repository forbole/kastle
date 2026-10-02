export const formatAmount = (n: number, max = 6) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: max })
    : "0";
