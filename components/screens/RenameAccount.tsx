import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import chestImage from "@/assets/images/chest.png";
import internalToast from "@/components/Toast.tsx";
import Header from "@/components/GeneralHeader";
import useAccountManager from "@/hooks/wallet/useAccountManager";
import useWalletManager from "@/hooks/wallet/useWalletManager";

export default function RenameAccount() {
  const navigate = useNavigate();
  const { walletSettings } = useWalletManager();
  const { renameAccount } = useAccountManager();
  const { walletId, accountIndex } = useParams();
  const accountIndexNumber = accountIndex
    ? parseInt(accountIndex, 10)
    : undefined;

  const account = walletSettings?.wallets.find(
    (wallet) => wallet.id === walletId,
  )?.accounts[accountIndexNumber ?? 0];

  const {
    handleSubmit,
    register,
    formState: { isValid },
  } = useForm<{ accountName: string }>({
    values: {
      accountName: account?.name ?? `Account ${accountIndex ?? 1}`,
    },
  });

  const onSubmit = handleSubmit(async ({ accountName }) => {
    try {
      if (
        !walletId ||
        accountIndexNumber === undefined ||
        Number.isNaN(accountIndexNumber)
      ) {
        return;
      }

      await renameAccount({
        name: accountName,
        walletId,
        accountIndex: accountIndexNumber,
      });

      internalToast.success("Account has been updated successfully.");

      navigate("/dashboard");
    } catch (error) {
      internalToast.error("Failed to rename account");
    }
  });

  return (
    <div className="flex h-full flex-col p-4">
      <Header title="Account Name" />
      <form className="flex flex-grow flex-col gap-6" onSubmit={onSubmit}>
        <div className="flex h-full flex-col items-stretch gap-6">
          <div className="flex h-[168px] w-[168px] items-center justify-center self-center rounded-full bg-daintree-800">
            <img alt="castle" className="h-[90px] w-[120px]" src={chestImage} />
          </div>

          <div className="max-w-sm">
            <label
              htmlFor="account-name"
              className="mb-2 block text-sm font-medium dark:text-white"
            >
              Your account name
            </label>
            <input
              {...register("accountName", { required: true, maxLength: 12 })}
              type="text"
              id="account-name"
              maxLength={12}
              className="w-full rounded-lg border-0 bg-daintree-800 px-4 py-3 ring-0 focus:ring-0"
            />
          </div>

          <button
            type="submit"
            className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white transition-colors disabled:bg-daintree-800 disabled:text-[#4B5563]"
            disabled={!isValid}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
