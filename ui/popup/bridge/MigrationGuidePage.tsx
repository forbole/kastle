import { forwardRef, useEffect, useRef, useState } from "react";
import { ChevronRight, ExternalLink, Info, Shield } from "lucide-react";
import { twMerge } from "tailwind-merge";
import PageHeader from "@/ui/general/PageHeader";
import Button from "@/ui/general/Button";

export interface MigrationGuidePageProps {
  /** Header back on step 1. Back on step 2 returns to step 1 inside the page. */
  onBack: () => void;
  onClose: () => void;
  onOpenKatBridge: () => void;
}

type Step = 1 | 2;

interface BridgeStep {
  title: React.ReactNode;
  note?: string;
  /** Single-line title with no note: number badge centres on the row. */
  centered?: boolean;
}

const accent = "text-icy-blue-400";

// Cyan words in a step title are the exact on-screen labels on KAT Bridge.
const BRIDGE_STEPS: BridgeStep[] = [
  {
    title: (
      <>
        Click <span className={accent}>Connect Kaspa wallet</span> in
        Destination
      </>
    ),
    note: "Max works once your wallet is connected.",
  },
  {
    title: (
      <>
        Choose your token and its <span className={accent}>Source</span>
      </>
    ),
    note: "KRC-20 on Kaspa, or ERC-20 on Igra or Kasplex.",
  },
  { title: "Enter the amount to move", centered: true },
  {
    title: "Choose how much to burn",
    note: "Burning reduces the supply and is permanent. At 0% you keep the full amount. Do your research before you choose.",
  },
  { title: "Check the destination is your Kastle address" },
  {
    title: (
      <>
        Tick the one-way agreement, then click{" "}
        <span className={twMerge(accent, "whitespace-nowrap")}>
          Review migration
        </span>
      </>
    ),
  },
  {
    title: "Approve the transactions in Kastle",
    note: "2 for KRC-20, 1 for ERC-20. Check the token and amount each time.",
  },
];

function StepDots({ step }: { step: Step }) {
  return (
    <div
      role="img"
      aria-label={`Step ${step} of 2`}
      className="flex items-center justify-center gap-2"
    >
      {([1, 2] as const).map((n) => (
        <span
          key={n}
          className={twMerge(
            "h-2 rounded-full",
            n === step ? "w-5 bg-icy-blue-400" : "w-2 bg-daintree-700",
          )}
        />
      ))}
    </div>
  );
}

function StandardBadge({
  label,
  highlighted = false,
}: {
  label: string;
  highlighted?: boolean;
}) {
  return (
    <span
      className={twMerge(
        "inline-flex items-center whitespace-nowrap rounded-full px-3.5 py-[11px] text-xs font-medium leading-4 tracking-[0.06px]",
        highlighted
          ? "bg-icy-blue-700/30 text-icy-blue-400"
          : "bg-white/5 text-white",
      )}
    >
      {label}
    </span>
  );
}

function IntroStep() {
  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-2">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-medium leading-6 tracking-[0.08px] text-white">
          What&apos;s changing for KRC-20 and ERC-20 tokens
        </h2>
        <div className="flex flex-col text-sm leading-5 tracking-[0.07px] text-daintree-300">
          <p>
            KCC-20 is the new token standard on Kaspa L1, and projects are
            moving their KRC-20 and ERC-20 tokens to it. The move happens on KAT
            Bridge, a separate website. It&apos;s one‑way and final.
          </p>
          <p>
            Moving is your choice. Some tokens have a deadline, so check your
            token&apos;s announcement.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-2xl border border-daintree-700 bg-daintree-800 px-4 py-6">
        <div className="flex flex-1 flex-col items-center gap-1.5">
          <span className="text-xs leading-4 text-daintree-400">From</span>
          <StandardBadge label="KRC-20 / ERC-20" />
        </div>
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.5}
          className="mt-[31px] size-5 shrink-0 self-start text-icy-blue-400"
        />
        <div className="flex flex-1 flex-col items-center gap-1.5">
          <span className="text-xs leading-4 text-daintree-400">To</span>
          <StandardBadge label="KCC-20" highlighted />
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Info
          aria-hidden="true"
          strokeWidth={1.5}
          className="size-4 shrink-0 text-daintree-300"
        />
        <p className="text-xs leading-4 tracking-[0.06px] text-daintree-300">
          Keep about <span className="font-semibold text-gray-200">10 KAS</span>{" "}
          in your wallet for fees (estimate)
        </p>
      </div>
    </div>
  );
}

const BridgeSteps = forwardRef<HTMLHeadingElement>(
  function BridgeSteps(_props, headingRef) {
    return (
      <div className="flex flex-col gap-3 px-4">
        <div className="flex flex-col gap-2">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-medium leading-6 tracking-[0.08px] text-white outline-none"
          >
            Follow these steps on KAT Bridge
          </h2>
          <p className="text-sm leading-5 tracking-[0.07px] text-daintree-300">
            It opens in a new tab.
          </p>
        </div>
        <ol className="flex flex-col gap-2 rounded-2xl border border-daintree-700 bg-daintree-800 px-3 py-3">
          {BRIDGE_STEPS.map((s, i) => (
            <li key={i} className="flex flex-col gap-2">
              {i > 0 && (
                <div aria-hidden="true" className="h-px bg-daintree-700" />
              )}
              <div
                className={twMerge(
                  "flex gap-2",
                  s.centered ? "items-center" : "items-start",
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-medium leading-4 text-white">
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-sm font-medium leading-5 tracking-[0.07px] text-white">
                    {s.title}
                  </p>
                  {s.note && (
                    <p className="text-xs leading-4 tracking-[0.06px] text-daintree-400">
                      {s.note}
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  },
);

export default function MigrationGuidePage({
  onBack,
  onClose,
  onOpenKatBridge,
}: MigrationGuidePageProps) {
  const [step, setStep] = useState<Step>(1);
  const stepTwoHeading = useRef<HTMLHeadingElement>(null);

  // Next and Open KAT Bridge are different nodes (keys below), so focus must
  // be placed explicitly: on the step 2 heading, never on the new CTA, so a
  // second Enter cannot open KAT Bridge without reading step 2.
  useEffect(() => {
    if (step === 2) stepTwoHeading.current?.focus();
  }, [step]);

  return (
    <div className="flex h-full flex-col bg-icy-blue-950 font-sans text-white">
      <PageHeader
        title="Move to KCC-20"
        showBack
        showClose
        onBack={() => (step === 2 ? setStep(1) : onBack())}
        onClose={onClose}
      />
      <div key={step} className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {step === 1 ? <IntroStep /> : <BridgeSteps ref={stepTwoHeading} />}
      </div>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-2">
        {step === 2 && (
          <div className="flex items-center gap-2">
            <Shield
              aria-hidden="true"
              strokeWidth={1.5}
              className="size-4 shrink-0 text-daintree-300"
            />
            <p className="text-xs font-medium leading-4 tracking-[0.06px] text-daintree-400">
              Kastle never asks for your seed phrase.
            </p>
          </div>
        )}
        {step === 1 ? (
          <Button key="next" onClick={() => setStep(2)}>
            Next
          </Button>
        ) : (
          <Button key="open-kat-bridge" onClick={onOpenKatBridge}>
            Open KAT Bridge
            <ExternalLink
              aria-hidden="true"
              strokeWidth={1.5}
              className="ml-2.5 size-3.5"
            />
          </Button>
        )}
        <StepDots step={step} />
        <p aria-live="polite" className="sr-only">
          Step {step} of 2
        </p>
      </div>
    </div>
  );
}
