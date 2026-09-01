import React from "react";

// Shared by the KNS and INS asset screens. Design node 11417:153539 "List
// Group": #051d27 container, #203c49 border, 12px radius, clipped, with
// #102832 striped rows separated by a 1px top border. The container already
// draws the top edge, so the first row drops its own to avoid a 2px line.
export function DetailList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="flex flex-col overflow-clip rounded-[12px] border border-daintree-700 bg-icy-blue-950">
      {children}
    </ul>
  );
}

export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-2 border-t border-daintree-700 bg-daintree-800 px-4 py-3 text-sm font-medium leading-5 text-white first:border-t-0">
      <span>{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </li>
  );
}

// The design puts a 16px external-link glyph to the left of the value. It has
// to sit outside HoverShowAllCopy, whose own onClick copies -- nesting it there
// would make the link copy instead of navigate.
export function ExplorerLink({ url, label }: { url: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => browser.tabs.create({ url })}
    >
      <i className="hn hn-external-link flex items-center text-[16px] text-daintree-400" />
    </button>
  );
}
