import { useNavigate, useSearchParams } from "react-router-dom";
import useKeyring from "@/hooks/useKeyring";
import { useEffect, useState } from "react";
import { KEYRING_CHANGE_TIME } from "@/lib/keyring-manager.ts";
import useStorageState from "@/hooks/useStorageState.ts";

// A hung openPopup() must not leave the button disabled for good.
const OPEN_POPUP_TIMEOUT_MS = 10_000;

export default function WalletLockedAlert() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { getKeyringStatus } = useKeyring();
  const [unlockTime] = useStorageState(
    `local:${KEYRING_CHANGE_TIME}`,
    Date.now(),
  );

  const [openFailed, setOpenFailed] = useState(false);
  const [opening, setOpening] = useState(false);

  const onClick = async () => {
    if (opening) return;
    setOpening(true);
    // A retry that succeeds must not leave the previous failure on screen.
    setOpenFailed(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        browser.action.openPopup(),
        new Promise((_, reject) => {
          timer = setTimeout(reject, OPEN_POPUP_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Not every browser can open the popup from a page (desktop Android),
      // and a call that never settles is treated the same.
      setOpenFailed(true);
    } finally {
      clearTimeout(timer);
      setOpening(false);
    }
  };

  useEffect(() => {
    const checkWalletStatus = async () => {
      const keyringStatusResponse = await getKeyringStatus();

      if (keyringStatusResponse.isUnlocked) {
        const redirect = searchParams.get("redirect");

        return navigate(redirect ?? "/dashboard");
      }
    };

    checkWalletStatus();
  }, [unlockTime]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-12">
      <div className="mx-auto text-center">
        <h3 className="text-xl font-bold">
          It looks like the wallet is locked
        </h3>
        <span className="text-base text-gray-400">
          Please unlock it and try again
        </span>
      </div>
      <button
        className="rounded-full bg-[#00b1d0] p-5 text-base font-semibold disabled:cursor-wait disabled:opacity-50"
        onClick={onClick}
        disabled={opening}
      >
        Unlock Wallet now
      </button>
      {/* Always mounted so screen readers announce the hint when it appears;
          sr-only while empty keeps it out of the flex gap. */}
      <span
        role="status"
        className={
          openFailed ? "text-center text-base text-gray-400" : "sr-only"
        }
      >
        {openFailed && (
          <>
            Kastle couldn&apos;t be opened from this page. Open it from your
            browser to unlock.
          </>
        )}
      </span>
    </div>
  );
}
