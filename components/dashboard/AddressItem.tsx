import { textEllipsis } from "@/lib/utils";
import qrCodeIcon from "@/assets/images/qr-code.svg";
import ClipboardCopy from "./ClipboardCopy";

export default function AddressItem({
  imageUrl,
  chainName,
  address,
}: {
  imageUrl: string;
  chainName: string;
  address: string;
}) {
  return (
    <div className="flex w-[15.75rem] justify-between p-2 pl-3">
      <div className="flex gap-2">
        <img className="h-7 w-7 rounded-full" src={imageUrl} />
        <div>
          <h3 className="text-sm font-semibold">{chainName}</h3>
          <p className="text-xs leading-none text-daintree-400">
            {textEllipsis(address)}
          </p>
        </div>
      </div>
      <div className="gap flex items-center gap-4 pr-2">
        <ClipboardCopy textToCopy={address} className="cursor-pointer" />
        <img
          className="h-4 w-4 cursor-pointer"
          src={qrCodeIcon}
          alt="QR Code"
        />
      </div>
    </div>
  );
}
