import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { importZKasSeed, previewZKasSeed, type PublicZKasAccount } from "@/lib/zkas/popup-client";

export default function ImportZKasSeed() {
  const navigate = useNavigate();
  const { wallet, account } = useWalletManager();
  const [seedHex, setSeedHex] = useState("");
  const [showSeed, setShowSeed] = useState(false);
  const [preview, setPreview] = useState<PublicZKasAccount>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eligible = wallet?.type === "privateKey" && account?.index === 0;

  const previewAddress = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(await previewZKasSeed(seedHex));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to preview ZKas seed");
    } finally {
      setBusy(false);
    }
  };

  const saveSeed = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await importZKasSeed(seedHex, preview);
      setSeedHex("");
      navigate("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to import ZKas seed");
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[35rem] w-[41rem] flex-col gap-5 rounded-3xl bg-icy-blue-950 p-8 text-white">
      <Header title="Import ZKas spending seed" showPrevious={false} onClose={() => navigate("/dashboard")} />
      <p className="text-sm text-daintree-200">
        Attach a 32-byte ZKas seed from shielded-pay to {wallet?.name ?? "the selected wallet"}, {account?.name ?? "account 0"}.
        This seed is used only for ZKas. Keep your original backup of it.
      </p>
      {!eligible ? (
        <p role="alert" className="rounded-lg border border-amber-500 p-3 text-sm">
          Select account 0 in an imported private-key wallet first.
        </p>
      ) : preview ? (
        <div className="space-y-4">
          <p className="text-sm">Compare this derived address with the address shown by shielded-pay before importing:</p>
          <p className="break-all rounded-lg bg-daintree-800 p-3 text-sm">{preview.address}</p>
          <button type="button" disabled={busy} onClick={() => void saveSeed()} className="w-full rounded-full bg-icy-blue-400 p-4 disabled:opacity-50">
            Import this ZKas seed
          </button>
          <button type="button" disabled={busy} onClick={() => setPreview(undefined)} className="w-full rounded-full border border-daintree-700 p-3 disabled:opacity-50">
            Edit seed
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <label htmlFor="zkas-seed" className="block text-sm">ZKas spending seed (64 hexadecimal characters)</label>
          <input
            id="zkas-seed"
            type={showSeed ? "text" : "password"}
            value={seedHex}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setSeedHex(event.target.value)}
            className="w-full rounded-lg border border-daintree-700 bg-daintree-800 p-3 text-sm"
          />
          <button type="button" onClick={() => setShowSeed((value) => !value)} className="text-sm text-icy-blue-400">
            {showSeed ? "Hide seed" : "Show seed"}
          </button>
          <button type="button" disabled={!eligible || busy || !seedHex.trim()} onClick={() => void previewAddress()} className="w-full rounded-full bg-icy-blue-400 p-4 disabled:opacity-50">
            Show derived address
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
