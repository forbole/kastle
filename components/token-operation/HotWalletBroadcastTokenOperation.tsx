import { LoadingStatus } from "@/components/send/LoadingStatus";
import { WalletSecret } from "@/types/WalletSecret";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import {
  addressFromScriptPublicKey,
  sompiToKaspaString,
  UtxoEntryReference,
} from "@/wasm/core/kaspa";
import { useFormContext } from "react-hook-form";
import { TokenOperationFormData } from "@/components/screens/TokenOperation.tsx";
import { useEffect } from "react";
import { sleep } from "@/lib/utils.ts";
import {
  Amount,
  createKRC20ScriptBuilder,
  FORBOLE_FEES,
  OP_FEES,
  OpFeesKey,
  OpForboleFeesKey,
} from "@/lib/krc20.ts";
import { captureException } from "@sentry/react";
import { Entry, PaymentOutput } from "@/lib/wallet/interface.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { FORBOLE_PAYOUT_ADDRESS } from "@/lib/forbole.ts";
import { MIN_KAS_AMOUNT } from "@/lib/kaspa.ts";

type HotWalletSendingProps = {
  accountFactory: AccountFactory;
  secret: WalletSecret;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
};

export default function HotWalletBroadcastTokenOperation({
  accountFactory,
  secret,
  setOutTxs,
  onFail,
  onSuccess,
}: HotWalletSendingProps) {
  const { rpcClient, networkId } = useRpcClientStateful();
  const { watch } = useFormContext<TokenOperationFormData>();
  const calledOnce = useRef(false);
  const opData = watch("opData");
  const { walletSettings } = useWalletManager();

  const broadcastOperation = async () => {
    try {
      if (!rpcClient) {
        throw new Error("No RPC Client found.");
      }

      if (!networkId) {
        throw new Error("No network selected");
      }

      const accountIndex = walletSettings?.selectedAccountIndex;
      if (accountIndex === null || accountIndex === undefined) {
        throw new Error("No account selected");
      }

      const account =
        secret.type === "mnemonic"
          ? accountFactory.createFromMnemonic(secret.value, accountIndex)
          : accountFactory.createFromPrivateKey(secret.value);

      const publicKey = (await account.getPublicKeys())[0];

      if (!publicKey) {
        throw new Error("No available public keys");
      }

      const scriptBuilder = createKRC20ScriptBuilder(publicKey, opData);
      const scriptPublicKey = scriptBuilder.createPayToScriptHashScript();
      const P2SHAddress = addressFromScriptPublicKey(
        scriptPublicKey,
        networkId,
      );

      if (!P2SHAddress) {
        throw new Error("Invalid P2SH address");
      }

      const commitTxId = await account.signAndBroadcastTx([
        { amount: Amount.ScriptUtxoAmount, address: P2SHAddress.toString() },
      ]);

      let P2SHEntry: UtxoEntryReference | undefined;
      while (!P2SHEntry) {
        const P2SHUTXOs = await rpcClient.getUtxosByAddresses([
          P2SHAddress.toString(),
        ]);

        if (P2SHUTXOs.entries.length === 0) {
          await sleep(1000);
        } else {
          P2SHEntry = P2SHUTXOs.entries[0];
        }
      }

      if (!P2SHEntry.address) {
        throw new Error("Invalid P2SH entry");
      }

      const entry = {
        address: P2SHEntry.address.toString(),
        amount: sompiToKaspaString(P2SHEntry.amount),
        scriptPublicKey: JSON.parse(P2SHEntry.scriptPublicKey.toString()),
        blockDaaScore: P2SHEntry.blockDaaScore.toString(),
        outpoint: JSON.parse(P2SHEntry.outpoint.toString()),
      } satisfies Entry;

      const getForboleFees = (): PaymentOutput[] => {
        if (networkId !== NetworkType.Mainnet) {
          return [];
        }

        const forbolefee = FORBOLE_FEES[opData.op as OpForboleFeesKey];

        if (forbolefee < MIN_KAS_AMOUNT) {
          return [];
        }

        return [
          {
            address: FORBOLE_PAYOUT_ADDRESS,
            amount: forbolefee.toString(),
          },
        ];
      };

      const revealTxId = await account.signAndBroadcastTx(getForboleFees(), {
        priorityEntries: [entry],
        scripts: [
          {
            inputIndex: 0,
            scriptHex: scriptBuilder.toString(),
          },
        ],
        priorityFee: OP_FEES[opData.op as OpFeesKey].toString(),
      });

      setOutTxs([commitTxId, revealTxId]);
      onSuccess();
    } catch (e) {
      captureException(e);
      console.error(e);
      onFail();
    }
  };

  useEffect(() => {
    if (calledOnce.current) return;
    broadcastOperation();
    calledOnce.current = true;
  }, []);

  return <LoadingStatus />;
}
