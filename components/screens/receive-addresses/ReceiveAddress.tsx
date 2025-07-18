import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { createCanvas, loadImage } from "canvas";
import { useCopyToClipboard } from "usehooks-ts";
import { Tooltip } from "react-tooltip";
import Header from "@/components/GeneralHeader";
import { useNavigate } from "react-router-dom";
import { captureException } from "@sentry/react";

const Receive = ({
  address,
  chainName,
  iconUrl,
}: {
  address: string;
  chainName: string;
  iconUrl: string;
}) => {
  const navigate = useNavigate();
  const [, copy] = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");

  const logoSize = 44;
  const generateQR = useCallback(async () => {
    if (!address) {
      return;
    }
    try {
      const canvas = createCanvas(192, 192);
      await QRCode.toCanvas(canvas, address, {
        color: {
          dark: "#000000", // Black dots
          light: "#FFFFFF", // White background
        },
        errorCorrectionLevel: "Q",
      });
      const ctx = canvas.getContext("2d");

      ctx.imageSmoothingEnabled = true;

      const img = await loadImage(iconUrl);
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
        <Header title="Receive" onClose={() => navigate("/dashboard")} />

        {/* QR Code Card */}
        <div className="flex flex-col items-center rounded-2xl border border-daintree-700 bg-icy-blue-900 px-4 py-6">
          {/* QR Code */}
          <img
            src={qrCodeUrl}
            alt="QR Code"
            className="h-48 w-48 rounded-2xl"
          />

          <div className="flex flex-col items-center gap-2 pt-6 text-center">
            <h3 className="text-base font-semibold">My {chainName} Address</h3>
            <p className="text-sm text-daintree-400">
              Use it to receive tokens on{" "}
              <span className="text-white">{chainName}</span>
            </p>
          </div>

          {/* Address Info */}
          <div className="flex flex-col pt-4 text-center">
            <div className="w-full break-all rounded-lg border border-daintree-700 bg-icy-blue-950 px-3 py-2 text-start text-sm text-daintree-400">
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
