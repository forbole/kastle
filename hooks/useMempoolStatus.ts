import { useEffect } from "react";

export default function useMempoolStatus() {
  const [pendingTransactionsNumber, setPendingTransactionsNumber] = useState(0);
  const { rpcClient, isConnected } = useRpcClientStateful();

  useEffect(() => {
    const fetchMempoolStatus = async () => {
      if (!isConnected || !rpcClient) return;

      const { mempoolEntries } = await rpcClient.getMempoolEntries({
        includeOrphanPool: false,
        filterTransactionPool: false,
      });

      setPendingTransactionsNumber(mempoolEntries.length);
    };

    fetchMempoolStatus();
  }, [rpcClient, isConnected]);

  const evaluateMempoolCongestion = () => {
    if (pendingTransactionsNumber < 5000) {
      return "low";
    }
    if (pendingTransactionsNumber < 10000) {
      return "medium";
    }
    return "high";
  };

  return {
    pendingTransactionsNumber,
    mempoolCongestionLevel: evaluateMempoolCongestion(),
  };
}
