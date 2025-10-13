import { Outlet, useNavigate, useNavigation } from "react-router-dom";
import React, { useEffect } from "react";
import Splash from "@/components/screens/Splash.tsx";
import "@hackernoon/pixel-icon-library/fonts/iconfont.css";

import "preline/preline";
import { useLocation } from "react-router";
import { Toaster } from "react-hot-toast";
import useResetPreline from "@/hooks/useResetPreline.ts";
import { KEYRING_CHANGE_TIME } from "@/lib/keyring-manager.ts";

type FullscreenLayoutProps = {
  listenKeyring?: boolean;
};

export default function FullscreenLayout({
  listenKeyring = false,
}: FullscreenLayoutProps) {
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isConnected } = useRpcClientStateful();
  const [unlockTime] = useStorageState(
    `local:${KEYRING_CHANGE_TIME}`,
    Date.now(),
  );
  useResetPreline([location.pathname]);

  useEffect(() => {
    if (location.pathname === "/wallet-locked-alert") {
      return;
    }

    const checkWalletStatus = async () => {
      const keyringStatusResponse = await getKeyringStatus();

      if (
        !keyringStatusResponse.isUnlocked ||
        !keyringStatusResponse.isInitialized
      ) {
        const urlSearchParams = new URLSearchParams();
        urlSearchParams.set("redirect", location.pathname);

        return navigate(`/wallet-locked-alert?${urlSearchParams.toString()}`);
      }

      return null;
    };

    if (listenKeyring) {
      checkWalletStatus();
    }
  }, [unlockTime]);

  return (
    <div className="no-scrollbar flex h-screen justify-center overflow-y-scroll bg-icy-blue-900 py-10 font-sans text-white">
      <Toaster position="top-center" containerStyle={{ top: 35 }} />
      {navigation.state === "loading" || !isConnected ? <Splash /> : <Outlet />}
    </div>
  );
}
