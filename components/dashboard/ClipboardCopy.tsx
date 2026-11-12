import React, { useState } from "react";
import { twMerge } from "tailwind-merge";
import { useCopyToClipboard } from "usehooks-ts";
import { Tooltip } from "react-tooltip";
import { captureException } from "@sentry/react";

type ClipboardCopyProps = {
  textToCopy?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export default function ClipboardCopy({
  textToCopy,
  className,
  children,
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
    // a native button: focusable, answers Enter and Space
    <button
      type="button"
      className={className}
      onClick={handleCopy}
      aria-label={children ? undefined : "Copy"}
    >
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
        wrapper="span"
      />
      <span
        data-tooltip-id="clipboard"
        data-tooltip-content="Copied"
        className={twMerge(
          "hn flex items-center text-[16px] leading-none text-white",
          copied ? "hn-check" : "hn-copy",
        )}
      />
      {children}
    </button>
  );
}
