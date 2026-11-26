# Kastle Wallet API

Integrate your dApp with Kastle Wallet.

> **Note:** This API is subject to changes. Refer to [`docs/index.js`](./index.js) for the most up-to-date working examples.

Each API method is available in two styles:

- **Direct method**: `kastle.methodName(...)`
- **KIP-style generic request**: `kastle.request('kas:method_name', args)`

---

## Table of Contents

1. [Detect Kastle](#1-detect-kastle)
2. [Connect](#2-connect)
3. [Get Version](#3-get-version)
4. [Get Account](#4-get-account)
5. [Get Network](#5-get-network)
6. [Switch Network](#6-switch-network)
7. [Get Balance](#7-get-balance)
8. [Get UTXO Entries](#8-get-utxo-entries)
9. [Send KAS](#9-send-kas)
10. [Build Transaction](#10-build-transaction)
11. [Sign & Broadcast Transaction](#11-sign--broadcast-transaction)
12. [Sign Transaction](#12-sign-transaction)
13. [Sign PSKT](#13-sign-pskt)
14. [Sign Message](#14-sign-message)
15. [KRC-20: Transfer Token](#15-krc-20-transfer-token)
16. [Compound UTXOs](#16-compound-utxos)
17. [Events](#17-events)

---

## 1. Detect Kastle

```js
if (window.kastle) {
  console.log("Kastle Wallet detected!");
} else {
  alert("Please install Kastle Wallet.");
}
```

---

## 2. Connect

Opens the permission popup and requests wallet access.

**Direct method**

```js
const isSuccess = await kastle.connect();
console.log("Connected:", isSuccess); // true
```

**KIP-style**

```js
const isSuccess = await kastle.request("kas:connect");
console.log("Connected:", isSuccess); // true
```

---

## 3. Get Version

> **Available since:** Extension `2.48.0` · Mobile `1.19.0`

Returns the current wallet version in [SemVer](https://semver.org/) format. The build metadata suffix identifies the platform:

| Suffix       | Platform          |
| ------------ | ----------------- |
| `+extension` | Browser extension |
| `+mobile`    | Mobile app        |

**Direct method**

```js
const version = await kastle.getVersion();
console.log("Version:", version);
// Browser extension: "2.47.0+extension"
// Mobile:            "1.19.0+mobile"
```

**KIP-style**

```js
const version = await kastle.request("kas:get_version");
// Browser extension: "2.47.0+extension"
// Mobile:            "1.19.0+mobile"
```

---

## 4. Get Account

**Direct method**

```js
const { address, publicKey } = await kastle.getAccount();
console.log("Address:", address);
console.log("Public Key:", publicKey);
```

**KIP-style**

```js
const { address, publicKey } = await kastle.request("kas:get_account");
console.log("Address:", address);
console.log("Public Key:", publicKey);
```

---

## 5. Get Network

Returns the currently active network ID.

**Direct method**

```js
const network = await kastle.getNetwork();
console.log("Network:", network); // e.g. "mainnet"
```

**KIP-style**

```js
const network = await kastle.request("kas:get_network");
console.log("Network:", network);
```

---

## 6. Switch Network

Prompts the user to switch to a different network.

**Direct method**

```js
// Valid values: "mainnet" | "testnet-10" | "testnet-11"
await kastle.switchNetwork("mainnet");
```

**KIP-style**

```js
await kastle.request("kas:switch_network", "mainnet");
```

---

## 7. Get Balance

> **Available since:** Extension `2.47.0` · Mobile `1.19.0`

Returns the current account balance in sompi.

**Direct method**

```js
const { balance } = await kastle.getBalance();
console.log("Balance (sompi):", balance);
```

**KIP-style**

```js
const { balance } = await kastle.request("kas:get_balance");
console.log("Balance (sompi):", balance);
```

---

## 8. Get UTXO Entries

> **Available since:** Extension `2.47.0` · Mobile `1.19.0`

Returns all UTXOs for the current account.

**Direct method**

```js
const { entries } = await kastle.getUtxoEntries();
entries.forEach((entry) => {
  console.log(
    "Outpoint:",
    entry.outpoint.transactionId,
    ":",
    entry.outpoint.index,
  );
  console.log("Amount (sompi):", entry.amount);
  console.log("Is Coinbase:", entry.isCoinbase);
});
```

**KIP-style**

```js
const { entries } = await kastle.request("kas:get_utxo_entries");
```

---

## 9. Send KAS

Builds, signs, and broadcasts a KAS transfer in one call. No RPC or WASM needed.

> **Since Extension `2.60.1`:** when the account's UTXOs are fragmented enough that the transfer needs more than one transaction, the call rejects with `{ code: 4300, message }` (`BATCH_REQUIRED`) instead of broadcasting only the first, non-paying transaction. Build the batch with [Build Transaction](#10-build-transaction) and pass each transaction, in order, to [Sign & Broadcast Transaction](#11-sign--broadcast-transaction) — `docs/index.js` shows the loop.

**Parameters**

| Parameter             | Type     | Required | Description                                                                                                       |
| --------------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `toAddress`           | `string` | ✅       | Recipient Kaspa address                                                                                           |
| `sompi`               | `number` | ✅       | Amount in sompi (minimum 0.2 KAS = 20,000,000 sompi)                                                              |
| `options.priorityFee` | `number` | ❌       | Priority fee in sompi (default: `0`)                                                                              |
| `options.payload`     | `string` | ❌       | Transaction payload as a **hex string** (even length, `0-9 a-f` only). Returns an error if the format is invalid. |

**Direct method**

```js
const txId = await kastle.sendKaspa(
  "kaspa:qr...recipient",
  100000000, // amount in sompi (1 KAS = 100,000,000 sompi)
  {
    priorityFee: 1000000, // optional, in sompi
    payload: "6b61737061", // optional hex string
  },
);
console.log("Transaction ID:", txId);
```

**KIP-style**

```js
const txId = await kastle.request("kas:send_sompi", {
  toAddress: "kaspa:qr...recipient",
  sompi: 100000000,
  options: { priorityFee: 1000000, payload: "6b61737061" },
});
console.log("Transaction ID:", txId);
```

---

## 10. Build Transaction

> **Available since:** Extension `2.47.0` · Mobile `1.19.0`

Builds one or more transactions from the current account's UTXOs. Returns serialized `txJson` ready for signing. No RPC or WASM needed.

> `amount` and `priorityFee` are **strings** (sompi) to avoid JS BigInt precision loss.
> May return multiple transactions when UTXO compounding is needed.

**Parameters**

| Parameter             | Type                                    | Required | Description                                                                                                        |
| --------------------- | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `outputs`             | `{ address: string; amount: string }[]` | ✅       | Recipient addresses and amounts (in sompi)                                                                         |
| `options.priorityFee` | `string`                                | ❌       | Priority fee in sompi (default: `"0"`)                                                                             |
| `options.payload`     | `string`                                | ❌       | Transaction payload as a **hex string** (even length, `0-9 a-f` only). Returns an error if the format is invalid.  |
| `options.inputs`      | `IUtxoEntry[]`                          | ❌       | Specific UTXOs to use as inputs. If omitted, all UTXOs of the current account are used automatically.              |
| `options.sigOpCount`  | `number`                                | ❌       | Number of signature operations in the transaction. Required for P2SH scripts (e.g. `1` for a single `OpCheckSig`). |

**`IUtxoEntry` schema**

```ts
type IUtxoEntry = {
  address?: string; // Kaspa address (optional)
  outpoint: {
    transactionId: string;
    index: number;
  };
  amount: string; // sompi as string
  scriptPublicKey: {
    version: number;
    script: string;
  };
  blockDaaScore: string;
  isCoinbase: boolean;
};
```

**Direct method**

```js
// Basic — uses all account UTXOs automatically
const { networkId, transactions } = await kastle.buildTransaction(
  [{ address: "kaspa:qr...recipient", amount: "100000000" }],
  {
    priorityFee: "1000000",
    payload: "6b61737061", // optional hex string
  },
);

// With explicit inputs
const { networkId, transactions } = await kastle.buildTransaction(
  [{ address: "kaspa:qr...recipient", amount: "100000000" }],
  {
    priorityFee: "1000000",
    inputs: [
      {
        address: "kaspa:qr...sender",
        outpoint: { transactionId: "abc123...", index: 0 },
        amount: "500000000",
        scriptPublicKey: { version: 0, script: "20ab...ac" },
        blockDaaScore: "443245436",
        isCoinbase: false,
      },
    ],
  },
);

for (const tx of transactions) {
  console.log("Tx ID:", tx.id);
  console.log("Fee:", tx.feeAmount, "sompi");
  console.log("Change:", tx.changeAmount, "sompi");
  console.log("Tx JSON:", tx.txJson);
}
```

**KIP-style**

```js
const { networkId, transactions } = await kastle.request(
  "kas:build_transaction",
  {
    outputs: [{ address: "kaspa:qr...recipient", amount: "100000000" }],
    priorityFee: "1000000",
    payload: "6b61737061", // optional hex string
    inputs: [
      /* optional IUtxoEntry[] */
    ],
  },
);
```

---

## 11. Sign & Broadcast Transaction

Signs a transaction and broadcasts it to the network. Opens a confirmation popup.

**Direct method**

```js
const txId = await kastle.signAndBroadcastTx(networkId, txJson);
console.log("Transaction ID:", txId);
```

**KIP-style**

```js
const txId = await kastle.request("kas:sign_and_broadcast_tx", {
  networkId,
  txJson,
});
console.log("Transaction ID:", txId);
```

> To build `txJson` manually using Kaspa WASM and an RPC client, see [`docs/index.js`](./index.js).

---

## 12. Sign Transaction

Signs a transaction **without** broadcasting it. Returns the signed transaction as a JSON string. Useful for marketplace flows (e.g. `SingleAnyOneCanPay`).

**Direct method**

```js
const signedTxJson = await kastle.signTx(networkId, txJson);

// Broadcast manually:
const { transactionId } = await rpc.submitTransaction(
  kaspaWasm.Transaction.deserializeFromSafeJSON(signedTxJson),
);
```

**KIP-style**

```js
const signedTxJson = await kastle.request("kas:sign_tx", {
  networkId,
  txJson,
});
```

With a custom script (e.g. for P2SH spend):

```js
const signedTxJson = await kastle.signTx(networkId, txJson, [
  { inputIndex: 0, scriptHex: "...", signType: "SingleAnyOneCanPay" },
]);
```

> For the Kasware-compatible call shape (`signPskt` with `signInputs`), see [Sign PSKT](#13-sign-pskt). The two methods differ on sighash types and on inputs left unsigned.

---

## 13. Sign PSKT

Signs named inputs of a transaction the dApp built, with the current account's key, **without** broadcasting it. A named input may be locked to a script address the account does not own (e.g. a P2SH covenant UTXO). Each named input comes back with `41 || 64-byte signature || sighash byte` in its `signatureScript` (`01` for `All`, `81` for `AllAnyOneCanPay`). Nothing else in the transaction changes. Opens a confirmation popup.

This is the Kasware-compatible entry point. For Kastle's own call shape, see [Sign Transaction](#12-sign-transaction).

**Parameters**

```ts
signPskt({
  txJsonString: string,
  options?: { signInputs?: { index: number; sighashType?: number }[] },
}): Promise<string>
```

| Parameter                          | Type     | Required | Description                                        |
| ---------------------------------- | -------- | -------- | -------------------------------------------------- |
| `txJsonString`                     | `string` | ✅       | The transaction as Kaspa **Safe JSON** (see below) |
| `options.signInputs[].index`       | `number` | ✅       | Index of an input to sign                          |
| `options.signInputs[].sighashType` | `number` | ❌       | Kasware numeric sighash type (default: `1`, `All`) |

`txJsonString` is the same Safe JSON string that `signTx` takes, and the same one Kasware calls a PSKT. `Transaction.deserializeFromSafeJSON()` can read it. Give every input its UTXO entry: when one is missing, the confirm screen shows the input counts as "Not known".

**Return value**

The signed transaction as a Safe JSON string.

**Sighash types**

| Value         | Name                            | Kastle `signPskt`                                |
| ------------- | ------------------------------- | ------------------------------------------------ |
| `1` (omitted) | `All`                           | accepted, the default                            |
| `129`         | `AllAnyOneCanPay`               | accepted, and warned about on the confirm screen |
| `2` / `130`   | `None` / `NoneAnyOneCanPay`     | **refused**: commits no outputs                  |
| `4` / `132`   | `Single` / `SingleAnyOneCanPay` | **refused**: commits only the same-index output  |

With either refused type, outputs the user approved could be changed after approval. This is stricter than Kasware. `signTx` keeps its own behaviour (it signs an in-range `Single*` input behind a warning). The two methods differ on purpose.

**Inputs that would be left unsigned**

Every transaction input must be one of these:

- listed in `signInputs`,
- the account's own coin (signed automatically with `All`), or
- already carrying a `signatureScript`.

If any input is none of these, the whole request is refused before the popup opens, and the error names every such index (e.g. `signPskt: inputs 2, 3 would be left unsigned: not listed in signInputs and not your own coin`). A duplicate index, or an index past the last input, is refused the same way. `signTx` behaves differently: given the same transaction, it returns it partially signed.

**What the wallet does not do**

- It does not build the transaction.
- It does not append the redeem script. `scriptHex` is a `signTx` option, not a `signPskt` one.
- It does not broadcast.
- It does not sign on a Ledger account: a sign-only request is refused before any confirm screen.

The dApp appends its own pushes (e.g. a dispatch tag) and the redeem script, then broadcasts.

If the selected account changes while the request is open, it is refused with code `4302` (`COVENANT_ACCOUNT_CHANGED`). Send it again for the new account.

**Direct method**

```js
// inputs[0]: a P2SH covenant UTXO. inputs[1]: one of the account's own coins.
const txJsonString = transaction.serializeToSafeJSON();

const signedTxJson = await kastle.signPskt({
  txJsonString,
  options: {
    // Only index 0 is listed. Index 1 is the account's own coin,
    // so the wallet signs it automatically with All.
    signInputs: [{ index: 0, sighashType: 1 }],
  },
});

// The dApp completes the P2SH input: signature first (from the wallet),
// then the pushes the redeem script expects, then the redeem script itself.
const tx = kaspaWasm.Transaction.deserializeFromSafeJSON(signedTxJson);
const input = tx.inputs[0];
input.signatureScript =
  input.signatureScript + // 41 || signature || 01
  new kaspaWasm.ScriptBuilder()
    .addData(dispatchTagHex)
    .addData(redeemScriptHex)
    .drain();

const { transactionId } = await rpc.submitTransaction(tx);
```

**KIP-style**

```js
const signedTxJson = await kastle.request("kas:sign_pskt", {
  txJsonString,
  options: { signInputs: [{ index: 0, sighashType: 1 }] },
});
```

---

## 14. Sign Message

Signs an arbitrary message string.

**Direct method**

```js
const signature = await kastle.signMessage("Hello from my dApp!");
console.log("Signature:", signature);
```

**KIP-style**

```js
const signature = await kastle.request(
  "kas:sign_message",
  "Hello from my dApp!",
);
console.log("Signature:", signature);
```

---

## 15. KRC-20: Transfer Token

KRC-20 operations use a commit-reveal pattern. Kastle handles both steps — no WASM needed.

**Direct method**

```js
const result = await kastle.commitReveal(
  "mainnet",
  "kasplex",
  JSON.stringify({
    p: "krc-20",
    op: "transfer",
    tick: "MYTOKEN",
    to: "kaspa:qr...recipient",
    amt: "500",
  }),
);
console.log("Commit Tx ID:", result.commitTxId);
console.log("Reveal Tx ID:", result.revealTxId);
console.log("All reveal Tx IDs:", result.revealTxIds);
```

**KIP-style**

```js
const result = await kastle.request("kas:commit_reveal", {
  networkId: "mainnet",
  namespace: "kasplex",
  data: JSON.stringify({
    p: "krc-20",
    op: "transfer",
    tick: "MYTOKEN",
    to: "kaspa:qr...recipient",
    amt: "500",
  }),
  options: {},
});
console.log("Commit Tx ID:", result.commitTxId);
console.log("Reveal Tx ID:", result.revealTxId);
```

**Return value**

| Field         | Type       | Description                                                                                                                                                                                                        |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commitTxId`  | `string`   | The commit transaction.                                                                                                                                                                                            |
| `revealTxId`  | `string`   | The reveal transaction that carries the inscription payment and `revealPriorityFee`. When the wallet's UTXO set is fragmented the reveal is broadcast as a chain of transactions; this is always the **last** one. |
| `revealTxIds` | `string[]` | Every reveal transaction in broadcast order, ending with `revealTxId`. Usually one element. **Available since:** Extension `2.60.1` · Mobile — not yet (absent on older versions, so treat it as optional).        |

---

## 16. Compound UTXOs

> **Available since:** Extension `2.52.0` · Mobile `1.20.0`

Consolidates all UTXOs in the current account into a single UTXO by sending the full balance back to the sender's own address. Opens a confirmation popup.

Useful for reducing future transaction fees caused by having many small UTXOs.

> **Current behaviour (Extension):** the handler builds the self-send with the Generator's default input selection, which picks only as many UTXOs as the payment needs — in practice one input moved to the same address minus the fee. The account's UTXOs are **not** consolidated. To compound today, use [Build Transaction](#10-build-transaction) to send most of the balance back to your own address with an explicit `amount` — the balance minus a fee reserve (0.3 KAS covers the largest batch the Generator builds); `outputs` is required there, so a true sweep cannot be expressed. The Generator selects inputs only until the amount is covered, so this reduces fragmentation rather than guaranteeing consolidation: UTXOs worth less than the reserve in total can stay unspent, and full consolidation needs sweep-mode input selection. On a fragmented wallet the result is a chain of transactions; pass each one, in order, to [Sign & Broadcast Transaction](#11-sign--broadcast-transaction). A sweep-mode fix is tracked separately.

> **Since Extension `2.60.1`:** when compounding would take more than one transaction, the call rejects with `{ code: 4300, message }` (`BATCH_REQUIRED`) instead of broadcasting only the first one. Build the batch with [Build Transaction](#10-build-transaction) and pass each transaction, in order, to [Sign & Broadcast Transaction](#11-sign--broadcast-transaction).

**Parameters**

| Parameter             | Type     | Required | Description                            |
| --------------------- | -------- | -------- | -------------------------------------- |
| `options.priorityFee` | `string` | ❌       | Priority fee in sompi (default: `"0"`) |

**Direct method**

```js
const txId = await kastle.compoundUtxos({ priorityFee: "1000" });
console.log("Transaction ID:", txId);
```

**KIP-style**

```js
const txId = await kastle.request("kas:compound_utxos", {
  priorityFee: "1000",
});
console.log("Transaction ID:", txId);
```

---

## 17. Events

Listen to wallet state changes. Events are emitted in both KasWare-compatible and KIP-style formats simultaneously.

```js
// KasWare-compatible
kastle.on("accountsChanged", (accounts) => {
  // string[] — empty array means disconnected
  console.log("Accounts changed:", accounts);
});

kastle.on("networkChanged", (network) => {
  console.log("Network changed:", network);
});

// KIP-style
kastle.on("kas:account_changed", (address) => {
  // string | null — null means disconnected
  console.log("Account changed:", address);
});

kastle.on("kas:network_changed", (network) => {
  console.log("Network changed:", network);
});

// Remove a listener
kastle.removeListener("accountsChanged", myHandler);
```

---

## API Reference

| Direct Method                                            | KIP-style (`kastle.request`) | Returns                                             |
| -------------------------------------------------------- | ---------------------------- | --------------------------------------------------- |
| `kastle.connect()`                                       | `kas:connect`                | `boolean`                                           |
| `kastle.getVersion()`                                    | `kas:get_version`            | `string` (e.g. `2.47.0+extension`, `1.19.0+mobile`) |
| `kastle.getAccount()`                                    | `kas:get_account`            | `{ address, publicKey }`                            |
| `kastle.getNetwork()`                                    | `kas:get_network`            | `string`                                            |
| `kastle.switchNetwork(networkId)`                        | `kas:switch_network`         | `string`                                            |
| `kastle.getBalance()`                                    | `kas:get_balance`            | `{ balance: string }`                               |
| `kastle.getUtxoEntries()`                                | `kas:get_utxo_entries`       | `{ entries[] }`                                     |
| `kastle.sendKaspa(toAddress, sompi, opts?)`              | `kas:send_sompi`             | `string` (txId)                                     |
| `kastle.buildTransaction(outputs, opts?)`                | `kas:build_transaction`      | `{ networkId, transactions[] }`                     |
| `kastle.signAndBroadcastTx(networkId, txJson, scripts?)` | `kas:sign_and_broadcast_tx`  | `string` (txId)                                     |
| `kastle.signTx(networkId, txJson, scripts?)`             | `kas:sign_tx`                | `string` (signed txJson)                            |
| `kastle.signPskt(payload)`                               | `kas:sign_pskt`              | `string` (signed txJson)                            |
| `kastle.signMessage(message)`                            | `kas:sign_message`           | `string` (signature)                                |
| `kastle.commitReveal(networkId, namespace, data, opts?)` | `kas:commit_reveal`          | `{ commitTxId, revealTxId, revealTxIds? }`          |
| `kastle.compoundUtxos(opts?)`                            | `kas:compound_utxos`         | `string` (txId)                                     |

---

## Full Working Example

See the interactive demo for a complete, runnable reference:

- **[docs/index.html](./index.html)** — Demo UI
- **[docs/index.js](./index.js)** — Full source code for all operations above
