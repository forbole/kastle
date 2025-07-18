import { CommitRevealPayload } from "@/api/background/handlers/kaspa/commitReveal";
import useWalletManager from "@/hooks/useWalletManager";
import HotWalletCommitReveal from "./HotWalletCommitReveal";
import Splash from "@/components/screens/Splash";
import LedgerNotSupported from "../LedgerNotSupported";

export default function CommitReveal({
  requestId,
  payload,
}: {
  requestId: string;
  payload: CommitRevealPayload;
}) {
  const { wallet } = useWalletManager();
  const loading = !wallet || !requestId || !payload;

  return (
    <>
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletCommitReveal requestId={requestId} payload={payload} />
      )}
      {!loading && wallet.type === "ledger" && <LedgerNotSupported />}
    </>
  );
}
