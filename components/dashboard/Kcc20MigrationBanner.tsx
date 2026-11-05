import React from "react";
import { ArrowRightLeft, X } from "lucide-react";
import { twMerge } from "tailwind-merge";
import type { MigrationBannerStatus } from "@/lib/kcc20/migration-status";

// Copy per state. "unconfirmed" means the service has not answered for this
// deposit, so the banner says when it will look again instead of guessing.
const copy = (status: MigrationBannerStatus) => {
  if (status.kind === "failed")
    return {
      title: `${status.tick} migration failed`,
      body: "Kat Bridge reported this migration as failed. Open the tool to see what happened.",
    };
  if (status.unconfirmed)
    return {
      title: `${status.tick} migration started`,
      body: "Kastle can't see the deposit yet. Check on next open, or open the migration tool.",
    };
  return {
    title: `${status.tick} migration in progress`,
    body: "Kat Bridge has the deposit and is still processing it.",
  };
};

export function Kcc20MigrationBanner({
  status,
  onOpen,
  onDismiss,
}: {
  status: MigrationBannerStatus;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { title, body } = copy(status);
  const failed = status.kind === "failed";

  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3"
      role={failed ? "alert" : "status"}
      data-testid="kcc20-migration-banner"
    >
      <ArrowRightLeft
        size={20}
        className={twMerge(
          "mt-0.5 shrink-0",
          failed ? "text-red-500" : "text-icy-blue-400",
        )}
      />
      <div className="flex min-w-0 flex-grow flex-col gap-1">
        <span
          className={twMerge(
            "text-base font-semibold",
            failed ? "text-red-500" : "text-white",
          )}
        >
          {title}
        </span>
        <span className="text-sm text-daintree-400">{body}</span>
        <button
          type="button"
          className="mt-1 self-start rounded-lg bg-icy-blue-400 px-3 py-1.5 text-sm font-medium text-white hover:bg-icy-blue-600"
          onClick={onOpen}
        >
          Open migration tool
        </button>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 rounded-lg p-1 text-daintree-400 hover:bg-daintree-700 hover:text-white"
        onClick={onDismiss}
      >
        <X size={16} />
      </button>
    </div>
  );
}
