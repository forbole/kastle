import { Outlet, useNavigation } from "react-router-dom";
import React from "react";
import Splash from "@/components/screens/Splash.tsx";
import "@hackernoon/pixel-icon-library/fonts/iconfont.css";

import "preline/preline";
import { useLocation } from "react-router";
import { Toaster } from "react-hot-toast";
import useResetPreline from "@/hooks/useResetPreline.ts";

export default function PopupLayout() {
  const navigation = useNavigation();
  const location = useLocation();
  useResetPreline([location.pathname]);

  return (
    <div className="h-[600px] w-[375px] bg-icy-blue-950 font-sans text-white">
      <Toaster position="top-center" containerStyle={{ top: 35 }} />
      {navigation.state === "loading" ? <Splash /> : <Outlet />}
    </div>
  );
}
