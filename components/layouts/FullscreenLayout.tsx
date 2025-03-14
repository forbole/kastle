import { Outlet, useNavigation } from "react-router-dom";
import React from "react";
import Splash from "@/components/screens/Splash.tsx";
import "@hackernoon/pixel-icon-library/fonts/iconfont.css";

import "preline/preline";
import { useLocation } from "react-router";
import { Toaster } from "react-hot-toast";
import useResetPreline from "@/hooks/useResetPreline.ts";
import { PostHogWrapperProvider } from "@/contexts/PostHogWrapperProvider.tsx";

export default function FullscreenLayout() {
  const navigation = useNavigation();
  const location = useLocation();
  const { isConnected } = useRpcClientStateful();
  useResetPreline([location.pathname]);

  return (
    <PostHogWrapperProvider>
      <div className="no-scrollbar flex h-screen justify-center overflow-y-scroll bg-icy-blue-900 py-10 font-sans text-white">
        <Toaster position="top-center" containerStyle={{ top: 35 }} />
        {navigation.state === "loading" || !isConnected ? (
          <Splash />
        ) : (
          <Outlet />
        )}
      </div>
    </PostHogWrapperProvider>
  );
}
