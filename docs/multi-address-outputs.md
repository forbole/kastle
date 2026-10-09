# Multiple KAS transaction outputs

Connected websites can request one KAS transaction with several recipients:

```ts
const txid = await window.kastle.sendKaspaMany(
  [
    { address: recipientAddress, amount: "20000000" },
    { address: serviceAddress, amount: "30000000" },
  ],
  { priorityFee: "1000", payload: "aabb" },
);
```

Amounts and the priority fee are exact decimal **sompi strings**. Each output
must be at least 20,000,000 sompi (0.2 KAS), matching the existing send minimum.
The method accepts 1–64 outputs and returns a single transaction ID after user
approval. The confirmation screen shows every output's full address and exact
amount, including outputs back to the account. Duplicate addresses remain
separate outputs. The caller chooses recipients; Kastle has no service-fee policy.

A connected host, initialized wallet and valid addresses on the selected network
are required. Empty lists, invalid amounts, unknown fields and total overflow
are rejected. If the transaction generator requires multiple transactions, the
request fails with `BATCH_REQUIRED` before approval or broadcasting. Atomic
callers must not respond by splitting the payment or retrying its outputs one
at a time. Network/storage mass limits can also reject a request below 64 outputs.
The priority fee is additional to the network fee shown at approval.

`sendKaspa(address, sompiNumber, options)` remains available. Numeric amounts and
fees must be safe integers. `buildTransaction(outputs, options)` still supports
advanced unsigned construction.

KAS has one public transaction payload, not encrypted per-output memos. This API
does not enable MatJam shielded ZKas delivery. That requires the ZKas branch's
noncustodial multi-output preparation and a cryptographic verifier that checks
all approved addresses, amounts and encrypted memos in one bundle. It must not
be emulated through several single-recipient approvals or a custodial endpoint.
