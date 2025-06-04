import React, { useEffect, useState } from "react";
import useKeyring from "@/hooks/useKeyring";
import useWalletManager from "@/hooks/useWalletManager";
import { AccountFactory as EthAccountFactory } from "@/lib/ethereum/wallet/account-factory";
import { IWallet as EthWallet } from "@/lib/ethereum/wallet/wallet-interface";
import { IWallet as KasWallet } from "@/lib/wallet/wallet-interface";
import SendTransaction from "./SendTransaction";
import Splash from "@/components/screens/Splash";
import { useSettings } from "@/hooks/useSettings";
import { kasplexTestnet } from "@/lib/layer2";
import useRpcClient from "@/hooks/useRpcClientStateful";
import { AccountFactory as KasAccountFactory } from "@/lib/wallet/wallet-factory";
import SendKasplexL2Transaction from "./SendKasplexL2Transaction";

export default function HotWalletSendTransaction() {
  const { getWalletSecret } = useKeyring();
  const { wallet: walletInfo, account } = useWalletManager();
  const [ethSigner, setEthSigner] = useState<EthWallet | null>(null);
  const { rpcClient, networkId } = useRpcClient();
  const [kasSigner, setKasSigner] = useState<KasWallet | null>(null);
  const [settings] = useSettings();
  const callOnce = React.useRef(false);

  useEffect(() => {
    if (!walletInfo || !account || !networkId || !rpcClient) {
      return;
    }

    const init = async () => {
      const { walletSecret } = await getWalletSecret({
        walletId: walletInfo.id,
      });

      const kasAccountFactory = new KasAccountFactory(rpcClient, networkId);

      switch (walletInfo.type) {
        case "mnemonic":
          setEthSigner(
            EthAccountFactory.createFromMnemonic(
              walletSecret.value,
              account.index,
            ),
          );
          setKasSigner(
            kasAccountFactory.createFromMnemonic(
              walletSecret.value,
              account.index,
            ),
          );
          break;
        case "privateKey":
          setEthSigner(
            EthAccountFactory.createFromPrivateKey(walletSecret.value),
          );
          setKasSigner(
            kasAccountFactory.createFromPrivateKey(walletSecret.value),
          );
          break;
      }
    };

    if (callOnce.current) {
      return;
    }
    init();
    callOnce.current = true;
  }, [getWalletSecret]);

  const isKasplexLayer2 =
    settings?.evmL2ChainId?.[settings.networkId] === kasplexTestnet.id;

  const isLoading = !ethSigner || !kasSigner;
  return (
    <>
      {isLoading && <Splash />}
      {!isLoading && !isKasplexLayer2 && <SendTransaction signer={ethSigner} />}
      {!isLoading && isKasplexLayer2 && (
        <SendKasplexL2Transaction ethSigner={ethSigner} kasSigner={kasSigner} />
      )}
    </>
  );
}
