import React, { useState } from "react";
import { Tooltip } from "react-tooltip";

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

export default function HoverShowAll({
  id = "hover",
  text,
  tooltipWidth = "auto",
  place = "bottom",
  children,
}: HoverShowAllProps) {
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
          fontSize: "12px",
          fontWeight: 600,
          padding: "8px",
          width: tooltipWidth,
          lineBreak: "anywhere",
        }}
        isOpen={isHovered}
        place={place}
      />
      <div data-tooltip-id={id} data-tooltip-content={text}>
        {children}
      </div>
    </div>
  );
}
