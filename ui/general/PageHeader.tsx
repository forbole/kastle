export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  showClose?: boolean;
  onBack?: () => void;
  onClose?: () => void;
}

export default function PageHeader({
  title,
  subtitle,
  showBack = true,
  showClose = false,
  onBack,
  onClose,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col bg-icy-blue-950 pb-6">
      <div className="flex h-[78px] items-center px-8">
        <div className="w-[46px]">
          {showBack && (
            <button
              className="flex size-[46px] items-center justify-center rounded-lg text-white hover:bg-daintree-800"
              onClick={onBack}
            >
              <i className="hn hn-angle-left text-xl" />
            </button>
          )}
        </div>
        <h1 className="flex-1 text-center text-xl font-bold tracking-[0.1px] text-gray-200">
          {title}
        </h1>
        <div className="w-[46px]">
          {showClose && (
            <button
              className="flex size-[46px] items-center justify-center rounded-lg text-white hover:bg-daintree-800"
              onClick={onClose}
            >
              <i className="hn hn-times text-xl" />
            </button>
          )}
        </div>
      </div>
      {subtitle && (
        <p className="px-8 pb-4 text-center text-xs text-daintree-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}
