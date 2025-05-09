import { AccountItem } from "@/components/screens/full-pages/account-management/AccountItem";
import { FormProvider, useForm } from "react-hook-form";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "@/components/Toast";
import { ErrorResponse } from "@/lib/service/handlers/error-response";
import { useBoolean } from "usehooks-ts";
import Header from "@/components/GeneralHeader";
import AccountsTitle from "./AccountsTitle";
import { useLocation } from "react-router";

export type AccountsFormValues = Record<
  string,
  {
    publicKeys: string[];
    active: boolean;
  }
>;

export type ListAccountsRequest = {
  walletId: string;
  start: number;
  end: number;
};

type ManageAccountsProps = {
  walletType: "ledger" | "mnemonic";
  listAccounts?: (
    params: ListAccountsRequest,
  ) => Promise<{ publicKeys: string[] }[]>;
};

export default function ManageAccounts({
  walletType,
  listAccounts,
}: ManageAccountsProps) {
  const calledOnce = useRef(false);

  const location = useLocation();
  const navigate = useNavigate();
  const { walletId, action } = useParams();
  const pageSize = 10;
  const [offset, setOffset] = useState(0);

  const {
    value: isFetchingAccounts,
    setTrue: setFetchingAccounts,
    setFalse: setNotFetchingAccounts,
  } = useBoolean();
  const [accountList, setAccountList] = useState<{ publicKeys: string[] }[]>(
    [],
  );
  const { walletSettings, updateSelectedAccounts } = useWalletManager();

  const wallet = walletSettings?.wallets.find(({ id }) => id === walletId);
  const selectedAccountIds = wallet?.accounts.reduce<
    Record<string, { publicKeys: string[]; active: boolean }>
  >((acc, account) => {
    acc[account.index] = {
      publicKeys: account.publicKeys ?? [],
      active: true,
    };
    return acc;
  }, {});

  const form = useForm<AccountsFormValues>({
    values: selectedAccountIds,
  });

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      if (!walletId) {
        throw new Error("Wallet not found");
      }

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
            publicKeys,
          };
        }
        return acc;
      }, {} as AccountsFormValues);

      const response = await updateSelectedAccounts({
        walletId,
        accounts,
      });

      if (ErrorResponse.validate(response)) {
        throw new Error(response.error);
      }

      navigate(location?.state?.redirect ?? "/accounts-imported");
    } catch (error: any) {
      toast.error(error.message);
    }
  });

  const fetchAccountListChunk = async (offset: number) => {
    if (!walletId || !listAccounts) {
      return;
    }

    return await listAccounts({
      walletId: walletId,
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

  useEffect(() => {
    if (!walletSettings || !walletId) {
      return;
    }

    const wallet = walletSettings?.wallets.find(({ id }) => id === walletId);
    if (!wallet) {
      window.close();
    }
  }, [walletSettings, walletId]);

  if (!walletId) {
    window.close();
    return null;
  }

  const subtitle = {
    mnemonic:
      "This page shows accounts created from your recovery phrase. Each phrase can generate multiple accounts, and here you can view and manage them.",
    ledger:
      "This page shows accounts managed by your Ledger. You can select accounts to import and manage in Kastle.",
  }[walletType];

  return (
    <FormProvider {...form}>
      <form
        onSubmit={onSubmit}
        className="flex h-[90vh] w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950 p-8"
      >
        {/* Header */}
        <Header
          title={action === "manage" ? "Manage Accounts" : "Import Accounts"}
          subtitle={subtitle}
          showPrevious={false}
        />

        {/* List */}
        <div className="no-scrollbar flex flex-grow flex-col gap-3 overflow-y-scroll">
          <AccountsTitle />
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
