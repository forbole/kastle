import { useBoolean } from "usehooks-ts";
import { twMerge } from "tailwind-merge";
import { WalletInfo } from "@/contexts/WalletManagerContext.tsx";
import EditableWalletName from "./EditableWalletName";
import HoverTooltip from "../HoverTooltip";

type WalletHeaderProps = {
  wallet: WalletInfo;
  children?: React.ReactNode;
  items?: MenuItem[];
};

type MenuItem = {
  label: string;
  onClick: () => void;
  isAlert?: boolean;
};

export default function WalletHeader({
  wallet,
  items = [],
}: WalletHeaderProps) {
  // This is a hack, preline could not handle `hs-accordion-active:` on nested tags
  const { value: collapsed, toggle } = useBoolean(false);

  return (
    <div className="flex items-center justify-end pl-2">
      {!wallet.backed ? (
        <>
          <HoverTooltip
            text="Please back up your recovery phrase 📜."
            place="top"
            className="mr-auto"
          >
            <EditableWalletName wallet={wallet} />
          </HoverTooltip>
        </>
      ) : (
        <EditableWalletName wallet={wallet} />
      )}

      <button
        type="button"
        className="hs-accordion-toggle h-[38px] w-[38px]"
        onClick={toggle}
      >
        <i
          className={twMerge(
            "hn text-[16px]",
            collapsed ? "hn-angle-down" : "hn-angle-up",
          )}
        ></i>
      </button>
      <div className="hs-dropdown relative">
        <button type="button" className="hs-dropdown-toggle h-[38px] w-[38px]">
          <i className="hn hn-ellipses-vertical text-[16px]"></i>
        </button>
        <div
          className="hs-dropdown-menu duration z-10 mt-2 hidden divide-neutral-700 rounded-lg border border-daintree-700 bg-daintree-800 opacity-0 shadow-md transition-[opacity,margin] before:absolute before:-top-4 before:start-0 before:h-4 before:w-full after:absolute after:-bottom-4 after:start-0 after:h-4 after:w-full hs-dropdown-open:opacity-100"
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="hs-dropdown-default"
        >
          <div className="space-y-0.5 p-1">
            {items?.map((item, index) => (
              <button
                key={index}
                type="button"
                onClick={item.onClick}
                className={twMerge(
                  "flex w-full items-center gap-x-3.5 rounded-lg px-3 py-2 text-sm text-daintree-200 hover:bg-daintree-700 focus:bg-daintree-700 focus:outline-none",
                  item.isAlert && "text-red-500",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
