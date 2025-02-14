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
    className="flex w-full items-center justify-between rounded-xl border border-[#203C49] bg-[#1E343D] p-5 hover:border-white"
    onClick={onClick}
  >
    <div className="flex items-center justify-start gap-4 text-base font-semibold">
      <span className="font-semibold">{title}</span>
    </div>
    <div className="flex items-center text-base">
      {children}
      {showChevron && <i className="hn hn-angle-right text-[1.25rem]" />}
    </div>
  </button>
);
