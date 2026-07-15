import { Box, Check, Minus } from "lucide-react";

export interface NodeListItemProps {
  name: string;
  url: string;
  /** Built-in / default node — cannot be removed. */
  isDefault?: boolean;
  selected?: boolean;
  /** Edit mode — shows a remove control (custom nodes only). */
  editMode?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
}

export default function NodeListItem({
  name,
  url,
  isDefault = false,
  selected = false,
  editMode = false,
  onSelect,
  onRemove,
}: NodeListItemProps) {
  const canSelect = !editMode && !!onSelect;

  return (
    <div
      onClick={canSelect ? onSelect : undefined}
      onKeyDown={
        canSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
      role={canSelect ? "button" : undefined}
      tabIndex={canSelect ? 0 : undefined}
      className="flex w-full items-center gap-3 rounded-lg py-3.5"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-icy-blue-900">
        <Box size={20} className="text-daintree-400" strokeWidth={2} />
      </div>
      <div className="flex flex-1 flex-col gap-0.5 text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-white">{name}</span>
          {isDefault && (
            <span className="shrink-0 rounded-full bg-daintree-700 px-2 py-0.5 text-xs text-daintree-300">
              Default
            </span>
          )}
        </div>
        <span className="truncate text-xs text-daintree-400">{url}</span>
      </div>
      {editMode ? (
        !isDefault && (
          <button
            type="button"
            onClick={onRemove}
            className="flex size-4 shrink-0 items-center justify-center rounded-full bg-red-500"
          >
            <Minus size={10} className="text-white" strokeWidth={3} />
          </button>
        )
      ) : selected ? (
        <div className="flex size-4 shrink-0 items-center justify-center rounded-full bg-icy-blue-400">
          <Check size={10} className="text-white" strokeWidth={3} />
        </div>
      ) : (
        <div className="size-4 shrink-0 rounded-full border border-daintree-700" />
      )}
    </div>
  );
}
