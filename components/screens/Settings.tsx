import React, { useState } from "react";
import { SettingItem } from "@/components/SettingItem";
import { useSettings } from "@/hooks/useSettings";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { twMerge } from "tailwind-merge";
import Header from "@/components/GeneralHeader";
import { useNavigate } from "react-router-dom";
import telegram from "@/assets/images/telegram.svg";
import x from "@/assets/images/x.svg";
import github from "@/assets/images/github.svg";

import packageJson from "../../package.json";

export const explorerTxLinks = {
  [NetworkType.Mainnet]: "https://kas.fyi/transaction/",
  [NetworkType.TestnetT10]: "https://explorer-tn10.kaspa.org/txs/",
};

export const explorerAddressLinks = {
  [NetworkType.Mainnet]: "https://kas.fyi/address/",
  [NetworkType.TestnetT10]: "https://explorer-tn10.kaspa.org/addresses/",
};

export default function Settings() {
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [lockAfterDropdownOpen, setLockAfterDropdownOpen] = useState(false);
  const [settings, setSettings] = useSettings();
  const navigate = useNavigate();

  const lockAfterOptions = [
    { name: "1 minute", value: 1 },
    { name: "5 minutes", value: 5 },
    { name: "10 minutes", value: 10 },
    { name: "30 minutes", value: 30 },
    { name: "1 hour", value: 60 },
  ];
  const selectedLockAfter = lockAfterOptions.find(
    (o) => o.value === settings?.lockTimeout,
  );
  const changeLockAfter = async (value: number) => {
    await setSettings((prev) => ({ ...prev, lockTimeout: value }));
  };

  const networks = [
    {
      id: NetworkType.Mainnet,
      name: "Mainnet",
      text: "text-teal-500",
      iconColor: "bg-teal-500",
    },
    {
      id: NetworkType.TestnetT10,
      name: "Testnet T10",
      text: "text-yellow-500",
      iconColor: "bg-yellow-500",
    },
  ];
  const selectedNetwork = networks.find((n) => n.id === settings?.networkId);

  const changeNetwork = async (networkId: NetworkType) => {
    await setSettings((prev) => ({ ...prev, networkId }));
  };

  return (
    <div className="relative flex h-full flex-col p-6">
      {/* Header */}
      <Header
        title="Settings"
        showPrevious={false}
        onClose={() => navigate("/dashboard")}
      />

      {/* Settings List */}
      <div className="flex flex-col gap-3">
        {/* Auto lock after */}
        <SettingItem
          title="Auto lock after"
          onClick={() => setLockAfterDropdownOpen(!lockAfterDropdownOpen)}
        >
          <button className="font-semibold text-[#3c73ff]">
            {selectedLockAfter?.name}
          </button>
        </SettingItem>
        <>
          <div
            className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
              lockAfterDropdownOpen
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            onClick={() => setLockAfterDropdownOpen(false)}
          />
          <div
            className={twMerge(
              "no-scrollbar absolute bottom-0 left-0 z-50 h-[35vh] w-full transform rounded-t-2xl border border-daintree-700 bg-daintree-800 p-3 transition-transform duration-300 ease-out",
              lockAfterDropdownOpen ? "translate-y-0" : "translate-y-[35vh]",
            )}
          >
            {lockAfterOptions.map((option) => (
              <div
                key={option.value}
                className={twMerge(
                  "flex w-full cursor-pointer items-center rounded-lg p-2 opacity-80 hover:bg-daintree-700",
                  selectedLockAfter?.value === option.value &&
                    "bg-daintree-700",
                )}
                onClick={async () => {
                  await changeLockAfter(option.value);
                  setLockAfterDropdownOpen(false);
                }}
              >
                <span className="text-sm font-semibold">{option.name}</span>
              </div>
            ))}
          </div>
        </>

        {/* Network */}
        <SettingItem
          title="Network"
          onClick={() => setNetworkDropdownOpen(!networkDropdownOpen)}
        >
          <span className={twMerge("font-semibold", selectedNetwork?.text)}>
            {selectedNetwork?.name}
          </span>
        </SettingItem>

        <>
          <div
            className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
              networkDropdownOpen
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            onClick={() => setNetworkDropdownOpen(false)}
          />
          <div
            className={twMerge(
              "no-scrollbar absolute bottom-0 left-0 z-50 h-[25vh] w-full transform rounded-t-2xl border border-daintree-700 bg-daintree-800 p-3 transition-transform duration-300 ease-out",
              networkDropdownOpen ? "translate-y-0" : "translate-y-[25vh]",
            )}
          >
            {networks.map((network) => (
              <div
                key={network.id}
                className={twMerge(
                  "flex w-full cursor-pointer items-center gap-2 rounded-lg p-2 opacity-80 hover:bg-daintree-700",
                  network.text,
                  selectedNetwork?.id === network.id && "bg-daintree-700",
                )}
                onClick={async () => {
                  await changeNetwork(network.id);
                  setNetworkDropdownOpen(false);
                }}
              >
                <i className={twMerge("rounded-full p-1", network.iconColor)} />
                <span className="text-sm font-semibold">{network.name}</span>
                <div className="text-sm"></div>
              </div>
            ))}
          </div>
        </>

        {/* Change password */}
        <SettingItem
          title="Change password"
          showChevron
          onClick={() => {
            navigate("/change-password");
          }}
        />

        {/* Connected Apps */}
        <SettingItem
          title="Connected apps"
          showChevron
          onClick={() => {
            navigate("/connected-apps");
          }}
        />

        {/* Experimental features */}
        <SettingItem
          title="Experimental features"
          showChevron
          onClick={() => navigate("/dev-mode")}
        />
      </div>
      <div className="mt-auto flex flex-col items-center gap-6">
        <div className="flex gap-3">
          <a href="http://t.me/kastlewallet" target="_blank" rel="noreferrer">
            <img alt="telegram" className="h-4 w-4" src={telegram} />
          </a>
          <a href="https://x.com/KastleWallet" target="_blank" rel="noreferrer">
            <img alt="x" className="h-4 w-4" src={x} />
          </a>
          <a
            href="https://github.com/forbole/kastle"
            target="_blank"
            rel="noreferrer"
          >
            <img alt="githug" className="h-4 w-4" src={github} />
          </a>
        </div>

        <div className="flex flex-col items-center gap-2 text-[10px] font-medium text-daintree-400">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <a
                href="https://forbole.com/en/terms-and-conditions"
                target="_blank"
                rel="noreferrer"
              >
                Terms & Conditions
              </a>
              <span className="text-[#6B7280]">|</span>
              <a
                href="https://forbole.com/en/privacy-policy"
                target="_blank"
                rel="noreferrer"
              >
                Privacy Policy
              </a>
            </div>
          </div>
          <div>Version {packageJson.version}</div>
        </div>
      </div>
    </div>
  );
}
