import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import { useSettings } from "@/hooks/useSettings";
import { getZKasDaemonOriginPattern } from "@/lib/zkas/client";

export default function ZKasSettings() {
  const navigate = useNavigate();
  const [settings, setSettings, isSettingsLoading] = useSettings();
  const network = settings?.networkId === "mainnet"
    ? "mainnet"
    : settings?.networkId === "testnet-10"
      ? "testnet"
      : undefined;
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setUrl(network ? settings?.zkasDaemonUrls?.[network] ?? "" : ""); }, [settings?.zkasDaemonUrls, network]);

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      if (isSettingsLoading || !settings || !network) throw new Error("Select a supported Kastle network first");
      if (!url.trim()) throw new Error("Enter a ZKas daemon URL");
      const pattern = getZKasDaemonOriginPattern(url.trim());
      const granted = await browser.permissions.request({ origins: [pattern] });
      if (!granted) throw new Error("Daemon access was not granted");
      await setSettings((previous) => ({
        ...previous,
        zkasDaemonUrls: { ...previous.zkasDaemonUrls, [network]: url.trim() },
      }));
      navigate("/zkas-asset");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save ZKas daemon");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 text-white">
      <Header title="ZKas daemon" onBack={() => navigate("/zkas-asset")} onClose={() => navigate("/dashboard")} />
      <div className="space-y-4">
        <p className="text-sm text-daintree-300">Choose a wallet daemon for ZKas {network ?? "network"}. It will scan shielded notes and prepare proofs. Kastle verifies and signs payments locally.</p>
        <label className="block text-sm" htmlFor="zkas-daemon-url">Daemon URL</label>
        <input id="zkas-daemon-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://daemon.example" className="w-full rounded-lg border border-daintree-700 bg-daintree-800 p-3 text-white" />
        <p className="text-xs text-daintree-400">HTTPS is required except for localhost. The daemon sees your full viewing key and activity. Choose one you trust to preserve privacy.</p>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <button type="button" disabled={saving || isSettingsLoading || !network} onClick={() => void save()} className="w-full rounded-full bg-icy-blue-400 p-3 font-semibold disabled:opacity-40">{saving ? "Saving…" : "Allow access and save"}</button>
      </div>
    </div>
  );
}
