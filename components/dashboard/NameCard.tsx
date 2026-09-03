import badgeVerified from "@/assets/images/badge-verified.svg";
import kaspaLockupMark from "@/assets/images/network-logos/kaspa-lockup-mark.svg";
import kaspaLockupText from "@/assets/images/network-logos/kaspa-lockup-text.svg";
import igraLockup from "@/assets/images/network-logos/igra-lockup.png";

type NameCardProps = {
  name: string;
  source: "kas" | "igra";
  isVerified?: boolean;
  onClick: () => void;
};

// Design steps the name down through four sizes so long names still fit the
// 88px text box. Tracking is -2% at every step.
const nameSize = (length: number) => {
  if (length <= 12) return "text-[16px]";
  if (length <= 24) return "text-[14px]";
  if (length <= 40) return "text-[12px]";
  return "text-[10px]";
};

export default function NameCard({
  name,
  source,
  isVerified,
  onClick,
}: NameCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      className="relative h-[120px] w-[104px] shrink-0 overflow-hidden rounded-[12px] border border-daintree-700 bg-[linear-gradient(201.32deg,#4ADCEF_14.46%,#00D7FF_31.38%,#0095F1_91.32%)] text-left hover:border-white"
    >
      {isVerified && (
        <img
          src={badgeVerified}
          alt="verified"
          // Badge box is 8x8 at right/top 10px; the asset is 14x14 because it
          // carries the drop shadow as a 37.5% bleed on every side. Insetting
          // by 7px lands the 8px glyph back on its designed position.
          className="absolute right-[7px] top-[7px] size-[14px]"
        />
      )}

      <div className="absolute bottom-[8px] left-1/2 flex w-[88px] -translate-x-1/2 flex-col gap-[10px]">
        <span
          className={`h-[50.98px] overflow-hidden font-bold leading-normal tracking-[-0.02em] text-white [overflow-wrap:anywhere] ${nameSize(name.length)}`}
          style={{ textShadow: "0px 0px 4px rgba(0,19,58,0.4)" }}
        >
          {name}
        </span>

        {source === "kas" ? (
          // ponytail: two exported leaves rather than one merged file — the
          // combined Figma export is a padded 39x18 box that would misalign.
          <span className="relative block h-[10px] w-[30.8px]">
            <img
              src={kaspaLockupMark}
              alt=""
              className="absolute left-0 top-0 h-[10px] w-[10.0125px]"
            />
            <img
              src={kaspaLockupText}
              alt=""
              className="absolute left-[13.05px] top-[2.51px] h-[6.73626px] w-[17.7516px]"
            />
          </span>
        ) : (
          <img
            src={igraLockup}
            alt=""
            className="h-[10px] w-[31.4px] [filter:drop-shadow(0_0_4px_rgba(0,19,58,0.4))]"
          />
        )}
      </div>
    </button>
  );
}
