import { useEffect, useState } from "react";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import kasplexIcon from "@/assets/images/network-logos/kasplex.svg";
import igraIcon from "@/assets/images/network-logos/igra.svg";
import type { NetworkType } from "./labels";

// KRC-20 and native KAS carry no corner badge ("KRC20: not adding logo
// identifier"); KCC-20 gets the Kaspa mark, ERC-20 its L2.
const CHAIN_BADGES: Partial<Record<NetworkType, string>> = {
  kcc20: kasIcon,
  kasplexErc20: kasplexIcon,
  igraErc20: igraIcon,
};

/** Token circle with a white underlay (transparent logos) that swaps to `fallback` when `src` fails. */
function TokenCircle({
  src,
  fallback = kasIcon,
  size,
}: {
  src?: string;
  fallback?: string;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <img
      alt=""
      src={!src || failed ? fallback : src}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full bg-white object-cover"
      style={{ width: size, height: size }}
    />
  );
}

export type AssetImageProps =
  | { variant: "single"; image?: string; fallback?: string; size?: number }
  | {
      variant: "chain";
      tokenImage?: string;
      /** Overrides the badge the network would pick. */
      chainImage?: string;
      fallback?: string;
      network?: NetworkType;
      tokenImageSize?: number;
      chainImageSize?: number;
    }
  | {
      variant: "dual";
      fromImage?: string;
      toImage?: string;
      chainImage?: string;
      fallback?: string;
      size?: number;
    };

export default function AssetImage(props: AssetImageProps) {
  if (props.variant === "single") {
    return (
      <TokenCircle
        src={props.image}
        fallback={props.fallback}
        size={props.size ?? 40}
      />
    );
  }

  if (props.variant === "chain") {
    const {
      tokenImage,
      fallback,
      network,
      tokenImageSize = 40,
      chainImageSize = 16,
    } = props;
    const badge =
      network === "krc20" || network === "kaspa"
        ? undefined
        : (props.chainImage ?? (network && CHAIN_BADGES[network]));

    // Figma: the badge sits at left 30 of the 40px logo, overhanging it by 6px.
    return (
      <div
        className="relative shrink-0"
        style={{ width: tokenImageSize + 6, height: tokenImageSize }}
      >
        <TokenCircle
          src={tokenImage}
          fallback={fallback}
          size={tokenImageSize}
        />
        {badge && (
          <img
            alt=""
            src={badge}
            className="absolute bottom-0 right-0 rounded-full border-2 border-icy-blue-900 bg-black object-cover"
            style={{ width: chainImageSize, height: chainImageSize }}
          />
        )}
      </div>
    );
  }

  // Dual: from-token top-left, ringed to-token bottom-right, chain badge on the seam.
  // Ratios are kastle-ui's AssetImage; don't re-derive them from the Figma export.
  const { fromImage, toImage, chainImage, fallback, size = 40 } = props;
  const from = Math.round(0.6 * size);
  const to = Math.round(0.65 * size);
  const ring = Math.max(1, Math.round(0.05 * size));
  const chain = Math.round(0.3 * size);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute left-0 top-0">
        <TokenCircle src={fromImage} fallback={fallback} size={from} />
      </div>
      <div
        className="absolute rounded-full border-icy-blue-900"
        style={{
          right: -ring,
          bottom: Math.round(0.075 * size) - ring,
          borderWidth: ring,
        }}
      >
        <TokenCircle src={toImage} fallback={fallback} size={to} />
      </div>
      {chainImage && (
        <img
          alt=""
          src={chainImage}
          className="absolute rounded-full border border-card-border bg-card-border object-cover"
          style={{
            left: Math.round(0.8 * size),
            bottom: -Math.round(0.025 * size),
            width: chain + 2,
            height: chain + 2,
          }}
        />
      )}
    </div>
  );
}
