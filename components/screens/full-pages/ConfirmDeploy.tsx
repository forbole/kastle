import Header from "@/components/GeneralHeader.tsx";
import { Tooltip } from "react-tooltip";
import React from "react";
import { formatCurrency } from "@/lib/utils.ts";
import { applyDecimal, computeOperationFees } from "@/lib/krc20.ts";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router";
import signImage from "@/assets/images/sign.png";
import { DeployTokenState } from "@/components/screens/full-pages/DeployToken.tsx";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";

export default function ConfirmDeploy() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { ticker, maxSupply, mintAmount, preAllocation, decimalPlaces } =
    state as DeployTokenState;
  const kaspaPrice = useKaspaPrice();
  const { toFloat } = applyDecimal(decimalPlaces.toString());
  const { krc20Fee, kaspaFee, forboleFee, totalFees } =
    computeOperationFees("deploy");

  const fiatFees = totalFees * kaspaPrice.kaspaPrice;
  const { amount: feesCurrency, code: feesCurrencyCode } =
    useCurrencyValue(fiatFees);

  const onBack = () =>
    navigate(
      {
        pathname: "/deploy-token",
      },
      { state },
    );

  const onClose = () => window.close();
  const onNext = () => navigate({ pathname: "/deploying-token" }, { state });

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-10 pb-12 pt-4 text-white">
        <Header
          title="Confirm"
          onClose={onClose}
          onBack={onBack}
          showPrevious={!!onBack}
        />

        <div className="flex h-full flex-col gap-2">
          <img
            alt="castle"
            className="h-[120px] w-[134px] self-center"
            src={signImage}
          />

          <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Ticker</span>
                <span className="font-medium">{ticker}</span>
              </div>
            </li>
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Maximum Supply</span>
                <span className="font-medium">{toFloat(maxSupply)}</span>
              </div>
            </li>
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Default Mint Amount</span>
                <span className="font-medium">{toFloat(mintAmount)}</span>
              </div>
            </li>
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Preallocation</span>
                <span className="font-medium">{toFloat(preAllocation)}</span>
              </div>
            </li>
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Fee</span>
                  <i
                    className="hn hn-info-circle text-lg"
                    data-tooltip-id="info-tooltip"
                    data-tooltip-content={
                      forboleFee > 0
                        ? `${krc20Fee} KAS for KRC20 fees, ${kaspaFee} KAS for Kaspa network fees and ${forboleFee} KAS for Kastle fees.`
                        : `${krc20Fee} KAS for KRC20 fees and ${kaspaFee} KAS for Kaspa network fees.`
                    }
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
                </div>
                <div className="flex flex-col text-right">
                  <span className="font-medium">{totalFees} KAS</span>
                  <span className="text-xs text-daintree-400">
                    {formatCurrency(feesCurrency, feesCurrencyCode)}
                  </span>
                </div>
              </div>
            </li>
          </ul>

          <div className="mt-auto">
            <button
              onClick={onNext}
              className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
