export interface ActionSheetProps {
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}

export default function ActionSheet({
  isOpen,
  onClose,
  children,
}: ActionSheetProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative rounded-t-3xl border border-daintree-700 bg-daintree-800 px-5 pb-8 pt-2">
        <div className="flex justify-center py-1">
          <div className="h-1 w-16 rounded-full bg-daintree-600" />
        </div>
        {children}
      </div>
    </div>
  );
}
