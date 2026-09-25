import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import internalToast from "@/components/Toast";
import {
  getZKasDaemonBirthday,
  importZKasSeed,
  previewZKasSeed,
  registerSelectedZKasWallet,
} from "@/lib/zkas/popup-client";
import useSwitchNetwork from "@/hooks/useSwitchNetwork";
import { useSettings } from "@/hooks/useSettings";
import { requireZKasDaemonUrl } from "@/lib/zkas/setup";

export default function ImportZKasSeed({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const { switchZKasNetwork } = useSwitchNetwork();
  const [settings] = useSettings();
  const [seedHex, setSeedHex] = useState("");
  const [showSeed, setShowSeed] = useState(false);
  const [preview, setPreview] = useState<{
    network: "mainnet";
    address: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const previewAddress = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(await previewZKasSeed(seedHex));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to preview ZKas seed",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveSeed = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    let imported = false;
    try {
      const daemonUrl = requireZKasDaemonUrl(settings, "mainnet");
      await getZKasDaemonBirthday(daemonUrl);
      const importedAccount = await importZKasSeed(seedHex, preview);
      imported = true;
      try {
        await switchZKasNetwork();
      } catch {
        // The wallet is saved. The dashboard offers network settings if the
        // experimental network was disabled in another window during import.
      }
      await registerSelectedZKasWallet(importedAccount, daemonUrl);
      setSeedHex("");
      navigate("/accounts-imported");
    } catch (cause) {
      if (imported) {
        setSeedHex("");
        internalToast.error(
          "Wallet imported, but daemon registration failed. Kastle will retry from genesis.",
        );
        navigate("/accounts-imported");
        return;
      }
      setError(
        cause instanceof Error ? cause.message : "Unable to import ZKas seed",
      );
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[35rem] w-[41rem] flex-col gap-5 rounded-3xl bg-icy-blue-950 p-8 text-white">
      <Header
        title="Import ZKas wallet"
        showPrevious
        onBack={onBack}
        showClose
        onClose={() => window.close()}
      />
      <p className="text-sm text-daintree-200">
        Import a 32-byte spending seed from shielded-pay as a separate ZKas
        wallet. Compare its address before saving, and keep your original
        backup.
      </p>
      {preview ? (
        <div className="space-y-4">
          <p className="text-sm">
            Compare this derived address with the address shown by shielded-pay
            before importing:
          </p>
          <p className="break-all rounded-lg bg-daintree-800 p-3 text-sm">
            {preview.address}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveSeed()}
            className="w-full rounded-full bg-icy-blue-400 p-4 disabled:opacity-50"
          >
            Import this ZKas seed
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPreview(undefined)}
            className="w-full rounded-full border border-daintree-700 p-3 disabled:opacity-50"
          >
            Edit seed
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <label htmlFor="zkas-seed" className="block text-sm">
            ZKas spending seed (64 hexadecimal characters)
          </label>
          <input
            id="zkas-seed"
            type={showSeed ? "text" : "password"}
            value={seedHex}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setSeedHex(event.target.value)}
            className="w-full rounded-lg border border-daintree-700 bg-daintree-800 p-3 text-sm"
          />
          <button
            type="button"
            onClick={() => setShowSeed((value) => !value)}
            className="text-sm text-icy-blue-400"
          >
            {showSeed ? "Hide seed" : "Show seed"}
          </button>
          <button
            type="button"
            disabled={busy || !seedHex.trim()}
            onClick={() => void previewAddress()}
            className="w-full rounded-full bg-icy-blue-400 p-4 disabled:opacity-50"
          >
            Show derived address
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
