import { Outlet } from "react-router-dom";
import { POPUP_WINDOW_HEIGHT, POPUP_WINDOW_WIDTH } from "@/lib/utils";
import { useEffect } from "react";

export default function BrowserAPILayout() {
  // Resize the window to the target width and height for the popup
  useEffect(() => {
    const widthGap = POPUP_WINDOW_WIDTH - window.innerWidth;
    const heightGap = POPUP_WINDOW_HEIGHT - window.innerHeight;

    window.resizeBy(widthGap, heightGap);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      window.close();
    }, 180_000); // Close the popup after 3 minutes

    return () => clearTimeout(timeout);
  }, []);

  return <Outlet />;
}
