import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import Header from "@/components/GeneralHeader";
import useKeyring from "@/hooks/useKeyring.ts";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { v4 as uuid } from "uuid";

interface PasswordFormData {
  password: string;
  confirmPassword: string;
  agreedTnc: boolean;
}

export default function SetupPassword() {
  const { keyringInitialize } = useKeyring();
  const { createNewWallet } = useWalletManager();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isMismatchShown, setIsMismatchShown] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { isValid, errors },
  } = useForm<PasswordFormData>({
    mode: "onChange",
  });

  const { password, confirmPassword } = watch();
  const passwordMatch = password === confirmPassword;
  const isDisabled = !password || !passwordMatch || !isValid;

  const onSubmit = handleSubmit(async (data) => {
    await keyringInitialize(data.password);
    await createNewWallet(uuid());

    navigate("/success");
  });

  useEffect(() => {
    let timeout: NodeJS.Timeout | undefined;

    const hasMismatch = !passwordMatch && !!confirmPassword;

    if (!hasMismatch) {
      setIsMismatchShown(hasMismatch);
    } else {
      timeout = setTimeout(() => {
        setIsMismatchShown(hasMismatch);
      }, 600);
    }
    return () => clearTimeout(timeout);
  }, [password, confirmPassword, passwordMatch]);

  return (
    <div id="setup-password-screen" className="flex h-full w-full flex-col p-4">
      <Header title="Create a password" />

      <form
        onSubmit={onSubmit}
        className="flex w-full flex-1 flex-col justify-between pt-9"
      >
        <div className="space-y-4">
          <div className="space-y-2 text-lg">
            <label className="text-white">Enter new password</label>
            <div className="relative">
              <input
                tabIndex={0}
                id="hs-strong-password-input"
                {...register("password", { maxLength: 64 })}
                type={showPassword ? "text" : "password"}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-daintree-200 hover:placeholder-daintree-50 focus:border-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
                placeholder="New password"
              />
              <button
                tabIndex={-1}
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2"
              >
                <i
                  className={twMerge(
                    "hn text-xl text-neutral-400",
                    showPassword ? "hn-eye-cross" : "hn-eye",
                  )}
                />
              </button>
            </div>
          </div>

          <div className="space-y-2 text-lg">
            <label className="text-white">Re-enter new password</label>
            <div className="relative">
              <input
                tabIndex={0}
                {...register("confirmPassword", { maxLength: 64 })}
                type={showConfirmPassword ? "text" : "password"}
                className={twMerge(
                  "w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-daintree-200 hover:placeholder-daintree-50 focus:outline-none",
                  isMismatchShown
                    ? "border-red-700 focus:border-red-600 focus:ring-red-800"
                    : "focus:border-gray-600 focus:ring-2 focus:ring-gray-500",
                )}
                placeholder="Confirm password"
              />
              <button
                tabIndex={-1}
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
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
                {(errors.password || errors.confirmPassword) &&
                  "Password too long"}
              </span>
              <span>{isMismatchShown && "Passwords do not match"}</span>
            </div>
          </div>

          <div
            data-hs-strong-password={JSON.stringify({
              target: "#hs-strong-password-input",
              stripClasses:
                "hs-strong-password:bg-[#14B8A6] hs-strong-password-accepted:bg-teal-500 h-2 flex-auto rounded-full bg-gray-700 opacity-100 mx-1",
              minLength: 8,
            })}
            id="hs-strong-password-input"
            className="-mx-1 mt-2 flex"
          />
        </div>

        <div className="flex">
          <input
            {...register("agreedTnc", { required: true })}
            type="checkbox"
            className="mt-0.5 shrink-0 rounded border-neutral-700 bg-neutral-800 text-blue-600 checked:border-icy-blue-400 checked:bg-icy-blue-400 focus:ring-blue-500 focus:ring-offset-gray-800 disabled:pointer-events-none disabled:opacity-50"
            id="agreed-reset"
          />
          <label htmlFor="agreed-reset" className="ms-3 text-sm">
            I agree to the{" "}
            <a
              href="https://kastle.cc/term-and-conditions"
              className="text-icy-blue-400 underline"
              target="_blank"
              rel="noreferrer"
            >
              Term and Conditions
            </a>{" "}
            and{" "}
            <a
              href="https://forbole.com/en/privacy-policy"
              target="_blank"
              className="text-icy-blue-400 underline"
              rel="noreferrer"
            >
              {" "}
              Privacy Policy
            </a>
            .
          </label>
        </div>

        <button
          type="submit"
          className={twMerge(
            "w-full rounded-full py-4 text-base font-semibold",
            isDisabled
              ? "bg-gray-800 text-gray-600"
              : "bg-icy-blue-400 text-white",
          )}
          disabled={isDisabled}
        >
          Next
        </button>
      </form>
    </div>
  );
}
