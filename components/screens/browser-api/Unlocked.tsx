import Header from "@/components/GeneralHeader";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";

export default function Unlocked() {
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";

  const onClose = async () => {
    console.log(requestId);
    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(requestId, true),
    );
    window.close();
  };

  return (
    <div className="flex h-full w-full flex-col justify-between rounded-xl p-4">
      <div className="flex flex-col items-center">
        {/* Header */}
        <Header title={"Unlocked"} showPrevious={false} showClose={false} />

        {/* Message */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white">
            <img
              alt="Unlocked"
              className="h-12 w-12"
              src="/assets/images/success.png"
            />
          </div>
          <p className="text-center text-lg font-semibold">
            Your wallet is now unlocked.
          </p>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 text-base font-semibold">
        <button
          className="flex-auto rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
