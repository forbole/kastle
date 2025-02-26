import { useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { useTokenInfo } from "@/hooks/useTokenInfo.ts";
import { useLocation } from "react-router";
import Header from "@/components/GeneralHeader.tsx";
import {
  Amount,
  applyDecimal,
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
import { Entry, PaymentOutput } from "@/lib/wallet/interface.ts";
import { FORBOLE_PAYOUT_ADDRESSES } from "@/lib/forbole.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { WalletSecret } from "@/types/WalletSecret.ts";
import { AccountFactory } from "@/lib/wallet/wallet-factory.ts";
import { Tooltip } from "react-tooltip";

export default function MintingToken() {
  const MIN_MINT_TIMES = 10;
  const navigate = useNavigate();
  const calledOnce = useRef(false);

  const { state } = useLocation();
  const { ticker, mintTimes } = state;
  const { data: tokenInfoResponse, mutate: updateTokenInfo } =
    useTokenInfo(ticker);
  const tokenInfo = tokenInfoResponse?.result?.[0];
  const { toFloat } = applyDecimal(tokenInfo?.dec);
  const mintAmount = toFloat(parseInt(tokenInfo?.lim ?? "0", 10));
  const [timesMinted, setTimesMinted] = useState(0);
  const isCanceled = useRef(false);
  const { totalFees } = computeOperationFees("mint", mintTimes);
  const { totalFees: paidFees } = computeOperationFees("mint", timesMinted);

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

    const broadcastOperation = async (includeForboleFees: boolean = false) => {
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

      const opData = { p: "krc-20", op: "mint", tick: ticker };
      const scriptBuilder = createKRC20ScriptBuilder(publicKey, opData);
      const scriptPublicKey = scriptBuilder.createPayToScriptHashScript();
      const P2SHAddress = addressFromScriptPublicKey(
        scriptPublicKey,
        networkId,
      );

      if (!P2SHAddress) {
        throw new Error("Invalid P2SH address");
      }

      await account.signAndBroadcastTx([
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

      const { krc20Fee, forboleFee } = computeOperationFees(
        opData.op as Operation,
      );

      const getForboleFees = (): PaymentOutput[] => {
        if (!includeForboleFees) {
          return [];
        }

        return [
          {
            address: FORBOLE_PAYOUT_ADDRESSES[networkId ?? NetworkType.Mainnet],
            amount: forboleFee.toString(),
          },
        ];
      };

      await account.signAndBroadcastTx(getForboleFees(), {
        priorityEntries: [entry],
        scripts: [
          {
            inputIndex: 0,
            scriptHex: scriptBuilder.toString(),
          },
        ],
        priorityFee: krc20Fee.toString(),
      });
    };

    const processMinting = async () => {
      let timesMintedLocal = 0;
      while (!isCanceled.current && timesMintedLocal < mintTimes) {
        try {
          await broadcastOperation(timesMintedLocal % MIN_MINT_TIMES === 0);
          await updateTokenInfo();
          setTimesMinted((prev) => prev + 1);
          timesMintedLocal++;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("already spent by transaction") &&
            error.message.includes("in the mempool")
          ) {
            // Waiting for previous mint operation to be cleared from the mempool
            await sleep(500);
          } else {
            isCanceled.current = true;
            return navigate(
              { pathname: "/token-operation-failed" },
              { state: { error, op: "mint" } },
            );
          }
        }
      }

      return navigate("/token-operation-success", {
        state: { ticker, op: "mint" },
      });
    };

    if (calledOnce.current) return;
    calledOnce.current = true;

    processMinting();
  }, [rpcClient, walletSettings, secret, accountFactory]);

  const progressPercentage = (timesMinted / mintTimes) * 100;
  const max = parseInt(tokenInfo?.max ?? "0", 10);
  const minted = parseInt(tokenInfo?.minted ?? "0", 10);
  const mintable = max - minted;

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-10 pb-12 pt-4 text-white">
        <Header
          title={`Minting ${ticker}`}
          showPrevious={false}
          showClose={false}
        />

        <div className="flex h-full flex-col gap-10">
          <img
            alt="castle"
            className="h-[120px] w-[299px] self-center"
            src={carriageImage}
          />

          <div className="bg-white/1 flex flex-col gap-8 rounded-lg border border-daintree-700 p-6">
            <div className="flex items-center gap-1 text-base font-semibold">
              <span>Minting</span>
              <i className="hn hn-check-circle text-[#14B8A6]"></i>
              <div className="flex">
                <span className="text-[#14B8A6]">
                  {mintAmount * timesMinted}
                </span>
                <span>{`/${mintAmount * mintTimes} ${ticker}`}</span>
              </div>
            </div>

            <div
              className="flex h-4 w-full overflow-hidden rounded-full bg-daintree-700"
              role="progressbar"
            >
              <div
                className="flex flex-col justify-center overflow-hidden whitespace-nowrap rounded-full bg-icy-blue-400 text-center text-xs text-white transition duration-500"
                style={{ width: `${progressPercentage}%` }}
              >
                {progressPercentage.toFixed(0)}%
              </div>
            </div>

            <div className="flex items-center gap-1 text-base">
              <i
                className="hn hn-info-circle text-[24px]"
                data-tooltip-id="info-tooltip"
                data-tooltip-content={`Fees are charged every 10 transactions (${mintAmount.toLocaleString()} ${ticker}). If you stop before reaching 10, the remaining fee will be charged at that time.`}
              ></i>
              <Tooltip
                id="info-tooltip"
                style={{
                  backgroundColor: "#374151",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "2px 8px",
                }}
              />
              <span>Fee Paid</span>
              <i className="hn hn-check-circle text-[#14B8A6]"></i>
              <div className="flex">
                <span className="text-[#14B8A6]">{paidFees}</span>
                <span>{`/${totalFees} KAS`}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 text-base">
            <i
              className="hn hn-info-circle text-[24px]"
              data-tooltip-id="info-tooltip"
              data-tooltip-content="This amount updates in real-time. The mintable amount may change before you finish minting."
            ></i>
            <Tooltip
              id="info-tooltip"
              style={{
                backgroundColor: "#374151",
                fontSize: "12px",
                fontWeight: 600,
                padding: "2px 8px",
              }}
            />
            <span>Currently Mintable</span>
            <span>
              {toFloat(mintable).toLocaleString()}/
              {toFloat(max).toLocaleString()}
            </span>
          </div>

          <div className="mt-auto flex flex-col items-center gap-2">
            <button
              onClick={() => (isCanceled.current = true)}
              className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
            >
              Cancel
            </button>
            <span className="text-daintree-400">You can cancel anytime</span>
          </div>
        </div>
      </div>
    </div>
  );
}
