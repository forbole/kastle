import { useState } from "react";
import PageHeader from "@/ui/general/PageHeader";

export type PasswordStrength = 0 | 1 | 2 | 3 | 4 | 5;

function calcStrength(password: string): PasswordStrength {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score as PasswordStrength;
}

const STRENGTH_COLORS: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-orange-400",
  3: "bg-yellow-400",
  4: "bg-teal-400",
  5: "bg-teal-400",
};

export interface CreatePasswordPageProps {
  title?: string;
  subtitle?: string;
  passwordLabel?: string;
  confirmPasswordLabel?: string;
  passwordPlaceholder?: string;
  confirmPasswordPlaceholder?: string;
  hint?: string;
  termsUrl?: string;
  privacyUrl?: string;
  buttonLabel?: string;
  error?: string;
  onBack?: () => void;
  onSubmit?: (password: string) => void;
}

export default function CreatePasswordPage({
  title = "Create Password",
  subtitle = "This password encrypts your wallet.",
  passwordLabel = "Enter new password",
  confirmPasswordLabel = "Re-enter new password",
  passwordPlaceholder = "New password",
  confirmPasswordPlaceholder = "New password",
  hint = "Use a mix of letters, numbers and symbols to better protect your wallet in case your device is compromised",
  termsUrl = "https://kastle.cc/term-and-conditions",
  privacyUrl = "https://kastle.cc/privacy-policy",
  buttonLabel = "Next",
  error,
  onBack,
  onSubmit,
}: CreatePasswordPageProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);

  const strength = calcStrength(password);
  const mismatch = confirm.length > 0 && password !== confirm;
  const disabled = !password || password !== confirm || !termsChecked;

  return (
    <div className="flex h-full w-full items-center justify-center bg-icy-blue-900">
      <div className="flex h-[752px] w-[624px] flex-col justify-between overflow-clip rounded-3xl bg-icy-blue-950">
        <div className="flex flex-col gap-4">
          <PageHeader
            onBack={onBack}
            showBack
            showClose={false}
            subtitle={subtitle}
            title={title}
          />

          <div className="flex flex-col gap-14 px-10">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4">
                  <label className="text-[15px] font-medium tracking-[0.075px] text-gray-200">
                    {passwordLabel}
                  </label>
                  <div className="relative">
                    <input
                      className="w-full rounded-lg bg-daintree-800 px-4 py-3.5 text-[15px] font-medium text-white placeholder-daintree-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-daintree-600"
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={passwordPlaceholder}
                      type={showPassword ? "text" : "password"}
                      value={password}
                    />
                    <button
                      className="absolute right-4 top-1/2 -translate-y-1/2"
                      onClick={() => setShowPassword((v) => !v)}
                      type="button"
                    >
                      <i
                        className={`hn ${showPassword ? "hn-eye-cross" : "hn-eye"} text-base text-daintree-400`}
                      />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <label className="text-[15px] font-medium tracking-[0.075px] text-gray-200">
                    {confirmPasswordLabel}
                  </label>
                  <div className="relative">
                    <input
                      className={`w-full rounded-lg bg-daintree-800 px-4 py-3.5 text-[15px] font-medium text-white placeholder-daintree-400 shadow-sm focus:outline-none focus:ring-2 ${
                        mismatch
                          ? "ring-2 ring-red-500 focus:ring-red-500"
                          : "focus:ring-daintree-600"
                      }`}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder={confirmPasswordPlaceholder}
                      type={showConfirm ? "text" : "password"}
                      value={confirm}
                    />
                    <button
                      className="absolute right-4 top-1/2 -translate-y-1/2"
                      onClick={() => setShowConfirm((v) => !v)}
                      type="button"
                    >
                      <i
                        className={`hn ${showConfirm ? "hn-eye-cross" : "hn-eye"} text-base text-daintree-400`}
                      />
                    </button>
                  </div>
                  {(mismatch || error) && (
                    <p className="text-sm text-red-500">
                      {error ?? "Passwords do not match"}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      className="h-2.5 flex-1 rounded-full bg-daintree-700"
                      key={i}
                    >
                      {i <= strength && (
                        <div
                          className={`h-full w-full rounded-full ${STRENGTH_COLORS[strength]}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs leading-4 tracking-[0.06px] text-daintree-400">
                  {hint}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center justify-center px-10 pb-4">
            <label className="flex cursor-pointer items-start gap-3 text-xs leading-4 tracking-[0.06px]">
              <input
                checked={termsChecked}
                className="mt-0.5 shrink-0 rounded border-daintree-700 bg-icy-blue-950 text-icy-blue-400 focus:ring-0"
                onChange={(e) => setTermsChecked(e.target.checked)}
                type="checkbox"
              />
              <span className="text-daintree-400">
                By going on, you agree to our{" "}
                <a
                  className="text-icy-blue-400 underline"
                  href={termsUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  className="text-icy-blue-400 underline"
                  href={privacyUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Privacy Policy.
                </a>
              </span>
            </label>
          </div>

          <div className="px-10 pb-6">
            <button
              className={`w-full rounded-full py-[22px] text-[15px] font-semibold tracking-[0.075px] transition-colors ${
                disabled
                  ? "bg-daintree-800 text-daintree-600"
                  : "bg-icy-blue-400 text-white"
              }`}
              disabled={disabled}
              onClick={() => !disabled && onSubmit?.(password)}
              type="button"
            >
              {buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
