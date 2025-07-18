import { textEllipsis } from "@/lib/utils";
import qrCodeIcon from "@/assets/images/qr-code.svg";
import ClipboardCopy from "@/components/dashboard/ClipboardCopy";

export default function SelectAddressItem({
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
    <div className="flex items-center justify-between rounded-lg border border-daintree-700 bg-daintree-800 p-3">
      <div className="flex gap-2">
        <img className="h-10 w-10 rounded-full" src={imageUrl} />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{chainName}</h3>
          <p className="text-xs leading-none text-daintree-400">
            {textEllipsis(address)}
          </p>
        </div>
      </div>
      <div className="gap flex items-center gap-2">
        <ClipboardCopy textToCopy={address} className="cursor-pointer p-4" />
        <div className="cursor-pointer p-4" onClick={redirect}>
          <img className="h-4 w-4" src={qrCodeIcon} alt="QR Code" />
        </div>
      </div>
    </div>
  );
}
