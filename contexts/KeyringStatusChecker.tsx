import { ReactNode, useEffect, createContext } from "react";
import useKeyring from "@/hooks/useKeyring";
import { useNavigate } from "react-router-dom";
import { PostHogWrapperProvider } from "@/contexts/PostHogWrapperProvider.tsx";

const INTERVAL = 2_000;

export const KeyringStatusCheckerContext = createContext(undefined);

export function KeyringStatusCheckerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const keyring = useKeyring();
  const navigate = useNavigate();

  const currentUrl = window.location.hash;
  const currentUrlWithoutHash = currentUrl.startsWith("#")
    ? currentUrl.slice(1)
    : currentUrl;
  const needToRedirect =
    currentUrlWithoutHash.startsWith("/unlock") ||
    currentUrlWithoutHash.startsWith("/browser-api/unlock") ||
    currentUrlWithoutHash.startsWith("/onboarding");

  const redirectUnlock = () => {
    navigate(`/unlock?redirect=${currentUrlWithoutHash}`);
  };

  useEffect(() => {
    const checkKeyringStatus = async () => {
      if (needToRedirect) {
        return;
      }

      try {
        const status = await keyring.getKeyringStatus();

        if (!status.isUnlocked) {
          redirectUnlock();
        }
      } catch (error) {
        redirectUnlock();
      }
    };

    const intervalId = setInterval(checkKeyringStatus, INTERVAL);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <KeyringStatusCheckerContext.Provider value={undefined}>
      {children}
    </KeyringStatusCheckerContext.Provider>
  );
}
