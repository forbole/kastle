import React from "react";
import { useNavigate } from "react-router-dom";
import { twMerge } from "tailwind-merge";

type Props = {
  title: string;
  titleClassName?: string;
  subtitle?: string;
  showPrevious?: boolean;
  showClose?: boolean;
  onBack?: () => Promise<void> | void;
  onClose?: () => Promise<void> | void;
  /**
   * "asset": the title is a ticker or a name, so a long one wraps, centred.
   * Back and Close keep their place when it wraps.
   */
  variant?: "default" | "asset";
} & React.HTMLAttributes<HTMLDivElement>;

export default function GeneralHeader({
  title,
  titleClassName,
  subtitle,
  showPrevious = true,
  showClose = true,
  onBack,
  onClose,
  variant = "default",
  className,
}: Props) {
  const navigate = useNavigate();

  return (
    <div className={twMerge("w-full", !subtitle ? "pb-8" : "pb-6", className)}>
      <div
        className={twMerge(
          "flex items-center justify-between",
          variant === "asset" && "items-start",
        )}
      >
        {showPrevious ? (
          <button
            type="button"
            aria-label="Back"
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
          <div className="p-3">
            <div className="h-5 w-5"></div>
          </div>
        )}
        <h1
          className={twMerge(
            "text-xl font-bold text-white",
            // py-2: one line is as tall as a button, so it stays centred on them.
            variant === "asset" &&
              "min-w-0 flex-1 break-words py-2 text-center",
            titleClassName,
          )}
        >
          {title}
        </h1>
        {showClose ? (
          <button
            type="button"
            aria-label="Close"
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
        ) : (
          <div className="p-3">
            <div className="h-5 w-5"></div>
          </div>
        )}
      </div>
      {subtitle && (
        <div className="mx-auto text-center text-xs text-gray-400">
          {subtitle}
        </div>
      )}
    </div>
  );
}
