import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import {
  LegacyLedgerAccount,
  LedgerAccount,
} from "@/lib/wallet/account/ledger-account.ts";
import { Transaction as TransactionNew } from "@/wasm/core/kaspa";
import { Transaction as TransactionLegacy } from "@/wasm/legacy/kaspa";
import { stripTransactionJSON, patchTransactionJSON } from "@/lib/kaspa.ts";
import Transport from "@ledgerhq/hw-transport";

function stripToLegacy(tx: TransactionNew): TransactionNew {
  // Legacy WASM serializes without computeBudget; patch before new WASM parses.
  return TransactionNew.deserializeFromSafeJSON(
    patchTransactionJSON(
      TransactionLegacy.deserializeFromSafeJSON(
        stripTransactionJSON(tx.serializeToSafeJSON()),
      ).serializeToSafeJSON(),
    ),
  );
}

export class LegacyWasmLegacyLedgerAccount extends LegacyLedgerAccount {
  constructor(transport: Transport, accountIndex: number) {
    super(transport, accountIndex);
  }

  override async signTx(
    tx: TransactionNew,
    scripts?: ScriptOption[],
  ): Promise<TransactionNew> {
    const signed = await super.signTx(tx, scripts);
    return stripToLegacy(signed);
  }
}

export class LegacyWasmLedgerAccount extends LedgerAccount {
  constructor(transport: Transport, accountIndex: number) {
    super(transport, accountIndex);
  }

  override async signTx(
    tx: TransactionNew,
    scripts?: ScriptOption[],
  ): Promise<TransactionNew> {
    const signed = await super.signTx(tx, scripts);
    return stripToLegacy(signed);
  }
}
