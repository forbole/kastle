import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { twMerge } from "tailwind-merge";

type Props = {
  title: string;
  titleClassName?: string;
  subtitle?: string;
  showPrevious?: boolean;
  showClose?: boolean;
  /** Figma back button: Lucide chevron-left 20px in a 46px button. */
  lucideBack?: boolean;
  onBack?: () => Promise<void> | void;
  onClose?: () => Promise<void> | void;
} & React.HTMLAttributes<HTMLDivElement>;

export default function GeneralHeader({
  title,
  titleClassName,
  subtitle,
  showPrevious = true,
  showClose = true,
  lucideBack,
  onBack,
  onClose,
  className,
}: Props) {
  const navigate = useNavigate();

  return (
    <div className={twMerge("w-full", !subtitle ? "pb-8" : "pb-6", className)}>
      <div className="flex items-center justify-between">
        {showPrevious ? (
          <button
            className={twMerge(
              "rounded-lg p-3 text-white hover:bg-gray-800",
              lucideBack && "flex size-[46px] items-center justify-center p-0",
            )}
            onClick={async () => {
              if (onBack) {
                await onBack();
              } else {
                navigate(-1);
              }
            }}
          >
            {lucideBack ? (
              <ChevronLeft size={20} strokeWidth={1.5} />
            ) : (
              <i className="hn hn-angle-left flex items-center justify-center text-[1.25rem]" />
            )}
          </button>
        ) : (
          <div className="p-3">
            <div className="h-5 w-5"></div>
          </div>
        )}
        <h1 className={twMerge("text-xl font-bold text-white", titleClassName)}>
          {title}
        </h1>
        {showClose ? (
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
        ) : (
          <div className={twMerge("p-3", lucideBack && "size-[46px] p-0")}>
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
