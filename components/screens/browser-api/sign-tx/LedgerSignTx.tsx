import { SignTxPayload } from "@/api/message";
import LedgerNotSupported from "@/components/screens/browser-api/sign/LedgerNotSupported";
import { useEffect } from "react";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate } from "react-router-dom";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiResponse } from "@/api/message";

type LedgerSignTxProps = {
  requestId: string;
  payload: SignTxPayload;
};

export default function LedgerSignTx({
  requestId,
  payload,
}: LedgerSignTxProps) {
  if (payload.scripts) {
    ApiExtensionUtils.sendMessage(
      requestId,
      new ApiResponse(
        requestId,
        null,
        "Ledger does not support advanced scripts signing",
      ),
    );
    return <LedgerNotSupported />;
  }

  const navigate = useNavigate();
  const { transport, isAppOpen } = useLedgerTransport();

  useEffect(() => {
    if (!transport || !isAppOpen) {
      const currentUrl = new URL(window.location.href);
      navigate({
        pathname: "/ledger-connect-for-sign",
        search: `?redirect=${currentUrl}`,
      });
      return;
    }
  }, [transport]);

  return <>Not Supported</>;
}
