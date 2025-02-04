import React, { useState } from "react";
import { explorerApiBaseUrl } from "@/components/screens/Settings.tsx";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import KasHistoryItem from "@/components/kas-history/KasHistoryItem.tsx";

const pageSize = 20;

// TODO clean
export type TxType = {
  subnetwork_id: string;
  transaction_id: string;
  hash: string;
  mass: any;
  payload: string;
  block_hash: Array<string>;
  block_time: number;
  is_accepted: boolean;
  accepting_block_hash?: string;
  accepting_block_blue_score?: number;
  inputs: any;
  outputs: Array<{
    transaction_id: string;
    index: number;
    amount: number;
    script_public_key: string;
    script_public_key_address: string;
    script_public_key_type: string;
    accepting_block_hash: any;
  }>;
};

export default function KasHistory() {
  const [settings] = useSettings();
  const { addresses } = useWalletManager();
  const calledOnce = useRef(false);
  const [transactions, setTransactions] = useState<TxType[]>([]);

  const firstAddress = addresses[0];
  const network = settings?.networkId ?? NetworkType.Mainnet;
  const apiUrl = explorerApiBaseUrl[network];

  // TODO Improve
  const fetchTransactions = async () => {
    if (!firstAddress) {
      return;
    }

    const response = await fetch(
      `${apiUrl}/addresses/${firstAddress}/full-transactions?limit=${pageSize}&offset=0`,
    );
    const data = (await response.json()) as TxType[];

    setTransactions((prev) => [...prev, ...data]);
  };

  useEffect(() => {
    if (calledOnce.current) return;
    fetchTransactions();
    calledOnce.current = true;
  }, []);

  return (
    <div className="mt-4 flex flex-col items-stretch gap-2">
      {transactions.map((transaction) => (
        <KasHistoryItem
          key={transaction.transaction_id}
          transaction={transaction}
          address={firstAddress}
        />
      ))}
    </div>
  );
}
