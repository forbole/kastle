import React from "react";
import * as Sentry from "@sentry/react";
import Header from "@/components/GeneralHeader";
import { useSettings } from "@/hooks/useSettings";
import { sentryScrubHooks } from "@/lib/sentry-scrub.ts";
import { useNavigate } from "react-router-dom";

/**
 * Dev-only Sentry canary.
 *
 * ponytail: this drives its own Sentry client rather than the app's. The app's
 * client is `enabled: isProduction`, so in a dev build `captureException` emits
 * nothing at all — there would be nothing to look at. This one uses the real
 * `sentryScrubHooks` (the same object lib/instrument.ts spreads into
 * Sentry.init) with a fake DSN and a transport that prints the envelope instead
 * of sending it, so nothing leaves the machine. Whatever you see printed is
 * exactly what would have gone on the wire.
 *
 * `import.meta.env.DEV` is a build-time constant, so this whole block is absent
 * from `npm run build` output. Note that the repo's only other debug UI,
 * the "Experimental features" toggle below, is a *runtime* setting that does
 * ship in production — there was no existing build-time gate to match.
 */
async function emitCanaryEnvelope(kind: "canary" | "control") {
  // Well-known BIP-39 test vector plus a matching hex key and xprv — never a
  // real wallet's secret.
  const PHRASE =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const HEX =
    "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
  const XPRV =
    "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";

  Sentry.init({
    ...sentryScrubHooks,
    dsn: "https://abc123@o0.ingest.sentry.io/0",
    enabled: true,
    transport: () => ({
      send: async (envelope: unknown) => {
        console.log(
          `[sentry-${kind}]`,
          JSON.stringify(
            envelope,
            (_key, value) => (value instanceof Error ? String(value) : value),
            2,
          ),
        );
        return {};
      },
      flush: async () => true,
    }),
  });

  Sentry.getGlobalScope().clearBreadcrumbs();
  Sentry.getIsolationScope().clearBreadcrumbs();
  Sentry.getCurrentScope().clearBreadcrumbs();

  if (kind === "canary") {
    Sentry.addBreadcrumb({
      category: "console",
      level: "log",
      message: `user pasted ${PHRASE}`,
      data: {
        arguments: [XPRV],
        // No separator at all before the hex. This is the case `\b` anchoring
        // used to miss: `\b` needs a non-word character on each side, and `y`
        // is a word character.
        noSeparator: `privkey${HEX}`,
        // Same shape for the extended key.
        noSeparatorExtended: `seed${XPRV}`,
      },
    });
    // `key=` — a real log line's shape. `=` is a non-word character, so this
    // one was always caught; it is here as the boundary control.
    Sentry.captureException(new Error(`import failed for key=${HEX}`), {
      extra: { mnemonic: PHRASE, nested: { xprv: XPRV } },
    });
  } else {
    Sentry.addBreadcrumb({
      category: "console",
      level: "log",
      message: "refreshing balances",
    });
    Sentry.captureException(
      new Error("Failed to fetch the Kaspa price: request timed out"),
      { extra: { url: "https://api.kaspa.org/info/price", status: 504 } },
    );
  }

  await Sentry.flush(2000);
  await Sentry.close(2000);
}

export default function DevMode() {
  const navigate = useNavigate();
  const [settings, setSettings] = useSettings();

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Header
        title="Experimental features"
        onClose={() => navigate("/dashboard")}
      />
      <div
        className="flex flex-col gap-2 rounded-xl border border-[#7F1D1D] bg-[#381825] p-4 text-base"
        role="alert"
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold text-daintree-200">
            Experimental features will enable experimental features. Features
            that may not be completed nor stable. Only activate if you know what
            you are doing.
          </span>
        </div>
      </div>

      <div className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-700 bg-[#1E343D] p-5">
        <div className="flex items-center justify-start gap-4 text-base font-semibold">
          <span className="font-semibold">Experimental features</span>
        </div>
        <div className="flex items-center text-base">
          <input
            checked={settings?.preview ?? false}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, preview: e.target.checked }))
            }
            type="checkbox"
            className="relative h-6 w-11 cursor-pointer rounded-full border-neutral-700 border-transparent bg-daintree-700 p-px text-transparent transition-colors duration-200 ease-in-out before:inline-block before:size-5 before:translate-x-0 before:transform before:rounded-full before:bg-white before:shadow before:ring-0 before:transition before:duration-200 before:ease-in-out checked:border-icy-blue-400 checked:bg-icy-blue-400 checked:bg-none checked:text-icy-blue-400 checked:before:translate-x-full checked:before:bg-white focus:ring-transparent focus:ring-offset-transparent focus:checked:border-transparent disabled:pointer-events-none disabled:opacity-50"
          />
        </div>
      </div>

      {import.meta.env.DEV && (
        <div className="flex flex-col gap-2 rounded-xl border border-gray-700 bg-[#1E343D] p-5">
          <span className="font-semibold">
            Sentry scrubbing check (dev only)
          </span>
          <span className="text-sm text-daintree-200">
            Open the popup console. Each button prints the envelope that would
            have been sent. Nothing is sent anywhere.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-icy-blue-400 px-3 py-2 text-sm"
              onClick={() => emitCanaryEnvelope("canary")}
            >
              Trigger canary error
            </button>
            <button
              type="button"
              className="rounded-lg border border-gray-500 px-3 py-2 text-sm"
              onClick={() => emitCanaryEnvelope("control")}
            >
              Trigger control error
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
