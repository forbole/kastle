import badgeVerified from "@/assets/images/badge-verified.svg";
import kaspaLockupMark from "@/assets/images/network-logos/kaspa-lockup-mark.svg";
import kaspaLockupText from "@/assets/images/network-logos/kaspa-lockup-text.svg";
import igraLockup from "@/assets/images/network-logos/igra-lockup.png";

type NameCardProps = {
  name: string;
  source: "kas" | "igra";
  isVerified?: boolean;
  size?: "sm" | "lg";
  onClick: () => void;
};

// The design gives the outer box and the corner radius at both sizes, and
// neither follows the other's ratio (104 -> 166.05 is 1.597x, 12 -> 16 is
// 1.33x), so both stay literal. Everything *inside* the card is only ever
// designed at sm -- the lg hero in Figma is a flattened image fill with no
// layer tree -- so it is derived from the one box ratio, 192/120 = 1.6.
const BOX = {
  sm: { width: 104, height: 120, radius: 12 },
  lg: { width: 166.05, height: 192, radius: 16 },
};
const SCALE = { sm: 1, lg: 1.6 };

// Design steps the name down through four sizes so long names still fit the
// text box. The buckets are length thresholds, so they hold at both sizes: the
// text box scales by the same 1.6, so a name wraps to the same line count.
// Tracking is -2% throughout, which scales for free.
const baseNameSize = (length: number) => {
  if (length <= 12) return 16;
  if (length <= 24) return 14;
  if (length <= 40) return 12;
  return 10;
};

export default function NameCard({
  name,
  source,
  isVerified,
  size = "sm",
  onClick,
}: NameCardProps) {
  const box = BOX[size];
  const px = (value: number) => `${value * SCALE[size]}px`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      style={{
        width: box.width,
        height: box.height,
        borderRadius: box.radius,
      }}
      className="relative shrink-0 overflow-hidden border border-daintree-700 bg-[linear-gradient(201.32deg,#4ADCEF_14.46%,#00D7FF_31.38%,#0095F1_91.32%)] text-left hover:border-white"
    >
      {isVerified && (
        <img
          src={badgeVerified}
          alt="verified"
          // Badge box is 8x8 at right/top 10px; the asset is 14x14 because it
          // carries the drop shadow as a 37.5% bleed on every side. Insetting
          // by 7px lands the 8px glyph back on its designed position, and the
          // bleed is proportional, so scaling the whole box keeps it there.
          style={{
            right: px(7),
            top: px(7),
            width: px(14),
            height: px(14),
          }}
          className="absolute"
        />
      )}

      <div
        style={{ bottom: px(8), width: px(88), gap: px(10) }}
        className="absolute left-1/2 flex -translate-x-1/2 flex-col"
      >
        <span
          style={{
            height: px(50.98),
            fontSize: px(baseNameSize(name.length)),
            textShadow: `0px 0px ${px(4)} rgba(0,19,58,0.4)`,
          }}
          className="overflow-hidden font-bold leading-normal tracking-[-0.02em] text-white [overflow-wrap:anywhere]"
        >
          {name}
        </span>

        {source === "kas" ? (
          // ponytail: two exported leaves rather than one merged file -- the
          // combined Figma export is a padded 39x18 box that would misalign.
          <span
            style={{ height: px(10), width: px(30.8) }}
            className="relative block"
          >
            <img
              src={kaspaLockupMark}
              alt=""
              style={{ height: px(10), width: px(10.0125) }}
              className="absolute left-0 top-0"
            />
            <img
              src={kaspaLockupText}
              alt=""
              style={{
                left: px(13.05),
                top: px(2.51),
                height: px(6.73626),
                width: px(17.7516),
              }}
              className="absolute"
            />
          </span>
        ) : (
          <img
            src={igraLockup}
            alt=""
            style={{
              height: px(10),
              width: px(31.4),
              filter: `drop-shadow(0 0 ${px(4)} rgba(0,19,58,0.4))`,
            }}
          />
        )}
      </div>
    </button>
  );
}
