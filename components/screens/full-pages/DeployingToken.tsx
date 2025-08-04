import { useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { useLocation } from "react-router";
import Header from "@/components/GeneralHeader.tsx";
import { deploy, ForboleFee } from "@/lib/krc20.ts";
import carriageImage from "@/assets/images/carriage.png";
import { FORBOLE_PAYOUT_ADDRESSES } from "@/lib/forbole.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { DeployTokenState } from "@/components/screens/full-pages/DeployToken.tsx";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";

export default function DeployingToken() {
  const navigate = useNavigate();
  const calledOnce = useRef(false);

  const { state } = useLocation();
  const { ticker, maxSupply, mintAmount, preAllocation, decimalPlaces } =
    state as DeployTokenState;

  const { rpcClient, networkId = NetworkType.Mainnet } = useRpcClientStateful();
  const walletSigner = useKaspaHotWalletSigner();

  const [step, setStep] = useState<string>();

  useEffect(() => {
    if (!rpcClient || !walletSigner) return;

    const broadcastOperation = async () => {
      for await (const result of await deploy(
        walletSigner,
        rpcClient,
        networkId,
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
            amount: ForboleFee.Deploy.toString(),
          },
        ],
      )) {
        setStep(result.status);
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
  }, [rpcClient, walletSigner]);

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-10 pb-12 pt-4 text-white">
        <Header
          title={`Deploying ${ticker}`}
          showPrevious={false}
          showClose={false}
        />

        <div className="mt-10 flex h-full flex-col items-center gap-4">
          <img
            alt="castle"
            className="h-[120px] w-[299px] self-center"
            src={carriageImage}
          />
          <span className="text-xl font-semibold capitalize text-daintree-400">
            {`${step} TX...`}
          </span>
        </div>
      </div>
    </div>
  );
}
