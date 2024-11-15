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
  <div
    className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-700 bg-slate-800 p-5"
    onClick={onClick}
  >
    <div className="flex items-center justify-start gap-4 text-base font-semibold">
      <span className="font-semibold">{title}</span>
    </div>
    <div className="flex items-center text-base">
      {children}
      {showChevron && <i className="hn hn-angle-right text-[1.25rem]" />}
    </div>
  </div>
);
