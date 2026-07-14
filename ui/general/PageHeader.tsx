export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  showClose?: boolean;
  onBack?: () => void;
  onClose?: () => void;
  /** Icon class for a right-side action button (e.g. "hn hn-pencil"). Takes precedence over showClose. */
  rightIcon?: string;
  onRightAction?: () => void;
  paddingX?: string;
  paddingBottom?: string;
}

export default function PageHeader({
  title,
  subtitle,
  showBack = true,
  showClose = false,
  onBack,
  onClose,
  rightIcon,
  onRightAction,
  paddingX = "px-4",
  paddingBottom = "pb-0",
}: PageHeaderProps) {
  return (
    <div className={`flex flex-col bg-icy-blue-950 ${paddingBottom}`}>
      <div className={`flex h-[78px] items-center ${paddingX}`}>
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
        <div className="relative flex flex-1 flex-col items-center">
          <h1 className="text-center text-xl font-bold tracking-[0.1px] text-gray-200">
            {title}
          </h1>
          {subtitle && (
            <p className="absolute top-full w-full pt-1 text-center text-xs text-daintree-400">
              {subtitle}
            </p>
          )}
        </div>
        <div className="w-[46px]">
          {rightIcon ? (
            <button
              className="flex size-[46px] items-center justify-center rounded-lg text-white hover:bg-daintree-800"
              onClick={onRightAction}
            >
              <i className={`${rightIcon} text-xl`} />
            </button>
          ) : (
            showClose && (
              <button
                className="flex size-[46px] items-center justify-center rounded-lg text-white hover:bg-daintree-800"
                onClick={onClose}
              >
                <i className="hn hn-times text-xl" />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
