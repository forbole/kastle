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
13. [Sign Message](#13-sign-message)
14. [KRC-20: Transfer Token](#14-krc-20-transfer-token)
15. [Compound UTXOs](#15-compound-utxos)
16. [Events](#16-events)

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

| Parameter             | Type                                    | Required | Description                                                                                                       |
| --------------------- | --------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `outputs`             | `{ address: string; amount: string }[]` | ✅       | Recipient addresses and amounts (in sompi)                                                                        |
| `options.priorityFee` | `string`                                | ❌       | Priority fee in sompi (default: `"0"`)                                                                            |
| `options.payload`     | `string`                                | ❌       | Transaction payload as a **hex string** (even length, `0-9 a-f` only). Returns an error if the format is invalid. |

**Direct method**

```js
const { networkId, transactions } = await kastle.buildTransaction(
  [{ address: "kaspa:qr...recipient", amount: "100000000" }],
  {
    priorityFee: "1000000",
    payload: "6b61737061", // optional hex string
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

---

## 13. Sign Message

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

## 14. KRC-20: Transfer Token

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

---

## 15. Compound UTXOs

Consolidates all UTXOs in the current account into a single UTXO by sending the full balance back to the sender's own address. Opens a confirmation popup.

Useful for reducing future transaction fees caused by having many small UTXOs.

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

## 16. Events

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
| `kastle.signMessage(message)`                            | `kas:sign_message`           | `string` (signature)                                |
| `kastle.commitReveal(networkId, namespace, data, opts?)` | `kas:commit_reveal`          | `{ commitTxId, revealTxId }`                        |
| `kastle.compoundUtxos(opts?)`                            | `kas:compound_utxos`         | `string` (txId)                                     |

---

## Full Working Example

See the interactive demo for a complete, runnable reference:

- **[docs/index.html](./index.html)** — Demo UI
- **[docs/index.js](./index.js)** — Full source code for all operations above
