import { Outlet, useLocation } from "react-router-dom";
import { POPUP_WINDOW_HEIGHT, POPUP_WINDOW_WIDTH } from "@/lib/utils";
import { useEffect } from "react";
import {
  browserApiPopupDeadline,
  type ZKasPopupPhase,
} from "./browser-api-timeout";

export default function BrowserAPILayout() {
  const { pathname } = useLocation();
  // Resize the window to the target width and height for the popup
  useEffect(() => {
    const widthGap = POPUP_WINDOW_WIDTH - window.innerWidth;
    const heightGap = POPUP_WINDOW_HEIGHT - window.innerHeight;

    window.resizeBy(widthGap, heightGap);
  }, []);

  useEffect(() => {
    const openedAt = Date.now();
    let phase: ZKasPopupPhase = { kind: "idle", at: openedAt };
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timeout);
      timeout = setTimeout(
        () => window.close(),
        Math.max(
          0,
          browserApiPopupDeadline(pathname, openedAt, phase) - Date.now(),
        ),
      );
    };
    const onPhase = (event: Event) => {
      const kind = (event as CustomEvent<ZKasPopupPhase["kind"]>).detail;
      if (pathname !== "/zkas-send" || (kind !== "busy" && kind !== "done"))
        return;
      phase = { kind, at: Date.now() };
      schedule();
    };
    window.addEventListener("zkas-payment-phase", onPhase);
    schedule();
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("zkas-payment-phase", onPhase);
    };
  }, [pathname]);

  return <Outlet />;
}
