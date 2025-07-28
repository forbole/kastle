import { AccountItem } from "@/components/screens/full-pages/account-management/AccountItem";
import { FormProvider, useForm } from "react-hook-form";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "@/components/Toast";
import { useBoolean } from "usehooks-ts";
import Header from "@/components/GeneralHeader";
import { useLocation } from "react-router";
import AdvancedSettingsModal from "./AdvancedSettingsModal";
import { WalletInfo } from "@/contexts/WalletManagerContext";
import useAccountManager from "@/hooks/wallet/useAccountManager";
import useWalletEditor from "@/hooks/wallet/useWalletEditor";
import { PublicKey } from "@/wasm/core/kaspa";
import { useSettings } from "@/hooks/useSettings";
import { twMerge } from "tailwind-merge";

export type AccountsFormValues = Record<
  string,
  {
    address: string;
    publicKeys: string[];
    evmPublicKey?: `0x${string}`;
    active: boolean;
  }
>;

export type ListAccountsRequest = {
  walletId: string;
  start: number;
  end: number;
};

type ManageAccountsProps = {
  listAccounts?: (
    params: ListAccountsRequest,
  ) => Promise<{ publicKeys: string[] }[]>;

  wallet: WalletInfo;
  isLegacyWalletEnabled: boolean;
  toggleLegacyWallet: () => void;
};

