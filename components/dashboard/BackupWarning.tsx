import { useState } from "react";
import useBackupWarning from "@/hooks/useBackupWarning";
import useWalletManager from "@/hooks/wallet/useWalletManager";

export default function BackupWarning() {
  const { showWarning } = useBackupWarning();
  const { wallet } = useWalletManager();
  const [dismissed, setDismissed] = useState(false);
  if (!showWarning || dismissed) return null;

  return (
    <div className="absolute bottom-0 left-0 z-10 m-3 flex flex-col gap-2 rounded-xl border border-[#713F12] bg-[#281704] p-4 text-base" role="alert">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-daintree-200">✋ Hold on, Your Majesty! 👑</span>
        <button type="button" onClick={() => setDismissed(true)}><i className="hn hn-times text-[16px] text-[#854D0E]" /></button>
      </div>
      <span className="text-sm text-daintree-400">
        Please back up your recovery phrase 📜. It’s the 🗝️ key to accessing your Kastle if you lose your password or reinstall your browser or extension 🌐
      </span>
      <button
        type="button"
        className="inline-flex items-center gap-x-2 self-start rounded-lg border border-transparent bg-[#854D0E]/30 px-4 py-3 text-sm font-medium text-[#EAB308] hover:bg-[#854D0E]/20 focus:bg-[#854D0E4D] focus:outline-none disabled:pointer-events-none disabled:opacity-50"
        onClick={() => {
          if (!wallet) return;
          const url = new URL(browser.runtime.getURL("/popup.html"));
          url.hash = `/show-wallet-secret/${wallet.id}/mnemonic`;
          void browser.tabs.create({ url: url.toString() });
        }}
      >
        Back up now <i className="hn hn-angle-right" />
      </button>
    </div>
  );
}
