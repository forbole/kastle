import {
  calculateTransactionMass,
  createTransaction,
  IPaymentOutput,
  IUtxoEntry,
} from "@/wasm/core/kaspa";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import useDeepCompareEffect from "use-deep-compare-effect";

export default function useMassCalculation(outputs: IPaymentOutput[]) {
  const { account } = useWalletManager();
  const { networkId, getUtxos } = useRpcClientStateful();
  const [mass, setMass] = useState(0n);

  useDeepCompareEffect(() => {
    if (!account?.address) return;

    const calculateMass = async () => {
      const amountSum = outputs.reduce(
        (acc, curr) => acc + (curr.amount ?? 0n),
        0n,
      );

      const entries = await getUtxos([account.address]);
      const selected: IUtxoEntry[] = [];
      let selectedSum = 0n;

      for (const entry of entries) {
        selected.push(entry);
        selectedSum += entry.amount;

        if (selectedSum > amountSum) {
          break;
        }
      }

      const transaction = createTransaction(selected, outputs, 0n);

      const mass = calculateTransactionMass(
        networkId ?? NetworkType.Mainnet,
        transaction,
      );

      setMass(mass);
    };

    calculateMass();
  }, [outputs]);

  return mass;
}
