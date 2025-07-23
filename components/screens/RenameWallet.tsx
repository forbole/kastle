import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import internalToast from "@/components/Toast.tsx";
import Header from "@/components/GeneralHeader";

export default function RenameWallet() {
  const navigate = useNavigate();
  const { renameWallet, walletSettings } = useWalletManager();
  const { walletId } = useParams();

  const wallet = walletSettings?.wallets.find((w) => w.id === walletId);

  const {
    handleSubmit,
    register,
    formState: { isValid },
  } = useForm<{ walletName: string }>({
    values: {
      walletName: wallet?.name ?? `Wallet ${walletId ?? "Name"}`.slice(0, 20),
    },
  });

  const onSubmit = handleSubmit(async ({ walletName }) => {
    if (!walletId) {
      return;
    }

    await renameWallet(walletId, walletName);

    internalToast.success("Wallet has been updated successfully.");

    navigate("/dashboard");
  });

  return (
    <div className="flex h-full flex-col p-4">
      <Header title="Wallet Name" />
      <form className="flex flex-grow flex-col gap-6" onSubmit={onSubmit}>
        <div className="flex h-full flex-col items-stretch gap-6">
          <div className="max-w-sm">
            <label
              htmlFor="wallet-name"
              className="mb-2 block text-sm font-medium dark:text-white"
            >
              Your wallet name
            </label>
            <input
              {...register("walletName", { required: true, maxLength: 20 })}
              type="text"
              id="wallet-name"
              maxLength={20}
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
