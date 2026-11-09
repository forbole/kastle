// Stubs for the swap sheet harness: storage-backed state is plain React
// state, and the settings context only lends its network enum.
import { useState } from "react";

export default function useStorageState<T>(_key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const set = async (next: T | ((prev: T) => T)) => setValue(next as T);
  return [value, set, false] as const;
}
export const NetworkType = { Mainnet: "mainnet", TestnetT10: "testnet-10" };
