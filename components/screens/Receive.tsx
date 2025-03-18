import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { createCanvas, loadImage } from "canvas";
import { useCopyToClipboard } from "usehooks-ts";
import { Tooltip } from "react-tooltip";
import kasIcon from "@/assets/images/kas-icon.svg";
import Header from "@/components/GeneralHeader";
import { useNavigate } from "react-router-dom";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { captureException } from "@sentry/react";
import KNSMenu from "@/components/receive/KNSMenu.tsx";

const Receive = () => {
  const navigate = useNavigate();
  const [, copy] = useCopyToClipboard();
  const { account } = useWalletManager();
  const address = account?.address;
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");

  const logoSize = 70;
  const generateQR = useCallback(async () => {
    if (!address) {
      return;
    }
    try {
      const canvas = createCanvas(0, 0);
      await QRCode.toCanvas(canvas, address, {
        color: {
          dark: "#000000", // Black dots
          light: "#FFFFFF", // White background
        },
        errorCorrectionLevel: "Q",
      });
      const ctx = canvas.getContext("2d");
      const img = await loadImage(kasIcon);
      const center = canvas.width / 2;
      const logoStartPositionX = center - logoSize / 2;
      const logoStartPositionY = center - logoSize / 2;
      ctx.drawImage(
        img,
        logoStartPositionX,
        logoStartPositionY,
        logoSize,
        logoSize,
      );
      setQrCodeUrl(canvas.toDataURL("image/png"));
    } catch (err) {
      captureException(err);
      console.error("Failed to generate QR code:", err);
    }
  }, [address]);

  useEffect(() => {
    generateQR();
  }, [generateQR]);

  const handleCopy = async () => {
    if (!address) {
      return;
    }

    try {
      await copy(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="flex h-full flex-col justify-between p-6">
      {/* Header */}
      <div>
        <Header
          title="Receive"
          onClose={() => navigate("/dashboard")}
          showPrevious={false}
        />

        {/* QR Code Card */}
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-daintree-700 bg-icy-blue-900 px-4 py-6">
          {/* KNS */}
          <KNSMenu />

          {/* QR Code */}
          <img
            src={qrCodeUrl}
            alt="QR Code"
            className="h-48 w-48 rounded-2xl"
          />

          {/* Token Info */}
          <div className="flex flex-col gap-2 text-center">
            <div className="w-full break-all rounded-lg border border-daintree-700 bg-icy-blue-950 p-3 text-start text-sm">
              {address}
            </div>
          </div>
        </div>
      </div>

      {/* Copy Button */}
      <button
        data-tooltip-id="copy"
        data-tooltip-content="Copied"
        onClick={handleCopy}
        className="rounded-full bg-icy-blue-400 py-4 text-center text-lg font-semibold text-white hover:bg-icy-blue-600"
      >
        <Tooltip
          data-tooltip-id="copy"
          data-tooltip-content="Copied"
          id="copy"
          offset={0}
          style={{
            backgroundColor: "#374151",
            fontSize: "12px",
            fontWeight: 600,
            padding: "2px 8px",
          }}
          isOpen={copied}
        />
        Copy
      </button>
    </div>
  );
};

export default Receive;
