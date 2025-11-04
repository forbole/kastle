import { twMerge } from "tailwind-merge";
import { textEllipsis } from "@/lib/utils";
import Copy from "@/components/Copy";
import HoverShowAll from "@/components/HoverTooltip";

type NameProps = {
  isLoading: boolean;
  name: string;
  owner: string;
};

export default function Name({ isLoading, name, owner }: NameProps) {
  return (
    <div
      className={twMerge(
        "rounded-xl border border-daintree-700 bg-[#102832] p-4",
        isLoading && "h-16 animate-pulse",
      )}
    >
      {!isLoading && (
        <div className="flex flex-col gap-2 rounded-xl bg-[#102832]">
          <div className="flex items-center gap-2 text-sm leading-none">
            <h3>{name}</h3>
            <Copy textToCopy={name} id="copy-nft-name">
              <i className="hn hn-copy cursor-pointer text-[#7B9AAA]"></i>
            </Copy>
          </div>
          <div className="flex items-center gap-2 text-xs leading-none text-[#7B9AAA]">
            <HoverShowAll text={owner} tooltipWidth="22rem">
              {owner && textEllipsis(owner)}
            </HoverShowAll>
            <Copy textToCopy={owner} id="copy-nft-owner">
              <i className="hn hn-copy cursor-pointer text-[#7B9AAA]"></i>
            </Copy>
          </div>
        </div>
      )}
    </div>
  );
}
