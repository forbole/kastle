import React from "react";
import Header from "@/components/GeneralHeader";
import { useSettings } from "@/hooks/useSettings";
import { useNavigate } from "react-router-dom";

export default function DevMode() {
  const navigate = useNavigate();
  const [settings, setSettings] = useSettings();

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Header title="Preview mode" onClose={() => navigate("/dashboard")} />
      <div
        className="flex flex-col gap-2 rounded-xl border border-[#7F1D1D] bg-[#381825] p-4 text-base"
        role="alert"
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold text-daintree-200">
            Dev mode will enable experimental features. Features that may not be
            completed nor stable. Only activate if you know what you are doing.
          </span>
        </div>
      </div>

      <div className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-700 bg-slate-800 p-5">
        <div className="flex items-center justify-start gap-4 text-base font-semibold">
          <span className="font-semibold">Dev mode</span>
        </div>
        <div className="flex items-center text-base">
          <input
            checked={settings?.preview ?? false}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, preview: e.target.checked }))
            }
            type="checkbox"
            className="relative h-6 w-11 cursor-pointer rounded-full border-neutral-700 border-transparent bg-neutral-800 p-px text-transparent transition-colors duration-200 ease-in-out before:inline-block before:size-5 before:translate-x-0 before:transform before:rounded-full before:bg-neutral-400 before:shadow before:ring-0 before:transition before:duration-200 before:ease-in-out checked:border-icy-blue-400 checked:bg-icy-blue-400 checked:bg-none checked:text-icy-blue-400 checked:before:translate-x-full checked:before:bg-blue-200 focus:ring-blue-600 focus:ring-offset-gray-600 focus:checked:border-blue-600 disabled:pointer-events-none disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
