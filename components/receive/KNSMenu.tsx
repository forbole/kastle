import { useCopyToClipboard } from "usehooks-ts";
import { Tooltip } from "react-tooltip";
import { useDomainsByAddress } from "@/hooks/useKns.ts";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { useEffect } from "react";
import Copy from "@/components/Copy";

export default function KNSMenu() {
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, copy] = useCopyToClipboard();
  const [selectedDomain, setSelectedDomain] = useState<string>();
  const callOnce = useRef(false);

  const { account } = useWalletManager();
  const { data: response } = useDomainsByAddress(account?.address ?? "");

  const domains = response?.data.assets.map((asset) => asset.asset) ?? [];

  const copyDomain = () => {
    if (!selectedDomain) {
      return;
    }

    copy(selectedDomain);
    setCopied(true);
    setTimeout(() => setCopied(false), 500);
  };

  useEffect(() => {
    if (callOnce.current) {
      return;
    }

    if (domains.length) {
      setSelectedDomain(domains[0]);
      callOnce.current = true;
    }
  }, [domains]);

  return (
    selectedDomain && (
      <div className="relative">
        <div className="flex h-12 w-[14rem] items-center justify-start rounded-lg border border-[#203C49] bg-[#051D27]">
          <Copy textToCopy={selectedDomain} id="copy" place="bottom">
            <i className="hn hn-copy cursor-pointer p-4 text-base text-[#7B9AAA]"></i>
          </Copy>
          <div
            className="flex w-full cursor-pointer items-center justify-between"
            onClick={() => setShowMenu(!showMenu)}
          >
            <span className="flex-1 text-sm text-white">{selectedDomain}</span>
            <i className="hn hn-chevron-down p-4 text-base text-[#7B9AAA]"></i>
          </div>
        </div>

        {showMenu && (
          <div className="no-scrollbar absolute left-0 top-14 max-h-36 w-[14rem] overflow-hidden overflow-y-scroll rounded-lg border border-[#203C49] bg-[#102832]">
            {domains.map((domain) => (
              <div
                key={domain}
                className="flex cursor-pointer items-center justify-start p-4 hover:bg-[#203C49]"
                onClick={() => {
                  setSelectedDomain(domain);
                  setShowMenu(false);
                }}
              >
                <span className="text-sm text-[#C1D5DE]">{domain}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  );
}
