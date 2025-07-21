import { useBoolean } from "usehooks-ts";
import { twMerge } from "tailwind-merge";
import { WalletInfo } from "@/contexts/WalletManagerContext.tsx";
import { Tooltip } from "react-tooltip";

type WalletHeaderProps = {
  wallet: WalletInfo;
  children?: React.ReactNode;
  items?: MenuItem[];
};

type MenuItem = {
  label: string;
  onClick: () => void;
};

export default function WalletHeader({
  wallet,
  items = [],
}: WalletHeaderProps) {
  // This is a hack, preline could not handle `hs-accordion-active:` on nested tags
  const { value: collapsed, toggle } = useBoolean(false);

  return (
    <div className="flex items-center justify-end">
      <div className="mr-auto flex items-center">
        <span className="mr-auto px-2 text-sm font-semibold">
          {wallet.name}
        </span>
        {!wallet.backed && (
          <a
            data-tooltip-id="backup-wallet"
            data-tooltip-content="Please back up your recovery phrase 📜."
          >
            <Tooltip
              data-tooltip-id="backup-wallet"
              id="backup-wallet"
              offset={0}
              style={{
                backgroundColor: "#374151",
                fontSize: "12px",
                fontWeight: 600,
                padding: "2px 8px",
              }}
            />
            <i className="hn hn-exclamation-triangle-solid text-[#EAB308]"></i>
          </a>
        )}
      </div>
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
                className="flex w-full items-center gap-x-3.5 rounded-lg px-3 py-2 text-sm text-daintree-200 hover:bg-daintree-700 focus:bg-daintree-700 focus:outline-none"
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