export default function ManageAccounts({
  wallet,
  listAccounts,
  isLegacyWalletEnabled,
  toggleLegacyWallet,
}: ManageAccountsProps) {
  const calledOnce = useRef(false);

  const [settings] = useSettings();
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { action } = useParams();
  const pageSize = 10;
  const [offset, setOffset] = useState(0);

  const {
    value: isFetchingAccounts,
    setTrue: setFetchingAccounts,
    setFalse: setNotFetchingAccounts,
  } = useBoolean();
  const [accountList, setAccountList] = useState<
    { publicKeys: string[]; evmPublicKey?: `0x${string}` }[]
  >([]);
  const { setLegacyWalletEnabled } = useWalletEditor();
  const { updateSelectedAccounts } = useAccountManager();

  const selectedAccountIds = wallet?.accounts.reduce<
    Record<
      string,
      {
        address: string;
        publicKeys: string[];
        evmPublicKey?: `0x${string}`;
        active: boolean;
      }
    >
  >((acc, account) => {
    acc[account.index] = {
      address: account.address,
      publicKeys: account.publicKeys ?? [],
      evmPublicKey: account.evmPublicKey ?? undefined,
      active: true,
    };
    return acc;
  }, {});

  const form = useForm<AccountsFormValues>({
    values: selectedAccountIds,
  });

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      // Fill the publicKeys to the accounts object, or the accounts would be missing the public keys
      const accounts = Object.entries(data).reduce((acc, [index, value]) => {
        if (value.active) {
          const accountIndex = parseInt(index, 10);
          const publicKeys =
            accountList[accountIndex]?.publicKeys ||
            selectedAccountIds?.[index]?.publicKeys;

          if (!publicKeys) {
            throw new Error("Public keys not found");
          }

          acc[index] = {
            active: value.active,
            address: new PublicKey(publicKeys[0])
              .toAddress(settings?.networkId ?? "mainnet")
              .toString(),
            publicKeys,
            evmPublicKey: accountList[accountIndex].evmPublicKey,
          };
        }
        return acc;
      }, {} as AccountsFormValues);

      await updateSelectedAccounts({
        walletId: wallet.id,
        accounts,
      });

      await setLegacyWalletEnabled(wallet.id, isLegacyWalletEnabled);

      navigate(location?.state?.redirect ?? "/accounts-imported");
    } catch (error: any) {
      toast.error(error.message);
    }
  });

  const fetchAccountListChunk = async (offset: number) => {
    if (!wallet.id || !listAccounts) {
      return;
    }

    return await listAccounts({
      walletId: wallet.id,
      start: offset,
      end: offset + pageSize,
    });
  };

  const nextPage = async () => {
    if (isFetchingAccounts) {
      return;
    }

    setFetchingAccounts();

    try {
      const list = await fetchAccountListChunk(offset);

      // If the list is empty, it means the setting is not prepared yet
      if (list) {
        setAccountList((prevState) => [...prevState, ...list]);
        setOffset((prevState) => prevState + pageSize);
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setNotFetchingAccounts();
    }
  };

  // First fetch
  useEffect(() => {
    if (!calledOnce.current && listAccounts) {
      nextPage();
      calledOnce.current = true;
    }
  }, [listAccounts]);

  const subtitle = {
    mnemonic:
      "These accounts are generated from your recovery phrase. Each one supports both Kaspa (KAS) and EVM networks, so you can add them to Kastle.",
    ledger:
      "These accounts are generated from your Ledger device. Each one supports Kaspa (KAS), so you can add them to Kastle.",
    privateKey: "", // Not used in this context
  }[wallet.type];

  return (
    <FormProvider {...form}>
      <form
        onSubmit={onSubmit}
        className="relative flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950 p-8"
      >
        {/* Header */}
        <Header
          title={action === "manage" ? "Manage Accounts" : "Import Accounts"}
          subtitle={subtitle}
          showPrevious={false}
          showClose={false}
          className={twMerge(isLegacyWalletEnabled ? "pb-0" : "pb-5")}
        />

        {isLegacyWalletEnabled && (
          <div
            className="-mx-8 w-full bg-[#854D0E]/30 py-1 text-center text-yellow-500"
            style={{
              width: "calc(100% + 4rem)",
            }}
          >
            Showing legacy addresses
          </div>
        )}

        {/* Advanced Settings Button */}
        <div className="flex justify-end pr-4 text-base font-semibold">
          <button
            onClick={() => setShowAdvancedSettings(true)}
            type="button"
            className="flex items-center gap-2 text-sm text-slate-300 transition-colors hover:text-cyan-400"
          >
            <span>Advanced Settings</span>
            <i className="hn hn-cog" />
          </button>
        </div>

        {/* Advanced Settings Modal */}
        <AdvancedSettingsModal
          isOpen={showAdvancedSettings}
          onClose={() => setShowAdvancedSettings(false)}
          isLegacyWalletEnabled={isLegacyWalletEnabled}
          toggleLegacyWallet={() => toggleLegacyWallet()}
        />

        {/* List */}
        <div className="no-scrollbar flex flex-grow flex-col gap-3 overflow-y-scroll">
          {accountList.length === 0 &&
            Array.from({ length: pageSize }).map((_, index) => (
              <div
                key={index}
                className="min-h-16 animate-pulse rounded-xl bg-[#203C49]"
              />
            ))}
          {accountList.map(({ publicKeys }, accountIndex) => (
            <AccountItem
              key={accountIndex}
              accountIndex={accountIndex}
              publicKeys={publicKeys}
              evmPublicKey={accountList[accountIndex].evmPublicKey}
            />
          ))}

          <button
            type="button"
            className="inline-flex items-center justify-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700 hover:text-blue-400 focus:bg-blue-100 focus:bg-blue-800/30 focus:text-blue-400 disabled:pointer-events-none disabled:opacity-50"
            onClick={nextPage}
          >
            {isFetchingAccounts ? (
              <div
                className="inline-block size-6 animate-spin self-center rounded-full border-[6px] border-current border-t-[#A2F5FF] text-icy-blue-600"
                role="status"
                aria-label="loading"
              />
            ) : (
              <>
                <i className="hn hn-angle-down text-[14px]" />
                <span>Show more</span>
              </>
            )}
          </button>
        </div>

        <button
          type="submit"
          className="mt-auto inline-flex w-full justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
        >
          {action === "manage" ? "Update" : "Import Wallet"}
        </button>
      </form>
    </FormProvider>
  );
}
