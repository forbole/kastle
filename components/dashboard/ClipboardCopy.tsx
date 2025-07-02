import React, { useState } from "react";
import { twMerge } from "tailwind-merge";
import { useCopyToClipboard } from "usehooks-ts";
import { Tooltip } from "react-tooltip";
import { captureException } from "@sentry/react";

type ClipboardCopyProps = {
  textToCopy?: string;
} & React.HTMLAttributes<HTMLDivElement>;

export default function ClipboardCopy({
  textToCopy,
  className,
}: ClipboardCopyProps) {
  const [copied, setCopied] = useState(false);
  const [, copy] = useCopyToClipboard();

  const handleCopy = async () => {
    try {
      if (!textToCopy) {
        return;
      }

      await copy(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 500);
    } catch (err) {
      captureException(err);
      console.error("Failed to copy text:", err);
    }
  };

  return (
    <div className={className} onClick={handleCopy}>
      {/* NOTE: Tooltip does not support tailwind */}
      <Tooltip
        id="clipboard"
        style={{
          backgroundColor: "#203C49",
          fontSize: "12px",
          fontWeight: 600,
          padding: "8px",
        }}
        opacity={1}
        isOpen={copied}
        place="bottom"
      />
      <a
        data-tooltip-id="clipboard"
        data-tooltip-content="Copied"
        className={twMerge(
          "hn flex items-center px-2 text-[16px] text-white",
          copied ? "hn-check" : "hn-copy",
        )}
      />
    </div>
  );
}
