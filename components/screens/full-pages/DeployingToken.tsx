import { useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { useLocation } from "react-router";
import Header from "@/components/GeneralHeader.tsx";
import {
  Amount,
  computeOperationFees,
  createKRC20ScriptBuilder,
  Operation,
} from "@/lib/krc20.ts";
import carriageImage from "@/assets/images/carriage.png";
import {
  addressFromScriptPublicKey,
  sompiToKaspaString,
  UtxoEntryReference,
} from "@/wasm/core/kaspa";
import { sleep } from "@/lib/utils.ts";
import { Entry } from "@/lib/wallet/interface.ts";
import { FORBOLE_PAYOUT_ADDRESSES } from "@/lib/forbole.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { WalletSecret } from "@/types/WalletSecret.ts";
import { AccountFactory } from "@/lib/wallet/wallet-factory.ts";
import { DeployTokenState } from "@/components/screens/full-pages/DeployToken.tsx";

export default function DeployingToken() {
  const navigate = useNavigate();
  const calledOnce = useRef(false);

  const { state } = useLocation();
  const { ticker, maxSupply, mintAmount, preAllocation, decimalPlaces } =
    state as DeployTokenState;

  const { rpcClient, networkId = NetworkType.Mainnet } = useRpcClientStateful();
  const [secret, setSecret] = useState<WalletSecret>();
  const { getWalletSecret } = useKeyring();
  const { walletSettings } = useWalletManager();

  useEffect(() => {
    if (!walletSettings?.selectedWalletId) {
      return;
    }

    getWalletSecret({
      walletId: walletSettings.selectedWalletId,
    }).then(({ walletSecret }) => setSecret(walletSecret));
  }, [walletSettings]);

  const accountFactory = !rpcClient
    ? undefined
    : new AccountFactory(rpcClient, networkId);

  useEffect(() => {
    if (
      !rpcClient ||
      walletSettings?.selectedAccountIndex === undefined ||
      walletSettings?.selectedAccountIndex === null ||
      !secret ||
      !accountFactory
    )
      return;

    const broadcastOperation = async () => {
      const account =
        secret.type === "mnemonic"
          ? accountFactory.createFromMnemonic(
              secret.value,
              walletSettings.selectedAccountIndex,
            )
          : accountFactory.createFromPrivateKey(secret.value);

      const publicKey = (await account.getPublicKeys())[0];

      if (!publicKey) {
        throw new Error("No available public keys");
      }

      const opData: Record<string, string> = {
        p: "krc-20",
        op: "deploy",
        tick: ticker,
        max: maxSupply.toString(),
        lim: mintAmount.toString(),
      };
      if (decimalPlaces) {
        opData.dec = decimalPlaces.toString();
      }
      if (preAllocation) {
        opData.pre = preAllocation.toString();
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

      const commit = await account.signAndBroadcastTx([
        { amount: Amount.ScriptUtxoAmount, address: P2SHAddress.toString() },
      ]);

      console.log(commit);
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

      const { krc20Fee, forboleFee } = computeOperationFees(
        opData.op as Operation,
      );

      const reveal = await account.signAndBroadcastTx(
        [
          {
            address: FORBOLE_PAYOUT_ADDRESSES[networkId ?? NetworkType.Mainnet],
            amount: forboleFee.toString(),
          },
        ],
        {
          priorityEntries: [entry],
          scripts: [
            {
              inputIndex: 0,
              scriptHex: scriptBuilder.toString(),
            },
          ],
          priorityFee: krc20Fee.toString(),
        },
      );
      console.log(reveal);
    };

    if (calledOnce.current) return;
    calledOnce.current = true;

    broadcastOperation()
      .then(() => {
        navigate(
          { pathname: "/token-operation-success" },
          { state: { ticker, op: "deploy" } },
        );
      })
      .catch((error) =>
        navigate(
          { pathname: "/token-operation-failed" },
          { state: { error, op: "deploy" } },
        ),
      );
  }, [rpcClient, walletSettings, secret, accountFactory]);

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-10 pb-12 pt-4 text-white">
        <Header
          title={`Deploying ${ticker}`}
          showPrevious={false}
          showClose={false}
        />

        <div className="flex h-full flex-col gap-10">
          <img
            alt="castle"
            className="h-[120px] w-[299px] self-center"
            src={carriageImage}
          />
        </div>
      </div>
    </div>
  );
}
