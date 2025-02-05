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
  [NetworkType.Mainnet]: "https://explorer.kaspa.org/txs/",
  [NetworkType.TestnetT10]: "https://explorer-tn10.kaspa.org/txs/",
  [NetworkType.TestnetT11]: "https://explorer-tn11.kaspa.org/txs/",
};

export const explorerAddressLinks = {
  [NetworkType.Mainnet]: "https://explorer.kaspa.org/addresses/",
  [NetworkType.TestnetT10]: "https://explorer-tn10.kaspa.org/addresses/",
  [NetworkType.TestnetT11]: "https://explorer-tn11.kaspa.org/addresses/",
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
      color: "text-teal-500",
    },
    {
      id: NetworkType.TestnetT10,
      name: "Testnet T10",
      color: "text-yellow-500",
    },
    {
      id: NetworkType.TestnetT11,
      name: "Testnet T11",
      color: "text-violet-500",
    },
  ];
  const selectedNetwork = networks.find((n) => n.id === settings?.networkId);

  const changeNetwork = async (networkId: NetworkType) => {
    await setSettings((prev) => ({ ...prev, networkId }));
  };

  return (
    <div className="flex h-full flex-col p-6">
      {/* Header */}
      <Header
        title="Settings"
        showPrevious={false}
        onClose={() => navigate("/dashboard")}
      />

      {/* Settings List */}
      <div className="flex flex-col gap-3">
        {/* Auto lock after */}
        <div className="relative">
          <SettingItem
            title="Auto lock after"
            onClick={() => setLockAfterDropdownOpen(!lockAfterDropdownOpen)}
          >
            <button className="font-semibold text-[#3c73ff]">
              {selectedLockAfter?.name}
            </button>
          </SettingItem>
          {lockAfterDropdownOpen && (
            <div className="absolute right-0 top-[4.5rem] z-10 flex flex-col items-start justify-start overflow-hidden rounded-xl border border-gray-700 bg-gray-800 p-2 shadow">
              {lockAfterOptions.map((option) => (
                <div
                  key={option.value}
                  className={twMerge(
                    "flex w-full cursor-pointer items-center rounded-lg p-2 opacity-80",
                    selectedLockAfter?.name === option.name
                      ? "bg-icy-blue-400"
                      : "",
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
          )}
        </div>

        {/* Network */}
        <div className="relative">
          <SettingItem
            title="Network"
            onClick={() => setNetworkDropdownOpen(!networkDropdownOpen)}
          >
            <span className={twMerge("font-semibold", selectedNetwork?.color)}>
              {selectedNetwork?.name}
            </span>
          </SettingItem>
          {networkDropdownOpen && (
            <div className="absolute right-0 top-[4.5rem] flex flex-col items-start justify-start overflow-hidden rounded-xl border border-gray-700 bg-gray-800 p-2 shadow">
              {networks.map((network) => (
                <div
                  key={network.id}
                  className={twMerge(
                    "flex w-full cursor-pointer items-center gap-1 rounded-lg p-2 opacity-80",
                    network.color,
                    selectedNetwork?.id === network.id ? "bg-icy-blue-400" : "",
                  )}
                  onClick={async () => {
                    await changeNetwork(network.id);
                    setNetworkDropdownOpen(false);
                  }}
                >
                  <i className="hn hn-globe-solid text-sm" />
                  <span className="text-sm font-semibold">{network.name}</span>
                  <div className="text-sm"></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Connected Apps */}
        <SettingItem
          title="Connected apps"
          showChevron
          onClick={() => {
            navigate("/connected-apps");
          }}
        />

        {/* Preview mode */}
        <SettingItem
          title="Dev mode"
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
