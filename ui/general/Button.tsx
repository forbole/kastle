import { twMerge } from "tailwind-merge";

export interface ButtonProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  /** md = 46px (bottom nav actions like "Add custom node" / "Done"); lg = 62px (form CTA like "Add"). */
  size?: "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}

export default function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  onClick,
  type = "button",
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={twMerge(
        "flex w-full items-center justify-center rounded-full text-sm font-semibold text-white",
        size === "md" ? "h-[46px]" : "h-[62px]",
        variant === "primary" ? "bg-icy-blue-400" : "border border-white",
        (disabled || loading) && "opacity-60",
      )}
    >
      {loading ? (
        <span
          role="status"
          aria-label="loading"
          className="inline-block size-5 animate-spin self-center rounded-full border-[3px] border-current border-t-icy-blue-200 text-icy-blue-600"
        />
      ) : (
        children
      )}
    </button>
  );
}
