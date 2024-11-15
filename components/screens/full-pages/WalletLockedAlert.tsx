import { useSearchParams, useNavigate } from "react-router-dom";
import useKeyring from "@/hooks/useKeyring";

export default function WalletLockedAlert() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { getKeyringStatus } = useKeyring();

  const onClick = () => {
    browser.action.openPopup();
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
  }, []);

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
        className="rounded-full bg-[#00b1d0] p-5 text-base font-semibold"
        onClick={onClick}
      >
        Unlock Wallet now
      </button>
    </div>
  );
}
