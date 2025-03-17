import { Outlet, useNavigation } from "react-router-dom";
import React, { useEffect } from "react";
import Splash from "@/components/screens/Splash.tsx";
import "@hackernoon/pixel-icon-library/fonts/iconfont.css";
import { POPUP_WINDOW_HEIGHT, POPUP_WINDOW_WIDTH } from "@/lib/utils";

import "preline/preline";
import { useLocation } from "react-router";
import { Toaster } from "react-hot-toast";
import useResetPreline from "@/hooks/useResetPreline.ts";
import { PostHogWrapperProvider } from "@/contexts/PostHogWrapperProvider.tsx";

export default function PopupLayout() {
  const navigation = useNavigation();
  const location = useLocation();
  useResetPreline([location.pathname]);

  // Resize the window to the target width and height for the popup
  useEffect(() => {
    const widthGap = POPUP_WINDOW_WIDTH - window.innerWidth;
    const heightGap = POPUP_WINDOW_HEIGHT - window.innerHeight;

    window.resizeBy(widthGap, heightGap);
  }, []);
  return (
    <PostHogWrapperProvider>
      <div className="no-scrollbar h-[600px] w-[375px] overflow-y-scroll bg-icy-blue-950 font-sans text-white">
        <Toaster position="top-center" containerStyle={{ top: 35 }} />
        {navigation.state === "loading" ? <Splash /> : <Outlet />}
      </div>
    </PostHogWrapperProvider>
  );
}
