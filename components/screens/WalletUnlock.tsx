import React from "react";
import { useForm } from "react-hook-form";
import castleImage from "@/assets/images/castle.png";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBoolean } from "usehooks-ts";
import kastleBanner from "@/assets/images/kastle-banner.png";
import { twMerge } from "tailwind-merge";
import useKeyring from "@/hooks/useKeyring.ts";

type FormValues = {
  password: string;
};

export default function WalletUnlock() {
  const [searchParams] = useSearchParams();
  const { keyringUnlock } = useKeyring();
  const navigate = useNavigate();
  const { value: showPassword, toggle } = useBoolean(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit = async (data: FormValues) => {
    try {
      const response = await keyringUnlock(data.password);

      if (!response.success) {
        setError("password", {
          type: "manual",
          message: "Incorrect password. Please try again.",
        });
        return;
      }

      const redirect = searchParams.get("redirect");

      return navigate(redirect ?? "/dashboard");
    } catch {
      setError("password", {
        type: "manual",
        message: "Incorrect password. Please try again.",
      });
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex h-[600px] w-[375px] flex-col items-center justify-between px-4 py-6">
        {/** Header */}
        <div className="space-y-6">
          <div className="flex items-center justify-center gap-2">
            <img alt="bank" className="h-[20px] w-[112px]" src={kastleBanner} />
          </div>
          <img alt="castle" className="h-[229px] w-[229px]" src={castleImage} />
          <h3 className="text-center text-lg text-[#a8a09c]">Welcome back</h3>
        </div>
        {/** Form */}
        <div className="w-full">
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex w-full flex-col gap-4"
          >
            <div className="flex w-full flex-col gap-6">
              <div className="relative mb-6">
                <input
                  {...register("password", {
                    required: "Password is required",
                  })}
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  className={twMerge(
                    "w-full rounded-lg border bg-slate-800 px-4 py-3 focus:outline-none",
                    errors.password
                      ? "border-red-500 focus:border-red-500 focus:ring-red-600"
                      : "border-zinc-700 focus:border-zinc-700 focus:ring-zinc-600",
                  )}
                />
                <button
                  type="button"
                  onClick={() => toggle()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-300"
                >
                  <i
                    className={twMerge(
                      "hn text-[20px]",
                      showPassword ? "hn-eye-cross" : "hn-eye",
                    )}
                  ></i>
                </button>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-full bg-icy-blue-400 py-5 text-center text-base font-semibold"
              >
                Unlock
              </button>
            </div>
          </form>
          <div className="mt-4 flex justify-center text-base font-semibold text-gray-400">
            <button onClick={() => navigate("/password-lost")}>
              Forgot password
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
