import React from "react";
import { useNavigate } from "react-router-dom";
import { twMerge } from "tailwind-merge";

type Props = {
  title: string;
  subtitle?: string;
  showPrevious?: boolean;
  showClose?: boolean;
  onBack?: () => Promise<void> | void;
  onClose?: () => Promise<void> | void;
};

export default function GeneralHeader({
  title,
  subtitle,
  showPrevious = true,
  showClose = true,
  onBack,
  onClose,
}: Props) {
  const navigate = useNavigate();

  return (
    <div className={twMerge("w-full", !subtitle ? "pb-8" : "pb-6")}>
      <div className="flex items-center justify-between">
        {showPrevious || onBack ? (
          <button
            className="rounded-lg p-3 text-white hover:bg-gray-800"
            onClick={async () => {
              if (onBack) {
                await onBack();
              } else {
                navigate(-1);
              }
            }}
          >
            <i className="hn hn-angle-left flex items-center justify-center text-[1.25rem]" />
          </button>
        ) : (
          <div className="h-5 w-5"></div>
        )}
        <h1 className="text-xl font-bold text-white">{title}</h1>
        <div>
          {showClose && (
            <button
              className="rounded-lg p-3 text-white hover:bg-gray-800"
              onClick={async () => {
                if (onClose) {
                  await onClose();
                } else {
                  window.close();
                }
              }}
            >
              <i className="hn hn-times flex items-center justify-center text-[1.25rem]" />
            </button>
          )}
        </div>
      </div>
      {subtitle && (
        <div className="mx-auto w-[27.75rem] text-center text-xs text-gray-400">
          {subtitle}
        </div>
      )}
    </div>
  );
}
