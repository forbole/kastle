import castleImage from "@/assets/images/castle.png";
import kastleBanner from "@/assets/images/kastle-banner.svg";

export interface WelcomePageProps {
  subtitle?: string;
  title?: string;
  primaryButtonLabel?: string;
  secondaryButtonLabel?: string;
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
}

export default function WelcomePage({
  subtitle = "Welcome to Kastle",
  title = "Your Secure & Fast Kaspa Wallet",
  primaryButtonLabel = "Create new wallet",
  secondaryButtonLabel = "Import existing wallet",
  onPrimaryClick,
  onSecondaryClick,
}: WelcomePageProps) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-icy-blue-900">
      <div className="flex h-[752px] w-[624px] flex-col items-center justify-between rounded-3xl bg-icy-blue-950 pt-16">
        <div className="flex w-full flex-col items-center gap-10">
          <img alt="Kastle" className="h-5 w-[111px]" src={kastleBanner} />
          <div className="flex w-full flex-col items-center gap-6">
            <img
              alt="castle"
              className="h-[228px] w-[228px]"
              src={castleImage}
            />
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-base font-medium tracking-[0.08px] text-daintree-400">
                {subtitle}
              </p>
              <p className="text-2xl font-semibold tracking-[0.12px] text-gray-200">
                {title}
              </p>
            </div>
          </div>
        </div>
        <div className="flex w-full flex-col gap-3 px-10 py-6">
          <button
            className="flex w-full items-center justify-center rounded-full bg-icy-blue-400 px-5 py-[22px] text-[15px] font-semibold tracking-[0.075px] text-white"
            onClick={onPrimaryClick}
          >
            {primaryButtonLabel}
          </button>
          <button
            className="flex w-full items-center justify-center rounded-full border border-daintree-400 px-5 py-[22px] text-[15px] font-semibold tracking-[0.075px] text-daintree-200"
            onClick={onSecondaryClick}
          >
            {secondaryButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
