import { KastleBrowserAPI } from "@/api/browser";
import kastleIcon from "@/assets/images/kastle-icon.svg";
import { EthereumBrowserAPI } from "@/api/ethereum";

export default defineUnlistedScript(() => {
  // Add the kastle object to window
  Object.assign(window, { kastle: new KastleBrowserAPI() });

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
