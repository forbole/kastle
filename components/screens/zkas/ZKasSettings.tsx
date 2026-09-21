import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import { useSettings } from "@/hooks/useSettings";
import { getZKasDaemonOriginPattern } from "@/lib/zkas/client";
import { SETTINGS_KEY, type Settings } from "@/contexts/SettingsContext";
import useStorageState from "@/hooks/useStorageState";
import {
  ZKAS_CONNECTIONS_KEY,
  type ZKasConnections,
} from "@/lib/zkas/connection";
import { Method } from "@/lib/service/methods";
import { sendMessage } from "@/lib/utils";
import {
  getVisibleWalletNetworks,
  ZKAS_EXPERIMENTAL_KEY,
  ZKAS_MAINNET,
} from "@/lib/wallet-network";
import {
  getZKasDaemonBirthday,
  getSelectedZKasAddress,
  registerSelectedZKasWallet,
} from "@/lib/zkas/popup-client";
import useSwitchNetwork from "@/hooks/useSwitchNetwork";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import {
  WALLET_SETTINGS,
  type WalletSettings,
} from "@/contexts/WalletManagerContext";
import { withWalletSettingsLock } from "@/lib/wallet-settings-storage";
import { NetworkType } from "@/lib/network-type";

export default function ZKasSettings() {
  const navigate = useNavigate();
  const [settings, , isSettingsLoading] = useSettings();
  const { walletSettings, refreshKaspaAddresses } = useWalletManager();
  const { switchZKasNetwork } = useSwitchNetwork();
  const [enabled, , isGateLoading] = useStorageState<boolean | null>(
    ZKAS_EXPERIMENTAL_KEY,
    null,
  );
  const [connections] = useStorageState<ZKasConnections>(
    ZKAS_CONNECTIONS_KEY,
    {},
  );
  const network =
    !isGateLoading &&
    settings &&
    getVisibleWalletNetworks(settings, enabled).includes(ZKAS_MAINNET)
      ? "mainnet"
      : undefined;
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setUrl(network ? (settings?.zkasDaemonUrls?.[network] ?? "") : "");
  }, [settings?.zkasDaemonUrls, network]);

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      if (isSettingsLoading || !settings || !network)
        throw new Error("Select a supported Kastle network first");
      if (!walletSettings) throw new Error("Wallet settings are still loading");
      if (!url.trim()) throw new Error("Enter a ZKas daemon URL");
      const daemonUrl = url.trim();
      const expectedWalletId = walletSettings.selectedWalletId;
      const expectedAccountIndex = walletSettings.selectedAccountIndex;
      const pattern = getZKasDaemonOriginPattern(daemonUrl);
      // Invoke this directly from the click handler. Firefox drops the required
      // user-action status after the first awaited operation.
      const permissionRequest = browser.permissions.request({
        origins: [pattern],
      });
      const granted = await permissionRequest;
      if (!granted) throw new Error("Daemon access was not granted");
      const account = await getSelectedZKasAddress();
      if (
        account &&
        (account.walletId !== expectedWalletId ||
          account.accountIndex !== expectedAccountIndex)
      ) {
        throw new Error("Selected ZKas account changed. Review and retry.");
      }
      await getZKasDaemonBirthday(daemonUrl, network);
      const latest = await storage.getItem<Settings>(SETTINGS_KEY);
      const latestEnabled = await storage.getItem<boolean>(
        ZKAS_EXPERIMENTAL_KEY,
      );
      if (
        !latest ||
        !getVisibleWalletNetworks(latest, latestEnabled).includes(
          ZKAS_MAINNET,
        ) ||
        latest.networkId !== settings.networkId
      ) {
        throw new Error(
          "Kastle network changed. Review the daemon setting again.",
        );
      }
      let needsKaspaAddressRefresh = false;
      let setupFailed = false;
      let setupFailure: unknown;
      try {
        await withWalletSettingsLock(async () => {
          const currentWalletSettings =
            await storage.getItem<WalletSettings>(WALLET_SETTINGS);
          if (
            !currentWalletSettings ||
            currentWalletSettings.selectedWalletId !== expectedWalletId ||
            currentWalletSettings.selectedAccountIndex !== expectedAccountIndex
          ) {
            throw new Error("Selected ZKas account changed. Review and retry.");
          }
          needsKaspaAddressRefresh = await switchZKasNetwork(daemonUrl, {
            deferKaspaAddressRefresh: true,
          });
          if (account) await registerSelectedZKasWallet(account, daemonUrl);
        });
      } catch (cause) {
        setupFailed = true;
        setupFailure = cause;
      }
      if (needsKaspaAddressRefresh) {
        try {
          await refreshKaspaAddresses(NetworkType.Mainnet);
        } catch (cause) {
          if (!setupFailed) {
            setupFailed = true;
            setupFailure = cause;
          }
        }
      }
      if (setupFailed) throw setupFailure;
      navigate("/zkas-asset");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save ZKas daemon",
      );
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async (origin: string) => {
    try {
      const response = await sendMessage<{ ok?: boolean; error?: string }>(
        Method.ZKAS_CONNECTION_REMOVE,
        { origin },
      );
      if (response.error || !response.ok)
        throw new Error(response.error ?? "Unable to disconnect website");
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to disconnect website",
      );
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 text-white">
      <Header
        title="ZKas daemon"
        onBack={() => navigate("/zkas-asset")}
        onClose={() => navigate("/dashboard")}
      />
      <div className="space-y-4">
        <p className="text-sm text-daintree-300">
          Add a wallet daemon before using ZKas {network ?? "network"}. Kastle
          automatically sends the selected wallet’s full viewing key and scan
          birthday so the daemon can view its address history and balance,
          monitor shielded notes, and prepare proofs. Kastle keeps the spending
          key and signs payments locally.
        </p>
        <label className="block text-sm" htmlFor="zkas-daemon-url">
          Daemon URL
        </label>
        <input
          id="zkas-daemon-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://daemon.example"
          className="w-full rounded-lg border border-daintree-700 bg-daintree-800 p-3 text-white"
        />
        <p className="text-xs text-daintree-400">
          HTTPS is required except for localhost. Anyone controlling this daemon
          can see this wallet’s addresses, balance, and transaction history.
          Choose one you trust to preserve privacy.
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={saving || isSettingsLoading || !network}
          onClick={() => void save()}
          className="w-full rounded-full bg-icy-blue-400 p-3 font-semibold disabled:opacity-40"
        >
          {saving ? "Connecting wallet…" : "Share viewing key and connect"}
        </button>
        <section
          className="space-y-2 pt-4"
          aria-label="Connected ZKas websites"
        >
          <h2 className="font-semibold">Connected websites</h2>
          {Object.keys(connections).length === 0 && (
            <p className="text-xs text-daintree-400">
              No ZKas websites connected.
            </p>
          )}
          {Object.keys(connections).map((origin) => (
            <div
              key={origin}
              className="flex items-center gap-2 rounded-lg bg-daintree-800 p-2 text-xs"
            >
              <span className="min-w-0 flex-1 break-all">{origin}</span>
              <button
                type="button"
                onClick={() => void disconnect(origin)}
                className="rounded border border-daintree-700 px-2 py-1"
              >
                Disconnect
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
