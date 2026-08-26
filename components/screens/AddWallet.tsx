import { useNavigate } from "react-router-dom";
import internalToast from "@/components/Toast.tsx";
import { v4 as uuid } from "uuid";
import useWalletImporter from "@/hooks/wallet/useWalletImporter";
import useAnalytics from "@/hooks/useAnalytics";
import AddWalletPage from "@/ui/popup/add-wallet/AddWalletPage";
import { openFullPage } from "@/lib/utils";

export default function AddWallet() {
  const { createNewWallet } = useWalletImporter();
  const navigate = useNavigate();
  const { emitWalletCreated } = useAnalytics();

  const newWallet = async () => {
    try {
      const address = await createNewWallet(uuid());
      emitWalletCreated({ method: "new", sender: address ?? undefined });
      internalToast.success("Wallet has been created successfully !");
      navigate("/dashboard");
    } catch {
      internalToast.error("Failed to create wallet");
    }
  };

  return (
    <AddWalletPage
      options={[
        {
          label: "Create new wallet",
          description: "Create a 12-word recovery phrase",
          onClick: newWallet,
        },
        {
          label: "Import Recovery phrase",
          description: "Use a 12- or 24-word recovery phrase",
          onClick: () => openFullPage("/import-recovery-phrase"),
        },
        {
          label: "Import Private Key",
          description: "Use a private key.",
          onClick: () => openFullPage("/import-private-key"),
        },
        {
          label: "Import Ledger",
          description: "Connect a Ledger device via USB",
          onClick: () => openFullPage("/import-ledger"),
        },
      ]}
      advancedOptions={[
        {
          label: "Import Recovery phrase with passphrase",
          description:
            "Advanced. Only if you set a passphrase when creating your wallet.",
          onClick: () =>
            openFullPage("/import-recovery-phrase-with-passphrase"),
        },
      ]}
      onBack={() => navigate(-1)}
      onClose={() => navigate("/dashboard")}
    />
  );
}
