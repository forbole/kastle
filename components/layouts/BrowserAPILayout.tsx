import { Outlet } from "react-router-dom";
import { POPUP_WINDOW_HEIGHT, POPUP_WINDOW_WIDTH } from "@/lib/utils";
import { useEffect } from "react";
import { ApiUtils } from "@/api/background/utils";
import { ApiExtensionUtils } from "@/api/extension";
import { useSearchParams } from "react-router-dom";

export default function BrowserAPILayout() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get("requestId") ?? "";

  // Resize the window to the target width and height for the popup
  useEffect(() => {
    const widthGap = POPUP_WINDOW_WIDTH - window.innerWidth;
    const heightGap = POPUP_WINDOW_HEIGHT - window.innerHeight;

    window.resizeBy(widthGap, heightGap);
  }, []);

  const denyMessage = ApiUtils.createApiResponse(
    requestId,
    false,
    "User denied",
  );

  useEffect(() => {
    // Handle beforeunload event
    async function beforeunload(event: BeforeUnloadEvent) {
      await ApiExtensionUtils.sendMessage(requestId, denyMessage);
    }

    window.addEventListener("beforeunload", beforeunload);

    return () => {
      window.removeEventListener("beforeunload", beforeunload);
    };
  }, []);

  return <Outlet />;
}
