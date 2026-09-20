import { useNavigate } from "react-router-dom";
import type {
  WalletInfo,
  WalletSettings,
} from "@/contexts/WalletManagerContext";
import type { ZKasSwitchAccount } from "@/lib/zkas/selection";
import { textEllipsis } from "@/lib/utils";
import WalletHeader from "./WalletHeader";

type Props = {
  wallets: WalletInfo[];
  accounts: ZKasSwitchAccount[];
  walletSettings: WalletSettings;
  onSelectAccount: (walletId: string, accountIndex: number) => Promise<void>;
};

export function ZKasWalletSection({
  wallets,
  accounts,
  walletSettings,
  onSelectAccount,
}: Props) {
  const navigate = useNavigate();
  const visibleWallets = wallets.filter((wallet) =>
    accounts.some((account) => account.walletId === wallet.id),
  );

  return (
    <section aria-label="ZKas wallets" className="flex flex-col gap-3">
      {visibleWallets.map((wallet) => {
        const menuItems = [
          {
            label:
              wallet.type === "mnemonic"
                ? "Back up recovery phrase"
                : "Back up ZKas spending seed",
            onClick: () => {
              const url = new URL(browser.runtime.getURL("/popup.html"));
              url.hash = `/show-wallet-secret/${wallet.id}/${wallet.type === "mnemonic" ? "mnemonic" : "zkas-seed"}`;
              void browser.tabs.create({ url: url.toString() });
            },
          },
          {
            label: "Remove this wallet",
            onClick: () => navigate(`/remove-wallet/${wallet.id}`),
            isAlert: true,
          },
        ];
        return (
          <div
            key={wallet.id}
            className="hs-accordion-group rounded-xl border border-daintree-700 p-2"
          >
            <div className="hs-accordion active">
              <WalletHeader wallet={wallet} items={menuItems} />
              <div className="hs-accordion-content flex w-full flex-col gap-2 overflow-hidden transition-[height] duration-300">
                {accounts
                  .filter((entry) => entry.walletId === wallet.id)
                  .map((entry) => {
                    const account = wallet.accounts.find(
                      (item) => item.index === entry.accountIndex,
                    );
                    if (!account) return null;
                    const selected =
                      walletSettings.selectedWalletId === wallet.id &&
                      walletSettings.selectedAccountIndex ===
                        entry.accountIndex;
                    return (
                      <button
                        key={entry.accountIndex}
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        onClick={() =>
                          void onSelectAccount(wallet.id, entry.accountIndex)
                        }
                        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left hover:border-white ${selected ? "border-icy-blue-400" : "border-daintree-700"}`}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-sm font-semibold">
                          {account.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">
                            {account.name}
                          </span>
                          <span className="block text-xs text-daintree-400">
                            {textEllipsis(entry.address)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        );
      })}
      {!visibleWallets.length && (
        <p className="px-2 text-sm text-daintree-200">
          No ZKas wallets yet. Import a spending seed or use a recovery phrase
          wallet.
        </p>
      )}
    </section>
  );
}
