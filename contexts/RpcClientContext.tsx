import { createContext, ReactNode, useState } from "react";
import {
  Address,
  Encoding,
  Generator,
  IUtxoEntry,
  kaspaToSompi,
  Resolver,
  RpcClient,
  sompiToKaspaString,
  UtxoEntryReference,
} from "@/wasm/core/kaspa";
import { PaymentOutput } from "@/lib/wallet/interface.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import Splash from "@/components/screens/Splash.tsx";

interface RpcClientContextType {
  rpcClient: RpcClient | undefined;
  networkId?: NetworkType;
  isConnected: boolean;
  getMinimumFee: (addresses: string[]) => Promise<number>;
  getUtxos: (addresses: string[]) => Promise<UtxoEntryReference[]>;
  estimateTransactionFees: (
    entries: IUtxoEntry[],
    outputs: PaymentOutput[],
    changeAddress: string,
  ) => Promise<{
    totalFees: string;
    numberOfTransactions: number;
    numberOfUtxos: number;
    finalAmount: string;
  }>;
}

const defaultFunction = () => Promise.reject("RPC client not initialized");

export const RpcClientContext = createContext<RpcClientContextType>({
  rpcClient: undefined,
  isConnected: false,
  getMinimumFee: defaultFunction,
  getUtxos: defaultFunction,
  estimateTransactionFees: defaultFunction,
});

export function RpcClientProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [settings] = useSettings();
  const [rpcClient, setRpcClient] = useState<RpcClient>();
  const [networkId, setNetworkId] = useState<NetworkType>();
  const [rpcUrl, setRpcUrl] = useState<string>();

  useEffect(() => {
    const establishConnection = async () => {
      if (!rpcUrl || !networkId) {
        return;
      }
      const newRpcClient = new RpcClient({
        url: rpcUrl,
        resolver: rpcUrl ? undefined : new Resolver(),
        encoding: Encoding.Borsh,
        networkId: networkId,
      });

      try {
        await newRpcClient.connect();
        if (!(await newRpcClient.getServerInfo()).isSynced) {
          throw new Error("Please wait for the node to sync");
        }

        setRpcClient(newRpcClient);
        setIsConnected(true);
      } catch (e) {
        await newRpcClient.disconnect();
        await newRpcClient.stop();
        throw new Error("Failed to handle the rpcClient operation: " + e);
      }
    };

    const terminateConnection = async () => {
      setIsConnected(false);
      setRpcClient(undefined);

      await rpcClient?.disconnect();
      await rpcClient?.stop();
    };

    establishConnection();

    return () => {
      terminateConnection();
    };
  }, [rpcUrl, networkId]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    if (!networkId || settings.networkId !== networkId) {
      setNetworkId(settings.networkId);
    }

    const newRpcUrl = settings.rpcUrls[settings.networkId];
    if (!rpcUrl || newRpcUrl !== rpcUrl) {
      setRpcUrl(newRpcUrl);
    }
  }, [settings]);

  const getMinimumFee = async (addresses: string[]) => {
    if (!rpcClient) {
      throw new Error("RPC client not initialized");
    }

    // Credits to https://github.com/coderofstuff/kasvault/blob/eb071744fc128da340966d5eb023b01a4a2c9448/src/lib/ledger.ts#L86
    const utxos =
      (await rpcClient?.getUtxosByAddresses(addresses))?.entries ?? [];
    const minimumFee = 239 + 690;

    return parseFloat(
      sompiToKaspaString(BigInt(minimumFee + utxos.length * 1118)),
    );
  };

  const getUtxos = async (addresses: string[]) => {
    if (!rpcClient) {
      throw new Error("RPC client not initialized");
    }

    return (await rpcClient.getUtxosByAddresses(addresses)).entries;
  };

  const estimateTransactionFees = async (
    entries: IUtxoEntry[],
    outputs: PaymentOutput[],
    changeAddress: string,
  ) => {
    if (!settings) {
      throw new Error("Settings not loaded");
    }

    outputs.forEach((output) => {
      if (!Address.validate(output.address)) {
        throw new Error("Invalid receiver address " + output.address);
      }
    });

    try {
      const kaspaOutputs = outputs.map((output) => ({
        address: output.address,
        amount: kaspaToSompi(output.amount) ?? 0n,
      }));

      let amountSum = kaspaOutputs.reduce(
        (acc, curr) => acc + (curr.amount ?? 0n),
        0n,
      );

      // select utxos
      const selected: IUtxoEntry[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (amountSum <= 0n) {
          break;
        }

        selected.push(entries[i]);
        amountSum -= entries[i].amount;
      }

      const txGenerator = new Generator({
        entries: selected,
        outputs: kaspaOutputs,
        priorityFee: 0n,
        changeAddress: changeAddress,
        networkId: settings.networkId,
      });

      const summary = await txGenerator.estimate();

      return {
        totalFees: sompiToKaspaString(summary.fees),
        numberOfTransactions: summary.transactions,
        numberOfUtxos: summary.utxos,
        finalAmount: sompiToKaspaString(summary.finalAmount ?? 0n),
      };
    } catch (error) {
      throw new Error(`Failed to estimate transaction fees: ${error}`);
    }
  };

  if (!isConnected) {
    return <Splash />;
  }

  return (
    <RpcClientContext.Provider
      value={{
        rpcClient,
        networkId,
        isConnected,
        getMinimumFee,
        getUtxos,
        estimateTransactionFees,
      }}
    >
      {children}
    </RpcClientContext.Provider>
  );
}
