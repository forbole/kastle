import keyImage from "@/assets/images/key.png";
import Header from "@/components/GeneralHeader";
import { useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { useBoolean } from "usehooks-ts";
import useKeyring from "@/hooks/useKeyring.ts";
import { WalletSecret } from "@/types/WalletSecret";
import { useParams } from "react-router-dom";

type FormValues = {
  password: string;
};

export default function BackupUnlock({
  setSecret,
}: {
  setSecret: (value: WalletSecret) => void;
}) {
  const { walletId } = useParams();
  const { getWalletSecret } = useKeyring();
  const { value: showPassword, toggle } = useBoolean(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit = async (data: FormValues) => {
    try {
      if (!walletId) {
        throw new Error("Wallet ID is missing");
      }

      // get the wallet secret
      const { walletSecret } = await getWalletSecret({
        walletId: walletId,
        password: data.password,
      });

      setSecret(walletSecret);
    } catch (err) {
      setError("password", {
        type: "manual",
        message: (err as Error).message || "Internal error. Please try again.",
      });
    }
  };

  return (
    <div className="flex h-full flex-col rounded-3xl bg-icy-blue-950 px-4 py-6">
      <Header title="Back up" showPrevious={false} />
      <div className="mt-10 flex flex-1 flex-col justify-between">
        <div>
          <img
            src={keyImage}
            alt="key"
            className="mx-auto h-[120px] w-[120px]"
          />
          <div className="mt-5 px-4 text-center">
            <h1 className="text-xl font-bold">
              Ensure no one <br /> is watching your screen 👀
            </h1>
            <p className="mt-2 text-sm text-gray-400">
              Anyone with this phrase can access your wallet and steal your
              funds.
            </p>
          </div>
        </div>

        <div className="w-full">
          {/** Form */}
          <div className="w-full">
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="flex w-full flex-col gap-8"
            >
              <div className="flex w-full flex-col gap-8">
                <div className="relative">
                  <input
                    {...register("password", {
                      required: "Password is required",
                    })}
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    className={twMerge(
                      "w-full rounded-lg border-0 bg-daintree-800 px-4 py-3 placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:ring-0",
                      errors.password &&
                        "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => toggle()}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-300"
                  >
                    <i
                      className={twMerge(
                        "hn flex text-xl text-neutral-400",
                        showPassword ? "hn-eye-cross" : "hn-eye",
                      )}
                    />
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-full bg-icy-blue-400 py-5 text-center text-base font-semibold hover:bg-icy-blue-600"
                >
                  Unlock
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
