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
      {secret?.type === "privateKey" && type === "private-key" && (
        <ShowPrivateKey secret={secret.value} />
      )}
      {secret?.type === "privateKey" && type === "zkas-seed" && secret.zkasSeedHex && (
        <ShowPrivateKey secret={secret.zkasSeedHex} label="ZKas spending seed" />
      )}
      {secret?.type === "zkasSeed" && type === "zkas-seed" && (
        <ShowPrivateKey secret={secret.value} label="ZKas spending seed" />
      )}
      {secret?.type === "mnemonic" && type === "mnemonic" && (
        <ShowRecoveryPhrase secret={secret.value} />
      )}
      {secret && !((secret.type === "privateKey" && (type === "private-key" || (type === "zkas-seed" && secret.zkasSeedHex))) || (secret.type === "mnemonic" && type === "mnemonic") || (secret.type === "zkasSeed" && type === "zkas-seed")) && (
        <p role="alert" className="p-6 text-white">This backup type is unavailable for the selected wallet.</p>
      )}
    </>
  );
}
