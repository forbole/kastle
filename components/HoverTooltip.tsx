import React, { useState } from "react";
import { Tooltip } from "react-tooltip";

type HoverTooltipProps = {
  id?: string;
  text: string;
  tooltipWidth?: string;
  style?: React.CSSProperties;
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

export default function HoverTooltip({
  id = "hover",
  text,
  tooltipWidth = "auto",
  style,
  place = "bottom",
  children,
}: HoverTooltipProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Tooltip
        id={id}
        style={{
          backgroundColor: "#203C49",
          fontWeight: 600,
          padding: "8px",
          width: tooltipWidth,
          ...style,
        }}
        opacity={1}
        isOpen={isHovered}
        place={place}
      />
      <div data-tooltip-id={id} data-tooltip-content={text}>
        {children}
      </div>
    </div>
  );
}
