import { textEllipsis } from "@/lib/utils";
import qrCodeIcon from "@/assets/images/qr-code.svg";
import ClipboardCopy from "./ClipboardCopy";

export default function AddressItem({
  imageUrl,
  chainName,
  address,
  redirect,
}: {
  imageUrl: string;
  chainName: string;
  address: string;
  redirect: () => void;
}) {
  return (
    <div className="flex w-[15.75rem] justify-between py-3.5 pl-3 pr-2">
      <div className="flex gap-2">
        <img className="h-7 w-7 rounded-full" src={imageUrl} />
        <div>
          <h3 className="text-sm font-semibold">{chainName}</h3>
          <p className="text-xs font-normal leading-none text-daintree-400">
            {textEllipsis(address)}
          </p>
        </div>
      </div>
      <div className="gap flex items-center gap-2 pr-2">
        <ClipboardCopy textToCopy={address} className="cursor-pointer p-2" />
        <div className="cursor-pointer p-2" onClick={redirect}>
          <img className="h-4 w-4" src={qrCodeIcon} alt="QR Code" />
        </div>
      </div>
    </div>
  );
}
