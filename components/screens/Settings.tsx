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
import useSwitchNetwork from "@/hooks/useSwitchNetwork";

import packageJson from "../../package.json";
import CurrencySelection from "@/components/settings/CurrencySelection.tsx";

export const explorerTxLinks = {
  [NetworkType.Mainnet]: "https://explorer.kaspa.org/txs/",
  [NetworkType.TestnetT10]: "https://explorer-tn10.kaspa.org/txs/",
};

export const explorerAddressLinks = {
  [NetworkType.Mainnet]: "https://explorer.kaspa.org/addresses/",
  [NetworkType.TestnetT10]: "https://explorer-tn10.kaspa.org/addresses/",
};

export const restApis = {
  [NetworkType.Mainnet]: "https://api.kaspa.org",
  [NetworkType.TestnetT10]: "https://api-tn10.kaspa.org",
};

export default function Settings() {
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [lockAfterDropdownOpen, setLockAfterDropdownOpen] = useState(false);
  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);
  const [settings, setSettings] = useSettings();
  const { switchKaspaNetwork } = useSwitchNetwork();
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

  return (
    <div className="relative flex h-full flex-col p-4">
      {/* Header */}
      <Header
        title="Settings"
        showPrevious={false}
        onClose={() => navigate("/dashboard")}
      />

      {/* Settings List */}
      <div className="thin-scrollbar flex flex-col gap-3 overflow-y-auto pr-2">
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

        {/* Currency */}
        <SettingItem
          title="Currency"
          onClick={() => setCurrencyDropdownOpen((prev) => !prev)}
        >
          <button className="font-semibold uppercase">
            {settings?.currency}
          </button>
        </SettingItem>
        <CurrencySelection
          isShown={currencyDropdownOpen}
          toggleShow={() => setCurrencyDropdownOpen((prev) => !prev)}
        />

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
                  await switchKaspaNetwork(network.id);
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

        {/* Legacy Features */}
        <div className="flex w-full items-center justify-between rounded-xl border border-daintree-700 bg-[#1E343D] p-4 text-sm hover:border-white">
          <div className="flex items-center justify-start gap-4 font-semibold">
            <span className="font-semibold">Legacy Features</span>
          </div>
          <div className="flex items-center">
            <input
              checked={settings?.isLegacyFeaturesEnabled ?? false}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  isLegacyFeaturesEnabled: e.target.checked,
                  // When disabling legacy features, also disable legacy EVM address
                  isLegacyEvmAddressEnabled: e.target.checked
                    ? prev?.isLegacyEvmAddressEnabled
                    : false,
                }))
              }
              type="checkbox"
              className="relative h-6 w-11 cursor-pointer rounded-full border-neutral-700 border-transparent bg-daintree-700 p-px text-transparent transition-colors duration-200 ease-in-out before:inline-block before:size-5 before:translate-x-0 before:transform before:rounded-full before:bg-white before:shadow before:ring-0 before:transition before:duration-200 before:ease-in-out checked:border-icy-blue-400 checked:bg-icy-blue-400 checked:bg-none checked:text-icy-blue-400 checked:before:translate-x-full checked:before:bg-white focus:ring-transparent focus:ring-offset-transparent focus:checked:border-transparent disabled:pointer-events-none disabled:opacity-50"
            />
          </div>
        </div>

        {/* Legacy EVM address - only visible when Legacy Features is enabled */}
        {settings?.isLegacyFeaturesEnabled && (
          <div className="flex w-full items-center justify-between rounded-xl border border-daintree-700 bg-[#1E343D] p-4 text-sm hover:border-white">
            <div className="flex items-center justify-start gap-4 font-semibold">
              <span className="font-semibold">Legacy EVM address</span>
            </div>
            <div className="flex items-center">
              <input
                checked={settings?.isLegacyEvmAddressEnabled ?? false}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    isLegacyEvmAddressEnabled: e.target.checked,
                  }))
                }
                type="checkbox"
                className="relative h-6 w-11 cursor-pointer rounded-full border-neutral-700 border-transparent bg-daintree-700 p-px text-transparent transition-colors duration-200 ease-in-out before:inline-block before:size-5 before:translate-x-0 before:transform before:rounded-full before:bg-white before:shadow before:ring-0 before:transition before:duration-200 before:ease-in-out checked:border-icy-blue-400 checked:bg-icy-blue-400 checked:bg-none checked:text-icy-blue-400 checked:before:translate-x-full checked:before:bg-white focus:ring-transparent focus:ring-offset-transparent focus:checked:border-transparent disabled:pointer-events-none disabled:opacity-50"
              />
            </div>
          </div>
        )}

        {/* Experimental features */}
        <SettingItem
          title="Experimental features"
          showChevron
          onClick={() => navigate("/dev-mode")}
        />
      </div>
      <div className="mt-auto flex flex-col items-center gap-3 pt-2">
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
            <img alt="github" className="h-4 w-4" src={github} />
          </a>
        </div>

        <div className="flex flex-col items-center gap-2 text-[10px] font-medium text-daintree-400">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <a
                href="https://kastle.cc/term-and-conditions"
                target="_blank"
                rel="noreferrer"
              >
                Terms & Conditions
              </a>
              <span className="text-[#6B7280]">|</span>
              <a
                href="https://kastle.cc/privacy-policy"
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
