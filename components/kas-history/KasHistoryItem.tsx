import { TxType } from "@/components/kas-history/KasHistory.tsx";
import kasIcon from "@/assets/images/kas-icon.svg";
import { formatUSD } from "@/lib/utils.ts";
import React from "react";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { explorerBaseUrl } from "@/components/screens/Settings.tsx";
import { sompiToKaspaString } from "@/wasm/core/kaspa";

type KasHistoryItemProps = { transaction: TxType; address: string };

export default function KasHistoryItem({
  transaction,
  address,
}: KasHistoryItemProps) {
  const [settings] = useSettings();
  const kaspaPrice = useKaspaPrice();
  const network = settings?.networkId ?? NetworkType.Mainnet;
  const explorerUrl = explorerBaseUrl[network];

  const balance = transaction.outputs.reduce(
    (acc, curr) =>
      curr.script_public_key_address !== address
        ? acc - curr.amount
        : acc + curr.amount,
    0,
  );

  return (
    <div className="flex cursor-pointer flex-col items-stretch gap-2">
      <div className="flex items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
        <img alt="castle" className="h-[40px] w-[40px]" src={kasIcon} />
        <div className="flex flex-grow flex-col gap-1">
          <div className="flex items-center justify-between text-base text-white">
            <span>KAS</span>
            <span>{sompiToKaspaString(balance)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-daintree-400">
            <a
              href={`${explorerUrl}/txs/${transaction.transaction_id}`}
              target="_blank"
              rel="noreferrer"
            >
              {transaction.transaction_id.slice(0, 8)}...{" "}
              <i className="hn hn-external-link text-[12px]"></i>
            </a>
            <span>≈ {formatUSD(balance * kaspaPrice.kaspaPrice)} USD</span>
          </div>
        </div>
      </div>
    </div>
  );
}
