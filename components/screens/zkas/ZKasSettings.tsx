import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import { updateSettingsLocked } from "@/lib/settings-storage";
import {
  canonicalHistoryIndexOrigin,
  historyIndexHostPattern,
} from "@/lib/zkas/history-config";
import { NetworkType } from "@/lib/network-type";
import type { HistoryGrantListView } from "@/lib/zkas/history-grant";
import DaemonBearerPairing from "./DaemonBearerPairing";

export default function ZKasSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const onBack = () => {
    const pairingReturn = (location.state as { pairingReturn?: unknown } | null)
      ?.pairingReturn;
    if (pairingReturn === "add-wallet") {
      navigate("/add-wallet");
    } else if (pairingReturn === "import-zkas-seed") {
      navigate("/import-private-key", { state: { showZKasSeed: true } });
    } else {
      navigate("/zkas-asset");
    }
  };
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
  const [indexUrl, setIndexUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingIndex, setSavingIndex] = useState(false);
  const [historyGrants, setHistoryGrants] =
    useState<HistoryGrantListView | null>(null);
  const [historyGrantError, setHistoryGrantError] = useState("");
  const [loadingHistoryGrants, setLoadingHistoryGrants] = useState(false);
  const [revokingHistoryOrigin, setRevokingHistoryOrigin] = useState<
    string | null
  >(null);
  const historyRequest = useRef(0);
  const refreshHistoryGrants = useCallback(async () => {
    const request = ++historyRequest.current;
    setLoadingHistoryGrants(true);
    setHistoryGrantError("");
    try {
      const response = await sendMessage<
        HistoryGrantListView & { error?: string }
      >(Method.ZKAS_HISTORY_GRANTS_LIST);
      if (response.error) throw new Error(response.error);
      if (historyRequest.current === request) setHistoryGrants(response);
    } catch (cause) {
      if (historyRequest.current === request) {
        setHistoryGrants(null);
        setHistoryGrantError(
          cause instanceof Error
            ? cause.message
            : "Unable to load history access",
        );
      }
    } finally {
      if (historyRequest.current === request) setLoadingHistoryGrants(false);
    }
  }, []);
  useEffect(() => {
    setHistoryGrants(null);
    if (network === "mainnet") void refreshHistoryGrants();
    return () => {
      historyRequest.current += 1;
    };
  }, [
    network,
    walletSettings?.selectedWalletId,
    walletSettings?.selectedAccountIndex,
    refreshHistoryGrants,
  ]);
  useEffect(() => {
    setUrl(network ? (settings?.zkasDaemonUrls?.[network] ?? "") : "");
  }, [settings?.zkasDaemonUrls, network]);
  useEffect(() => {
    setIndexUrl(
      network ? (settings?.zkasHistoryIndexUrls?.[network] ?? "") : "",
    );
  }, [settings?.zkasHistoryIndexUrls, network]);

  const saveIndex = async () => {
    setError("");
    setSavingIndex(true);
    try {
      if (
        isSettingsLoading ||
        !settings ||
        network !== "mainnet" ||
        !walletSettings
      )
        throw new Error("Select a ZKas Mainnet wallet first");
      const origin = canonicalHistoryIndexOrigin(indexUrl);
      const expectedWalletId = walletSettings.selectedWalletId;
      const expectedAccountIndex = walletSettings.selectedAccountIndex;
      if (!expectedWalletId || expectedAccountIndex === undefined)
        throw new Error("Select a ZKas wallet account first");
      // Browser host permission must be requested directly from this click.
      const permissionRequest = browser.permissions.request({
        origins: [historyIndexHostPattern(origin)],
      });
      if (!(await permissionRequest))
        throw new Error("History index access was not granted");
      const latestWalletSettings =
        await storage.getItem<WalletSettings>(WALLET_SETTINGS);
      if (
        latestWalletSettings?.selectedWalletId !== expectedWalletId ||
        latestWalletSettings.selectedAccountIndex !== expectedAccountIndex
      ) {
        throw new Error("Selected ZKas account changed. Review and retry.");
      }
      await updateSettingsLocked<Settings>(
        SETTINGS_KEY,
        (current) => ({
          ...current,
          zkasHistoryIndexUrls: {
            ...current.zkasHistoryIndexUrls,
            mainnet: origin,
          },
        }),
        { expectedJson: JSON.stringify(settings) },
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save history index",
      );
    } finally {
      setSavingIndex(false);
    }
  };

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

  const revokeHistoryGrant = async (
    origin: string,
    expectedRevision: string,
  ) => {
    setRevokingHistoryOrigin(origin);
    let failure = "";
    try {
      const response = await sendMessage<{ revoked?: boolean; error?: string }>(
        Method.ZKAS_HISTORY_GRANT_REVOKE_SAVED,
        { origin, expectedRevision },
      );
      if (response.error || !response.revoked)
        throw new Error(response.error ?? "Unable to revoke history access");
    } catch (cause) {
      failure =
        cause instanceof Error
          ? cause.message
          : "Unable to revoke history access";
    } finally {
      await refreshHistoryGrants();
      if (failure) setHistoryGrantError(failure);
      setRevokingHistoryOrigin(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 text-white">
      <Header
        title="ZKas daemon"
        onBack={onBack}
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
        <DaemonBearerPairing draftOrigin={url} />
        <section className="space-y-2 pt-4" aria-label="History index setup">
          <h2 className="font-semibold">Encrypted history index</h2>
          <p className="text-xs text-daintree-400">
            Enter the origin of your own transaction index. This setting grants
            Kastle access to public encrypted transaction data; it does not let
            websites read wallet messages.
          </p>
          <label className="block text-sm" htmlFor="zkas-history-index-url">
            Index origin
          </label>
          <input
            id="zkas-history-index-url"
            type="url"
            value={indexUrl}
            onChange={(event) => setIndexUrl(event.target.value)}
            placeholder="http://127.0.0.1:8786"
            className="w-full rounded-lg border border-daintree-700 bg-daintree-800 p-3 text-white"
          />
          <button
            type="button"
            disabled={savingIndex || isSettingsLoading || network !== "mainnet"}
            onClick={() => void saveIndex()}
            className="w-full rounded-full border border-daintree-700 p-3 disabled:opacity-40"
          >
            {savingIndex ? "Saving index…" : "Save index origin"}
          </button>
        </section>
        <section className="space-y-2 pt-4" aria-label="Message history access">
          <h2 className="font-semibold">Message history access</h2>
          <p className="text-xs text-daintree-400">
            Review saved website permissions for the selected ZKas account.
            Connection and source labels do not mean a website currently has a
            read session.
          </p>
          <button
            type="button"
            disabled={loadingHistoryGrants || network !== "mainnet"}
            onClick={() => void refreshHistoryGrants()}
            className="rounded border border-daintree-700 px-3 py-2 text-sm disabled:opacity-40"
          >
            {loadingHistoryGrants ? "Refreshing…" : "Refresh access list"}
          </button>
          {historyGrantError && (
            <p role="alert" className="text-sm text-red-400">
              {historyGrantError}
            </p>
          )}
          {historyGrants && (
            <p className="break-all text-xs text-daintree-400">
              Wallet {historyGrants.account.walletId} · Account{" "}
              {historyGrants.account.accountIndex} ·{" "}
              {historyGrants.account.address0}
            </p>
          )}
          {historyGrants?.records.length === 0 && (
            <p className="text-xs text-daintree-400">
              No saved website access for this account.
            </p>
          )}
          {historyGrants?.records.map((record) => (
            <div
              key={record.revision}
              className="space-y-1 rounded-lg bg-daintree-800 p-3 text-xs"
            >
              <p className="break-all font-semibold">{record.origin}</p>
              <p>
                Source: {record.sourceStatus} · Website:{" "}
                {record.connectionStatus}
              </p>
              <p className="break-all text-daintree-400">
                Daemon: {record.daemonUrl}
              </p>
              <p className="break-all text-daintree-400">
                Index: {record.indexUrl}
              </p>
              <button
                type="button"
                disabled={
                  revokingHistoryOrigin !== null || loadingHistoryGrants
                }
                onClick={() =>
                  void revokeHistoryGrant(record.origin, record.revision)
                }
                className="rounded border border-daintree-700 px-2 py-1 disabled:opacity-40"
              >
                {revokingHistoryOrigin === record.origin
                  ? "Revoking…"
                  : "Revoke history access"}
              </button>
            </div>
          ))}
        </section>
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
