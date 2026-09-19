import { useEffect, useState } from "react";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import Header from "@/components/GeneralHeader";
import { isAllowedZKasDappOrigin } from "@/lib/zkas/connection";
import { getZKasPublicAccount, type PublicZKasAccount } from "@/lib/zkas/popup-client";

export default function ZKasConnect() {
  const query = new URLSearchParams(window.location.search);
  const origin = query.get("origin") ?? "";
  const requestId = query.get("requestId") ?? "";
  const [account, setAccount] = useState<PublicZKasAccount>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void getZKasPublicAccount().then((value) => {
      if (active) setAccount(value);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load ZKas account");
    });
    return () => { active = false; };
  }, []);

  const approve = async () => {
    if (!account || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!isAllowedZKasDappOrigin(origin) || !requestId) throw new Error("Invalid ZKas connection request");
      const current = await getZKasPublicAccount();
      if (current.address !== account.address || current.walletId !== account.walletId ||
        current.accountIndex !== account.accountIndex || current.network !== account.network) {
        throw new Error("Selected ZKas account changed. Review the connection again.");
      }
      await ApiExtensionUtils.sendMessage(requestId, ApiUtils.createApiResponse(requestId, current));
      window.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect ZKas website");
    } finally {
      setBusy(false);
    }
  };

  return <div className="flex h-full flex-col overflow-y-auto p-4 text-white">
    <Header title="Connect ZKas" showPrevious={false} showClose={false} />
    <div className="space-y-4">
      <p className="break-all rounded-lg bg-daintree-800 p-3 text-sm">{origin}</p>
      <p className="text-sm">Allow this website to view the selected ZKas address and request your shielded balance. Every payment still needs a separate approval.</p>
      <p className="break-all rounded-lg bg-daintree-800 p-3 text-xs">{account?.address ?? "Loading ZKas account…"}</p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button type="button" disabled={!account || busy} onClick={() => void approve()} className="w-full rounded-full bg-icy-blue-400 p-3 font-semibold disabled:opacity-40">Connect</button>
      <button type="button" onClick={() => window.close()} className="w-full rounded-full border border-daintree-700 p-3">Cancel</button>
    </div>
  </div>;
}
