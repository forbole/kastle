import { useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { useLocation } from "react-router";
import Header from "@/components/GeneralHeader.tsx";
import { deploy, ForboleFee } from "@/lib/krc20.ts";
import carriageImage from "@/assets/images/carriage.png";
import { kaspaToSompi } from "@/wasm/core/kaspa";
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

  const [step, setStep] = useState<string>();

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

      for await (const step of deploy(
        account,
        {
          tick: ticker,
          max: maxSupply.toString(),
          lim: mintAmount.toString(),
          pre: preAllocation ? preAllocation.toString() : "0",
          dec: decimalPlaces ? decimalPlaces.toString() : "8",
        },
        [
          {
            address: FORBOLE_PAYOUT_ADDRESSES[networkId ?? NetworkType.Mainnet],
            amount: kaspaToSompi(ForboleFee.Deploy.toString())!,
          },
        ],
      )) {
        setStep(step);
      }
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

        <div className="flex h-full flex-col items-center gap-4">
          <img
            alt="castle"
            className="h-[120px] w-[299px] self-center"
            src={carriageImage}
          />
          <span className="text-xl font-semibold capitalize text-daintree-400">
            {`${step}...`}
          </span>
        </div>
      </div>
    </div>
  );
}
