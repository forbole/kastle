import React, { useState } from "react";
import { Tooltip } from "react-tooltip";
import { useCopyToClipboard } from "usehooks-ts";

type HoverShowAllProps = {
  id?: string;
  text: string;
  tooltipWidth?: string;
  place?:
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "top-start"
    | "top-end"
    | "bottom-start"
    | "bottom-end"
    | "right-start"
    | "right-end"
    | "left-start"
    | "left-end";
} & React.HTMLAttributes<HTMLDivElement>;

export default function HoverShowAllCopy({
  id = "hover-copy",
  text,
  tooltipWidth = "auto",
  place = "bottom",
  children,
}: HoverShowAllProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = React.useState(false);
  const [, copy] = useCopyToClipboard();

  const hoverDataId = `hover-${id}`;
  const copyDataId = `copy-${id}`;

  const handleCopy = async () => {
    try {
      if (!text) {
        return;
      }

      await copy(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 500);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Tooltip
        id={copyDataId}
        style={{
          backgroundColor: "#203C49",
          fontSize: "12px",
          fontWeight: 600,
          padding: "8px",
        }}
        isOpen={copied}
        place={place}
      />
      <Tooltip
        id={hoverDataId}
        style={{
          backgroundColor: "#203C49",
          fontSize: "12px",
          fontWeight: 600,
          padding: "8px",
          width: tooltipWidth,
          lineBreak: "anywhere",
        }}
        isOpen={isHovered && !copied}
        place={place}
      />
      <div
        data-tooltip-id={hoverDataId}
        data-tooltip-content={text}
        onClick={handleCopy}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div data-tooltip-id={copyDataId} data-tooltip-content="Copied">
          {children}
        </div>
      </div>
    </div>
  );
}
