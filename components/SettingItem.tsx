import React from "react";

interface SettingItemProps {
  title: string;
  children?: React.ReactNode;
  onClick?: () => void;
  showChevron?: boolean;
}

export const SettingItem = ({
  title,
  children,
  onClick,
  showChevron = false,
}: SettingItemProps) => (
  <button
    type="button"
    className="flex w-full items-center justify-between rounded-xl border border-daintree-700 bg-[#1E343D] p-4 hover:border-white"
    onClick={onClick}
  >
    <div className="flex items-center justify-start gap-4 text-sm font-semibold">
      <span className="font-semibold">{title}</span>
    </div>
    <div className="flex items-center text-sm">
      {children}
      {showChevron && <i className="hn hn-angle-right text-[1.25rem]" />}
    </div>
  </button>
);
