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
import { isZKasActive, ZKAS_EXPERIMENTAL_KEY } from "@/lib/wallet-network";

export default function ZKasSettings() {
  const navigate = useNavigate();
  const [settings, , isSettingsLoading] = useSettings();
  const [enabled, , isGateLoading] = useStorageState<boolean | null>(
    ZKAS_EXPERIMENTAL_KEY,
    null,
  );
  const [connections] = useStorageState<ZKasConnections>(
    ZKAS_CONNECTIONS_KEY,
    {},
  );
  const network =
    !isGateLoading && isZKasActive(settings, enabled) ? "mainnet" : undefined;
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
      if (!url.trim()) throw new Error("Enter a ZKas daemon URL");
      const pattern = getZKasDaemonOriginPattern(url.trim());
      const granted = await browser.permissions.request({ origins: [pattern] });
      if (!granted) throw new Error("Daemon access was not granted");
      const latest = await storage.getItem<Settings>(SETTINGS_KEY);
      const latestEnabled = await storage.getItem<boolean>(
        ZKAS_EXPERIMENTAL_KEY,
      );
      if (
        !latest ||
        !isZKasActive(latest, latestEnabled) ||
        latest.networkId !== settings.networkId
      ) {
        throw new Error(
          "Kastle network changed. Review the daemon setting again.",
        );
      }
      await storage.setItem(SETTINGS_KEY, {
        ...latest,
        zkasDaemonUrls: { ...latest.zkasDaemonUrls, [network]: url.trim() },
      });
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
          Choose a wallet daemon for ZKas {network ?? "network"}. It will scan
          shielded notes and prepare proofs. Kastle verifies and signs payments
          locally.
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
          HTTPS is required except for localhost. The daemon sees your full
          viewing key and activity. Choose one you trust to preserve privacy.
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
          {saving ? "Saving…" : "Allow access and save"}
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
