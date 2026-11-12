import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";

export interface ManageAssetsMenuProps {
  /** Opens the Manage Assets page. The menu closes itself after calling this. */
  onManageAssets: () => void;
  /** Only the Assets tab has anything to manage: the parent passes false on NFT, Names and Text. */
  isVisible?: boolean;
  /** Starts open. Meant for Storybook; the menu owns its open state. */
  defaultOpen?: boolean;
}

export const MANAGE_ASSETS_LABEL = "Manage Assets";

/**
 * Settings icon at the right end of the dashboard tab row, with a one-item
 * dropdown. Click toggles it; click outside or Esc closes it.
 * The parent places it in the tab row (its dropdown anchors to its right edge).
 */
export default function ManageAssetsMenu({
  onManageAssets,
  isVisible = true,
  defaultOpen = false,
}: ManageAssetsMenuProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Menu-button pattern: focus moves to the first item when the menu opens.
    itemRef.current?.focus();
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setIsOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  if (!isVisible) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={MANAGE_ASSETS_LABEL}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex size-[38px] items-center justify-center rounded-lg text-white hover:bg-daintree-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
      >
        <Settings aria-hidden="true" className="size-4" />
      </button>
      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 w-[148px] rounded-xl border border-daintree-700 bg-daintree-800 p-2 shadow-[0px_10px_8px_0px_rgba(0,0,0,0.04),0px_4px_3px_0px_rgba(0,0,0,0.1)]"
        >
          <button
            ref={itemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onManageAssets();
            }}
            className="flex w-full items-center whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium text-daintree-200 hover:bg-daintree-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
          >
            {MANAGE_ASSETS_LABEL}
          </button>
        </div>
      )}
    </div>
  );
}
