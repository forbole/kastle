import { Outlet, useNavigation } from "react-router-dom";
import React from "react";
import Splash from "@/components/screens/Splash.tsx";

export default function RootLayout() {
  const navigation = useNavigation();

  return (
    <div id="root" className="bg-icy-blue-950 font-sans text-white">
      {navigation.state === "loading" ? <Splash /> : <Outlet />}
    </div>
  );
}
