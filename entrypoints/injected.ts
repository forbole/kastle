import { KastleBrowserAPI } from "@/api/browser";
import kastleIcon from "@/assets/images/kastle-icon.svg";
import { EthereumBrowserAPI } from "@/api/ethereum";

declare global {
  interface Window {
    ethereum?: EthereumBrowserAPI;
  }
}

export default defineUnlistedScript(() => {
  // One provider instance: request({ method, params }) + on/removeListener.
  // window.kastle is the backward-compatible vendor alias; KCC-12 discovery
  // (kaspa:announceProvider) will announce this same object once merged.
  const provider = new KastleBrowserAPI();
  Object.assign(window, { kastle: provider });

  handleEIP6963();
});

function handleEIP6963() {
  function extensionIdToUUID(extensionId: string) {
    return [
      extensionId.slice(0, 8),
      extensionId.slice(8, 12),
      extensionId.slice(12, 16),
      extensionId.slice(16, 20),
      extensionId.slice(20, 32),
    ].join("-");
  }

  const info = {
    uuid: extensionIdToUUID("oambclflhjfppdmkghokjmpppmaebego"),
    name: "Kastle",
    icon: kastleIcon,
    rdns: "https://kastle.cc/",
  };

  const provider = new EthereumBrowserAPI();

  // Also assign to window.ethereum for dApps that don't support EIP-6963
  if (!window.ethereum) {
    Object.assign(window, { ethereum: provider });
  }

  const announceEvent = new CustomEvent("eip6963:announceProvider", {
    detail: Object.freeze({
      info,
      provider,
    }),
  });

  window.dispatchEvent(announceEvent);

  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(announceEvent);
  });
}
