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
3. [Get Account](#3-get-account)
4. [Get Network](#4-get-network)
5. [Switch Network](#5-switch-network)
6. [Get Balance](#6-get-balance)
7. [Get UTXO Entries](#7-get-utxo-entries)
8. [Send KAS](#8-send-kas)
9. [Build Transaction](#9-build-transaction)
10. [Sign & Broadcast Transaction](#10-sign--broadcast-transaction)
11. [Sign Transaction](#11-sign-transaction)
12. [Sign Message](#12-sign-message)
13. [KRC-20: Transfer Token](#13-krc-20-transfer-token)
14. [Events](#14-events)

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

## 3. Get Account

Returns the current wallet address and public key.

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

## 4. Get Network

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

## 5. Switch Network

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

## 6. Get Balance

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

## 7. Get UTXO Entries

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

## 8. Send KAS

Builds, signs, and broadcasts a KAS transfer in one call. No RPC or WASM needed.

**Direct method**

```js
const txId = await kastle.sendKaspa(
  "kaspa:qr...recipient",
  100000000, // amount in sompi (1 KAS = 100,000,000 sompi)
  {
    priorityFee: 1000000, // optional, in sompi
  },
);
console.log("Transaction ID:", txId);
```

**KIP-style**

```js
const txId = await kastle.request("kas:send_sompi", {
  toAddress: "kaspa:qr...recipient",
  sompi: 100000000,
  options: { priorityFee: 1000000 },
});
console.log("Transaction ID:", txId);
```

---

## 9. Build Transaction

Builds one or more transactions from the current account's UTXOs. Returns serialized `txJson` ready for signing. No RPC or WASM needed.

> `amount` and `priorityFee` are **strings** (sompi) to avoid JS BigInt precision loss.
> May return multiple transactions when UTXO compounding is needed.

**Direct method**

```js
const { networkId, transactions } = await kastle.buildTransaction(
  [{ address: "kaspa:qr...recipient", amount: "100000000" }],
  { priorityFee: "1000000" },
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
  },
);
```

---

## 10. Sign & Broadcast Transaction

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

## 11. Sign Transaction

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

## 12. Sign Message

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

## 13. KRC-20: Transfer Token

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

## 14. Events

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

| Direct Method                                            | KIP-style (`kastle.request`) | Returns                         |
| -------------------------------------------------------- | ---------------------------- | ------------------------------- |
| `kastle.connect()`                                       | `kas:connect`                | `boolean`                       |
| `kastle.getAccount()`                                    | `kas:get_account`            | `{ address, publicKey }`        |
| `kastle.getNetwork()`                                    | `kas:get_network`            | `string`                        |
| `kastle.switchNetwork(networkId)`                        | `kas:switch_network`         | `string`                        |
| `kastle.getBalance()`                                    | `kas:get_balance`            | `{ balance: string }`           |
| `kastle.getUtxoEntries()`                                | `kas:get_utxo_entries`       | `{ entries[] }`                 |
| `kastle.sendKaspa(toAddress, sompi, opts?)`              | `kas:send_sompi`             | `string` (txId)                 |
| `kastle.buildTransaction(outputs, opts?)`                | `kas:build_transaction`      | `{ networkId, transactions[] }` |
| `kastle.signAndBroadcastTx(networkId, txJson, scripts?)` | `kas:sign_and_broadcast_tx`  | `string` (txId)                 |
| `kastle.signTx(networkId, txJson, scripts?)`             | `kas:sign_tx`                | `string` (signed txJson)        |
| `kastle.signMessage(message)`                            | `kas:sign_message`           | `string` (signature)            |
| `kastle.commitReveal(networkId, namespace, data, opts?)` | `kas:commit_reveal`          | `{ commitTxId, revealTxId }`    |

---

## Full Working Example

See the interactive demo for a complete, runnable reference:

- **[docs/index.html](./index.html)** — Demo UI
- **[docs/index.js](./index.js)** — Full source code for all operations above
