import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SideMenu } from "@/components/side-menu/SideMenu";
import useKeyring from "@/hooks/useKeyring";
import BackupWarning from "@/components/dashboard/BackupWarning";
import { formatZkasAmount } from "@/lib/zkas/amount";
import { clearZKasPaymentRecord, getZKasHistory, getZKasPaymentRecord, getZKasPublicAccount, getZKasState } from "@/lib/zkas/popup-client";
import type { ZKasHistory } from "@/lib/zkas/client";
import type { ZKasPaymentRecord } from "@/lib/zkas/payment-journal";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useSettings } from "@/hooks/useSettings";

export default function ZKasAsset() {
  const navigate = useNavigate();
  const { account: kaspaAccount, wallet, walletSettings } = useWalletManager();
  const { keyringLock } = useKeyring();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [settings, setSettings] = useSettings();
  const showBalance = !settings?.hideBalances;
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<string>();
  const [message, setMessage] = useState("Loading shielded account…");
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<ZKasHistory>();
  const [historyError, setHistoryError] = useState("");
  const [paymentRecord, setPaymentRecord] = useState<ZKasPaymentRecord | null>();
  const [paymentError, setPaymentError] = useState("");

  useEffect(() => {
    let active = true;
    setAddress("");
    setBalance(undefined);
    setReady(false);
    setHistory(undefined);
    setHistoryError("");
    setPaymentRecord(undefined);
    setPaymentError("");
    setMessage("Loading shielded account…");
    const load = async () => {
      try {
        const account = await getZKasPublicAccount();
        if (!active) return;
        setAddress(account.address);
        if (account.network !== "mainnet") {
          setMessage("Testnet receive only: the pinned signer cannot authorize testnet payments.");
        }
        try {
          const record = await getZKasPaymentRecord();
          if (!active) return;
          if (record && (record.selection.walletId !== account.walletId ||
            record.selection.accountIndex !== account.accountIndex ||
            record.selection.network !== account.network)) {
            throw new Error("Selected ZKas account changed. Refresh this screen.");
          }
          setPaymentRecord(record);
        } catch (cause) {
          if (active) setPaymentError(cause instanceof Error ? cause.message : "Unable to load payment recovery state");
        }
        try {
          const state = await getZKasState(account);
          if (!active) return;
          setBalance(formatZkasAmount(state.balanceSompi));
          if (state.missingHistory) setMessage("Wallet history is incomplete. Balance is not final.");
          else if (!state.synced) setMessage("ZKas daemon is still syncing. Balance is not final.");
          else if (account.network === "mainnet") {
            setMessage("Shielded balance synced");
            setReady(true);
          }
          try {
            const recent = await getZKasHistory(account);
            if (active) setHistory(recent);
          } catch (cause) {
            if (active) setHistoryError(cause instanceof Error ? cause.message : "Unable to load ZKas history");
          }
        } catch (error) {
          if (active) setMessage(error instanceof Error ? error.message : "Unable to read ZKas balance");
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Unable to load ZKas account");
      }
    };
    void load();
    return () => { active = false; };
  }, [walletSettings?.selectedWalletId, walletSettings?.selectedAccountIndex, settings?.networkId, settings?.activeChain, settings?.preview, settings?.zkasDaemonUrls]);

  const clearPayment = async () => {
    if (!paymentRecord || !window.confirm("I checked ZKas history and understand this payment may have been broadcast. Clear the warning and allow another send?")) return;
    try {
      await clearZKasPaymentRecord(paymentRecord);
      setPaymentRecord(null);
      setPaymentError("");
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : "Unable to clear payment warning");
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 text-white">
      <BackupWarning />
      <SideMenu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
      <div className="mb-4 flex items-center justify-between gap-2">
        <button type="button" className="rounded-lg border border-daintree-700 px-3 py-2 text-sm font-semibold" onClick={() => setIsMenuOpen(true)}>{kaspaAccount?.name ?? "Account"}</button>
        <span className="font-bold">ZKAS</span>
        <div className="flex">
          <button type="button" aria-label="Settings" className="p-2" onClick={() => navigate("/settings")}><i className="hn hn-cog text-[20px]" /></button>
          <button type="button" aria-label="Lock wallet" className="p-2" onClick={async () => { await keyringLock(); navigate("/unlock"); }}><i className="hn hn-lock-alt text-[20px]" /></button>
        </div>
      </div>
      <p className="mb-3 text-center text-xs text-icy-blue-400">ZKas Mainnet · Experimental</p>
      <div className="space-y-4">
        <div className="rounded-xl border border-daintree-700 bg-daintree-800 p-5">
          <p className="text-sm text-daintree-400">Shielded balance</p>
          <button type="button" aria-label={showBalance ? "Hide balance" : "Show balance"} className="mt-2" onClick={() => void setSettings((prev) => ({ ...prev, hideBalances: !prev.hideBalances }))}>
            <i className={showBalance ? "hn hn-eye-cross" : "hn hn-eye"} />
          </button>
          <p className="mt-2 text-3xl font-semibold">{!showBalance ? "*****" : balance === undefined ? "—" : `${balance} ZKAS`}</p>
          <p className="mt-3 text-sm text-daintree-400" role="status">{message}</p>
        </div>
        {address && <p className="break-all rounded-xl bg-daintree-800 p-3 text-xs text-daintree-200">{address}</p>}
        {!address && <p className="text-sm text-daintree-200">Choose a ZKas wallet from the wallet switcher, or import a spending seed in Import Wallet.</p>}
        <div className="flex gap-2">
          <button className="flex-1 rounded-full bg-icy-blue-400 p-3 font-semibold disabled:opacity-40" disabled={!address} onClick={() => navigate("/receive/zkas")}>Receive</button>
          <button className="flex-1 rounded-full bg-icy-blue-400 p-3 font-semibold disabled:opacity-40" disabled={!ready || paymentRecord === undefined || (paymentRecord !== null && paymentRecord.status !== "success")} onClick={() => navigate("/zkas/send")}>Send</button>
        </div>
        {paymentRecord && paymentRecord.status !== "success" && <div role="alert" className="space-y-2 rounded-xl border border-amber-500 p-3 text-sm">
          <p>A previous ZKas payment is {paymentRecord.status === "preparing" ? "still preparing or interrupted" : paymentRecord.status === "submitting" ? "possibly being submitted" : "unresolved"}. Check recent activity before another send.</p>
          {paymentRecord.txid && <p className="break-all text-xs">Possible transaction ID: {paymentRecord.txid}</p>}
          {paymentError && <p className="text-red-400">{paymentError}</p>}
          <button type="button" className="rounded-full border border-amber-500 px-3 py-2" onClick={() => void clearPayment()}>I checked history; clear warning</button>
        </div>}
        {paymentRecord?.status === "success" && paymentRecord.txid && <p className="break-all text-xs text-daintree-400">Last submitted ZKas payment: {paymentRecord.txid}</p>}
        <button className="w-full rounded-full border border-daintree-700 p-3" onClick={() => navigate("/zkas/settings")}>Configure ZKas daemon</button>
        {(wallet?.type === "privateKey" || wallet?.type === "zkasSeed") && address && (
          <button className="w-full rounded-full border border-daintree-700 p-3" onClick={() => {
            const url = new URL(browser.runtime.getURL("/popup.html"));
            url.hash = `/show-wallet-secret/${wallet.id}/zkas-seed`;
            void browser.tabs.create({ url: url.toString() });
          }}>Back up ZKas spending seed</button>
        )}
        {paymentError && !paymentRecord && <p role="alert" className="text-xs text-red-400">{paymentError}</p>}
        <section aria-label="Recent ZKas activity" className="space-y-2">
          <h2 className="font-semibold">Recent activity</h2>
          {historyError && <p role="alert" className="text-xs text-red-400">{historyError}</p>}
          {history && !history.recoverableHistory && <p className="text-xs text-daintree-400">Recoverable history is disabled on this daemon. Earlier payments may be absent.</p>}
          {history?.pendingOutgoing?.map((row) => <div key={`pending-${row.txid}`} className="rounded-lg bg-daintree-800 p-3 text-xs"><p>Pending send · {showBalance ? `${formatZkasAmount(BigInt(row.amountSompi))} ZKAS` : "*****"}</p><p className="break-all text-daintree-400">{row.txid}</p></div>)}
          {history?.rows.map((row) => <div key={`${row.kind}-${row.txid}`} className="rounded-lg bg-daintree-800 p-3 text-xs"><p>{row.kind === "sent" ? "Sent" : row.kind === "received" ? "Received" : "Coinbase"} · {showBalance ? `${formatZkasAmount(BigInt(row.amountSompi))} ZKAS` : "*****"}</p><p className="break-all text-daintree-400">{row.txid}</p></div>)}
          {history && history.rows.length === 0 && !history.pendingOutgoing?.length && <p className="text-xs text-daintree-400">No recent activity reported by the daemon.</p>}
        </section>
        <p className="text-xs text-daintree-400">Your chosen daemon can see your full viewing key and shielded activity. Kastle keeps the spending seed local.</p>
      </div>
    </div>
  );
}
