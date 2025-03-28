import {
  calculateTransactionMass,
  createTransaction,
  IUtxoEntry,
} from "@/wasm/core/kaspa";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { useEffect } from "react";

export default function useMassCalculation(amount: bigint, address?: string) {
  const { account } = useWalletManager();
  const { networkId, getUtxos } = useRpcClientStateful();
  const [mass, setMass] = useState(0n);

  useEffect(() => {
    const calculateMass = async () => {
      if (!address || !account?.address) return;

      const entries = await getUtxos([account.address]);
      const selected: IUtxoEntry[] = [];
      let selectedSum = 0n;

      for (const entry of entries) {
        selected.push(entry);
        selectedSum += entry.amount;

        if (selectedSum > amount) {
          break;
        }
      }

      const transaction = createTransaction(
        selected,
        [{ address, amount }],
        0n,
      );

      const mass = calculateTransactionMass(
        networkId ?? NetworkType.Mainnet,
        transaction,
      );

      setMass(mass);
    };

    calculateMass();
  }, [address, amount]);

  return mass;
}
