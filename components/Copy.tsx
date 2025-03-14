import React from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { Tooltip } from "react-tooltip";

type CopyProps = {
  textToCopy: string;
  id?: string;
  place?: "top" | "bottom" | "left" | "right";
} & React.HTMLAttributes<HTMLDivElement>;

export default function Copy({
  textToCopy,
  id = "copy",
  children,
  place = "bottom",
}: CopyProps) {
  const [copied, setCopied] = React.useState(false);
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
      console.error("Failed to copy text:", err);
    }
  };

  return (
    <div onClick={handleCopy}>
      <Tooltip
        id={id}
        style={{
          backgroundColor: "#203C49",
          fontSize: "12px",
          fontWeight: 600,
          padding: "8px",
        }}
        isOpen={copied}
        place={place}
      />
      <div data-tooltip-id={id} data-tooltip-content="Copied">
        {children}
      </div>
    </div>
  );
}
