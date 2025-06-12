import Header from "@/components/GeneralHeader";
import warningImage from "@/assets/images/warning.png";
import { ApiUtils } from "@/api/background/utils";
import { ApiExtensionUtils } from "@/api/extension";
import { RPC_ERRORS } from "@/api/message";

export default function UnsupportedNetwork({
  requestId,
}: {
  requestId: string;
}) {
  const onConfirm = async () => {
    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(requestId, null, RPC_ERRORS.UNSUPPORTED_CHAIN),
    );
    window.close();
  };

  return (
    <div className="h-screen p-4">
      <Header
        showPrevious={false}
        showClose={false}
        title="Unsupported Network"
      />
      <img src={warningImage} alt="Warning" className="mx-auto" />
      <div className="mt-12 space-y-16 text-center">
        <h3 className="text-xl font-semibold">
          The selected evm layer2 network is not supported by Kastle.
        </h3>
        <button
          onClick={onConfirm}
          className="rounded-full bg-icy-blue-400 p-5 px-8 text-base font-semibold hover:bg-icy-blue-600"
        >
          Close
        </button>
      </div>
    </div>
  );
}
