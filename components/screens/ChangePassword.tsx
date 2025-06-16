import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import Header from "@/components/GeneralHeader";
import useKeyring from "@/hooks/useKeyring.ts";
import toast from "@/components/Toast.tsx";

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function ChangePassword() {
  const { keyringCheckPassword, keyringChangePassword } = useKeyring();
  const navigate = useNavigate();
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting, isValid, errors },
  } = useForm<PasswordFormData>({
    mode: "onChange",
  });

  const { currentPassword, newPassword, confirmPassword } = watch();
  const passwordMatch = newPassword === confirmPassword;
  const isDisabled =
    !currentPassword || !newPassword || !passwordMatch || !isValid;
  const isMismatchShown = !passwordMatch && !!confirmPassword;

  const onSubmit = handleSubmit(async (data) => {
    await keyringChangePassword({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
    });

    toast.success("Password has been changed successfully");
    navigate("/settings");
  });

  const validateCurrentPassword = async (currentPassword: string) => {
    if (currentPassword === "") return undefined;
    const { success } = await keyringCheckPassword({
      password: currentPassword,
    });

    if (!success) {
      return "Incorrect current password";
    }

    return undefined;
  };

  return (
    <div id="setup-password-screen" className="flex h-full w-full flex-col p-4">
      <Header
        title="Change password"
        subtitle="This password encrypts your wallet."
        onClose={() => navigate("/dashboard")}
      />

      <form
        onSubmit={onSubmit}
        className="flex w-full flex-1 flex-col justify-between"
      >
        <div className="space-y-4">
          <div className="space-y-2 text-lg">
            <label className="text-base text-white">
              Enter current password
            </label>
            <div className="relative">
              <input
                tabIndex={0}
                {...register("currentPassword", {
                  validate: validateCurrentPassword,
                })}
                type={showCurrentPassword ? "text" : "password"}
                className="w-full rounded-lg border-0 bg-daintree-800 px-4 py-3 text-white placeholder-daintree-400 focus:outline-none focus:ring-2 focus:ring-gray-500"
                placeholder="Current password"
              />
              <button
                tabIndex={-1}
                type="button"
                onClick={() => setShowCurrentPassword((prev) => !prev)}
                className="absolute right-4 top-1/2 -translate-y-1/2"
              >
                <i
                  className={twMerge(
                    "hn text-xl text-neutral-400",
                    showCurrentPassword ? "hn-eye-cross" : "hn-eye",
                  )}
                />
              </button>
            </div>
            {!!errors.currentPassword && (
              <div className="flex min-h-5 flex-col gap-1 text-sm text-red-500">
                <span>{errors.currentPassword.message}</span>
              </div>
            )}
          </div>

          <div className="space-y-2 text-lg">
            <label className="text-base text-white">Enter new password</label>
            <div className="relative">
              <input
                tabIndex={0}
                id="hs-strong-password-input"
                {...register("newPassword", { maxLength: 64 })}
                type={showNewPassword ? "text" : "password"}
                className="w-full rounded-lg border-0 bg-daintree-800 px-4 py-3 text-white placeholder-daintree-400 focus:outline-none focus:ring-2 focus:ring-gray-500"
                placeholder="New password"
              />
              <button
                tabIndex={-1}
                type="button"
                onClick={() => setShowNewPassword((prev) => !prev)}
                className="absolute right-4 top-1/2 -translate-y-1/2"
              >
                <i
                  className={twMerge(
                    "hn text-xl text-neutral-400",
                    showNewPassword ? "hn-eye-cross" : "hn-eye",
                  )}
                />
              </button>
            </div>
          </div>

          <div className="space-y-2 text-lg">
            <label className="text-base text-white">Confirm new password</label>
            <div className="relative">
              <input
                tabIndex={0}
                {...register("confirmPassword", { maxLength: 64 })}
                type={showConfirmPassword ? "text" : "password"}
                className={twMerge(
                  "w-full rounded-lg bg-daintree-800 px-4 py-3 text-white placeholder-daintree-400 focus:outline-none",
                  isMismatchShown
                    ? "border border-red-700 focus:border-red-600 focus:ring-red-800"
                    : "border-0 focus:ring-2 focus:ring-gray-500",
                )}
                placeholder="Confirm password"
              />
              <button
                tabIndex={-1}
                type="button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                className="absolute right-4 top-1/2 -translate-y-1/2"
              >
                <i
                  className={twMerge(
                    "hn text-xl text-neutral-400",
                    showConfirmPassword ? "hn-eye-cross" : "hn-eye",
                  )}
                />
              </button>
            </div>
            <div className="flex min-h-5 flex-col gap-1 text-sm text-red-500">
              <span>
                {(errors.newPassword || errors.confirmPassword) &&
                  "Password too long"}
              </span>
              <span>{isMismatchShown && "Passwords do not match"}</span>
            </div>
          </div>

          <div
            data-hs-strong-password={JSON.stringify({
              target: "#hs-strong-password-input",
              stripClasses:
                "hs-strong-password:bg-[#14B8A6] hs-strong-password-accepted:bg-teal-500 h-2 flex-auto rounded-full bg-daintree-700 opacity-100 mx-1",
              minLength: 8,
            })}
            id="hs-strong-password-input"
            className="-mx-1 mt-2 flex"
          />
          <div className="text-xs text-daintree-400">
            Use a mix of letters, numbers and symbols to better protect your
            wallet in case your device is compromised
          </div>
        </div>

        <button
          type="submit"
          className={twMerge(
            "w-full rounded-full py-4 text-base font-semibold",
            isDisabled
              ? "bg-daintree-800 text-gray-600"
              : "bg-icy-blue-400 text-white",
          )}
          disabled={isDisabled}
        >
          {isSubmitting ? (
            <div
              className="inline-block size-4 animate-spin self-center rounded-full border-[4px] border-current border-t-[#A2F5FF] text-icy-blue-600"
              role="status"
              aria-label="loading"
            />
          ) : (
            "Save"
          )}
        </button>
      </form>
    </div>
  );
}
