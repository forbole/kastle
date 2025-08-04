import { useState } from "react";
import BackupUnlock from "./BackupUnlock";
import { WalletSecret } from "@/types/WalletSecret";
import ShowPrivateKey from "./ShowPrivateKey";
import ShowRecoveryPhrase from "./ShowRecoveryPhrase";
import { useParams } from "react-router-dom";

export default function ShowWalletSecret() {
  const [secret, setSecret] = useState<WalletSecret>();
  const { type } = useParams<{ type: string }>();

  return (
    <>
      {!secret && <BackupUnlock setSecret={setSecret} />}
      {secret && type === "private-key" && (
        <ShowPrivateKey secret={secret.value} />
      )}
      {secret && type === "mnemonic" && (
        <ShowRecoveryPhrase secret={secret.value} />
      )}
    </>
  );
}
