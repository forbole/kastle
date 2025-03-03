document.getElementById("connectButton").addEventListener("click", async () => {
  try {
    const result = await kastle.connect("testnet-10");
    document.getElementById("connected").innerText = result;
    document.getElementById("error").innerText = "None";
  } catch (error) {
    document.getElementById("error").innerText = error.message;
  }
});

document
  .getElementById("getAccountButton")
  .addEventListener("click", async () => {
    try {
      const account = await kastle.getAccount();
      document.getElementById("address").innerText = account.address;
      document.getElementById("publicKey").innerText = account.publicKey;
      document.getElementById("error").innerText = "None";
    } catch (error) {
      document.getElementById("error").innerText = error.message;
    }
  });

document
  .getElementById("signAndBroadcastTx")
  .addEventListener("click", async () => {
    try {
      const address = document.getElementById("address").innerText;
      if (!address) {
        throw new Error("Please get the account first");
      }

      const txId = await kastle.signAndBroadcastTx("testnet-10", [
        { amount: "1", address },
      ]);
      document.getElementById("txId").innerText = txId;
    } catch (error) {
      document.getElementById("error").innerText = error.message;
    }
  });

function createKRC20ScriptBuilder(data) {
  const { Opcodes } = kaspaWasm;
  const accountPublicKey = document.getElementById("publicKey").innerText;
  if (!accountPublicKey) {
    throw new Error("Please get the account first");
  }

  const publicKey = new kaspaWasm.PublicKey(accountPublicKey);

  return new kaspaWasm.ScriptBuilder()
    .addData(publicKey.toXOnlyPublicKey().toString())
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpFalse)
    .addOp(Opcodes.OpIf)
    .addData(new TextEncoder().encode("kasplex")) // Instead of Buffer.from
    .addI64(0n)
    .addData(new TextEncoder().encode(JSON.stringify(data, null, 0)))
    .addOp(Opcodes.OpEndIf);
}

document
  .getElementById("krcDeployCommit")
  .addEventListener("click", async () => {
    try {
      const tick = document.getElementById("deployTick").value;
      const deployPayload = {
        p: "krc-20",
        op: "deploy",
        tick,
        max: "100000000",
        lim: "1000",
      };
      const scriptBuilder = createKRC20ScriptBuilder(deployPayload);

      const scriptPublicKey = scriptBuilder.createPayToScriptHashScript();
      const P2SHAddress = kaspaWasm.addressFromScriptPublicKey(
        scriptPublicKey,
        "testnet-10",
      );

      const commitTxId = await kastle.signAndBroadcastTx("testnet-10", [
        { amount: "0.3", address: P2SHAddress.toString() },
      ]);
      document.getElementById("P2SHDeployAddress").innerText =
        P2SHAddress.toString();
      document.getElementById("deployCommitTxId").innerText = commitTxId;
      document.getElementById("deployScript").innerText =
        scriptBuilder.toString();

      document.getElementById("deployErrorKRC20").innerText = "";
    } catch (error) {
      document.getElementById("deployErrorKRC20").innerText = error.message;
    }
  });

document
  .getElementById("krcDeployReveal")
  .addEventListener("click", async () => {
    const rpc = new kaspaWasm.RpcClient({
      url: "wss://ws.tn10.kaspa.forbole.com/borsh",
      networkId: "testnet-10",
    });
    await rpc.connect();

    try {
      const P2SHAddress =
        document.getElementById("P2SHDeployAddress").innerText;
      const scriptBuilder = kaspaWasm.ScriptBuilder.fromScript(
        document.getElementById("deployScript").innerText,
      );

      let P2SHEntries = [];
      while (P2SHEntries.length === 0) {
        const P2SHUTXOs = await rpc.getUtxosByAddresses([
          P2SHAddress.toString(),
        ]);
        P2SHEntries = P2SHUTXOs.entries;

        if (P2SHEntries.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      const P2SHEntry = P2SHEntries[0];
      const entry = {
        address: P2SHEntry.address.toString(),
        amount: kaspaWasm.sompiToKaspaString(P2SHEntry.amount),
        scriptPublicKey: JSON.parse(P2SHEntry.scriptPublicKey.toString()),
        blockDaaScore: P2SHEntry.blockDaaScore.toString(),
        outpoint: JSON.parse(P2SHEntry.outpoint.toString()),
      };
      const revealTxId = await kastle.signAndBroadcastTx("testnet-10", [], {
        priorityEntries: [entry],
        scripts: [
          {
            scriptHex: scriptBuilder.toString(),
            inputIndex: 0,
          },
        ],
        priorityFee: "1000",
      });
      document.getElementById("deployRevealTxId").innerText = revealTxId;
      document.getElementById("deployErrorKRC20").innerText = "";
    } catch (error) {
      document.getElementById("deployErrorKRC20").innerText = error.message;
    } finally {
      rpc.disconnect();
    }
  });

document.getElementById("krcMintCommit").addEventListener("click", async () => {
  try {
    const tick = document.getElementById("mintTick").value;
    const mintPayload = {
      p: "krc-20",
      op: "mint",
      tick,
    };
    const scriptBuilder = createKRC20ScriptBuilder(mintPayload);

    const scriptPublicKey = scriptBuilder.createPayToScriptHashScript();
    const P2SHAddress = kaspaWasm.addressFromScriptPublicKey(
      scriptPublicKey,
      "testnet-10",
    );

    const commitTxId = await kastle.signAndBroadcastTx("testnet-10", [
      { amount: "0.3", address: P2SHAddress.toString() },
    ]);
    document.getElementById("P2SHMintAddress").innerText =
      P2SHAddress.toString();
    document.getElementById("mintCommitTxId").innerText = commitTxId;
    document.getElementById("mintScript").innerText = scriptBuilder.toString();

    document.getElementById("mintErrorKRC20").innerText = "";
  } catch (error) {
    document.getElementById("mintErrorKRC20").innerText = error.message;
  }
});

document.getElementById("krcMintReveal").addEventListener("click", async () => {
  const rpc = new kaspaWasm.RpcClient({
    url: "wss://ws.tn10.kaspa.forbole.com/borsh",
    networkId: "testnet-10",
  });
  await rpc.connect();

  try {
    const P2SHAddress = document.getElementById("P2SHMintAddress").innerText;
    const scriptBuilder = kaspaWasm.ScriptBuilder.fromScript(
      document.getElementById("mintScript").innerText,
    );

    let P2SHEntries = [];
    while (P2SHEntries.length === 0) {
      const P2SHUTXOs = await rpc.getUtxosByAddresses([P2SHAddress.toString()]);
      P2SHEntries = P2SHUTXOs.entries;

      if (P2SHEntries.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    const P2SHEntry = P2SHEntries[0];
    const entry = {
      address: P2SHEntry.address.toString(),
      amount: kaspaWasm.sompiToKaspaString(P2SHEntry.amount),
      scriptPublicKey: JSON.parse(P2SHEntry.scriptPublicKey.toString()),
      blockDaaScore: P2SHEntry.blockDaaScore.toString(),
      outpoint: JSON.parse(P2SHEntry.outpoint.toString()),
    };
    const revealTxId = await kastle.signAndBroadcastTx("testnet-10", [], {
      priorityEntries: [entry],
      scripts: [
        {
          scriptHex: scriptBuilder.toString(),
          inputIndex: 0,
        },
      ],
      priorityFee: "1",
    });
    document.getElementById("mintRevealTxId").innerText = revealTxId;
    document.getElementById("mintErrorKRC20").innerText = "";
  } catch (error) {
    document.getElementById("mintErrorKRC20").innerText = error.message;
  } finally {
    rpc.disconnect();
  }
});

document
  .getElementById("krcMintBatchCommit")
  .addEventListener("click", async () => {
    try {
      const tick = document.getElementById("mintBatchTick").value;
      const mintPayload = {
        p: "krc-20",
        op: "mint",
        tick,
      };
      const scriptBuilder = createKRC20ScriptBuilder(mintPayload);

      const scriptPublicKey = scriptBuilder.createPayToScriptHashScript();
      const P2SHAddress = kaspaWasm.addressFromScriptPublicKey(
        scriptPublicKey,
        "testnet-10",
      );

      const times = document.getElementById("mintBatchTimes").value;
      const preparedUtxos = [];
      for (let i = 0; i < times; i++) {
        preparedUtxos.push({ amount: "0.3", address: P2SHAddress.toString() });
      }

      const commitTxId = await kastle.signAndBroadcastTx(
        "testnet-10",
        preparedUtxos,
      );
      document.getElementById("P2SHMintBatchAddress").innerText =
        P2SHAddress.toString();
      document.getElementById("mintBatchCommitTxId").innerText = commitTxId;
      document.getElementById("mintBatchScript").innerText =
        scriptBuilder.toString();

      document.getElementById("mintBatchErrorKRC20").innerText = "None";
    } catch (error) {
      document.getElementById("mintBatchErrorKRC20").innerText = error.message;
    }
  });

document
  .getElementById("krcMintBatchReveal")
  .addEventListener("click", async () => {
    const rpc = new kaspaWasm.RpcClient({
      url: "wss://ws.tn10.kaspa.forbole.com/borsh",
      networkId: "testnet-10",
    });
    await rpc.connect();

    document.getElementById("mintBatchRevealTxIds").innerHTML = "";

    try {
      const P2SHAddress = document.getElementById(
        "P2SHMintBatchAddress",
      ).innerText;
      const scriptBuilder = kaspaWasm.ScriptBuilder.fromScript(
        document.getElementById("mintBatchScript").innerText,
      );

      let P2SHEntries = [];
      while (P2SHEntries.length === 0) {
        const P2SHUTXOs = await rpc.getUtxosByAddresses([
          P2SHAddress.toString(),
        ]);
        P2SHEntries = P2SHUTXOs.entries;

        if (P2SHEntries.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      for (let i = 0; i < P2SHEntries.length; i++) {
        const P2SHEntry = P2SHEntries[i];
        console.log(P2SHEntry);
        const entry = {
          address: P2SHEntry.address.toString(),
          amount: kaspaWasm.sompiToKaspaString(P2SHEntry.amount),
          scriptPublicKey: JSON.parse(P2SHEntry.scriptPublicKey.toString()),
          blockDaaScore: P2SHEntry.blockDaaScore.toString(),
          outpoint: JSON.parse(P2SHEntry.outpoint.toString()),
        };
        const revealTxId = await kastle.signAndBroadcastTx("testnet-10", [], {
          priorityEntries: [entry],
          scripts: [
            {
              scriptHex: scriptBuilder.toString(),
              inputIndex: 0,
            },
          ],
          priorityFee: "1",
        });

        const li = document.createElement("li");
        li.innerText = revealTxId;
        document.getElementById("mintBatchRevealTxIds").appendChild(li);

        await new Promise((resolve) => setTimeout(resolve, 1000)); // wait for 1 second to avoid from spending UTXOs of transaction
      }
      document.getElementById("mintBatchErrorKRC20").innerText = "None";
    } catch (error) {
      document.getElementById("mintBatchErrorKRC20").innerText = error.message;
    } finally {
      rpc.disconnect();
    }
  });

document
  .getElementById("krcTransferCommit")
  .addEventListener("click", async () => {
    try {
      const tick = document.getElementById("transferTick").value;
      const transferTo = document.getElementById("transferTo").value;
      const transferPayload = {
        p: "krc-20",
        op: "transfer",
        tick,
        to: transferTo,
        amt: document.getElementById("transferAmount").value,
      };
      const scriptBuilder = createKRC20ScriptBuilder(transferPayload);

      const scriptPublicKey = scriptBuilder.createPayToScriptHashScript();
      const P2SHAddress = kaspaWasm.addressFromScriptPublicKey(
        scriptPublicKey,
        "testnet-10",
      );

      const commitTxId = await kastle.signAndBroadcastTx("testnet-10", [
        { amount: "0.3", address: P2SHAddress.toString() },
      ]);
      document.getElementById("P2SHTransferAddress").innerText =
        P2SHAddress.toString();
      document.getElementById("trnasferCommitTxId").innerText = commitTxId;
      document.getElementById("transferScript").innerText =
        scriptBuilder.toString();

      document.getElementById("transferErrorKRC20").innerText = "";
    } catch (error) {
      document.getElementById("transferErrorKRC20").innerText = error.message;
    }
  });

document
  .getElementById("krcTransferReveal")
  .addEventListener("click", async () => {
    const rpc = new kaspaWasm.RpcClient({
      url: "wss://ws.tn10.kaspa.forbole.com/borsh",
      networkId: "testnet-10",
    });
    await rpc.connect();

    try {
      const P2SHAddress = document.getElementById(
        "P2SHTransferAddress",
      ).innerText;
      const scriptBuilder = kaspaWasm.ScriptBuilder.fromScript(
        document.getElementById("transferScript").innerText,
      );

      let P2SHEntries = [];
      while (P2SHEntries.length === 0) {
        const P2SHUTXOs = await rpc.getUtxosByAddresses([
          P2SHAddress.toString(),
        ]);
        P2SHEntries = P2SHUTXOs.entries;

        if (P2SHEntries.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      const P2SHEntry = P2SHEntries[0];
      const entry = {
        address: P2SHEntry.address.toString(),
        amount: kaspaWasm.sompiToKaspaString(P2SHEntry.amount),
        scriptPublicKey: JSON.parse(P2SHEntry.scriptPublicKey.toString()),
        blockDaaScore: P2SHEntry.blockDaaScore.toString(),
        outpoint: JSON.parse(P2SHEntry.outpoint.toString()),
      };
      const revealTxId = await kastle.signAndBroadcastTx("testnet-10", [], {
        priorityEntries: [entry],
        scripts: [
          {
            scriptHex: scriptBuilder.toString(),
            inputIndex: 0,
          },
        ],
        priorityFee: "0.02",
      });
      document.getElementById("transferRevealTxId").innerText = revealTxId;
      document.getElementById("transferErrorKRC20").innerText = "";
    } catch (error) {
      document.getElementById("transferErrorKRC20").innerText = error.message;
    } finally {
      rpc.disconnect();
    }
  });

document
  .getElementById("getKRC20Tokens")
  .addEventListener("click", async () => {
    try {
      const address = document.getElementById("address").innerText;
      if (!address) {
        throw new Error("Please get the account first");
      }

      const resp = await fetch(
        `https://tn10api.kasplex.org/v1/krc20/address/${address}/tokenlist`,
      );
      const data = await resp.json();

      // show empty list if no tokens
      if (data.result.length === 0) {
        document.getElementById("krc20Tokens").innerHTML = "Empty";
        document.getElementById("krc20TokensError").innerText = "None";
        return;
      }

      const krc20Tokens = data.result.map((token) => {
        return `<li>${token.tick} - ${token.balance}</li>`;
      });

      document.getElementById("krc20Tokens").innerHTML = krc20Tokens.join("");
      document.getElementById("krc20TokensError").innerText = "None";
    } catch (error) {
      document.getElementById("krc20TokensError").innerText = error.message;
    }
  });

document.getElementById("krcListCommit").addEventListener("click", async () => {
  try {
    const tick = document.getElementById("tradeListTick").value;
    const amt = document.getElementById("tradeListAmount").value;
    const listPayload = {
      p: "krc-20",
      op: "list",
      tick: tick.toLowerCase(),
      amt,
    };
    const scriptBuilder = createKRC20ScriptBuilder(listPayload);

    const scriptPublicKey = scriptBuilder.createPayToScriptHashScript();
    const P2SHAddress = kaspaWasm.addressFromScriptPublicKey(
      scriptPublicKey,
      "testnet-10",
    );

    const commitTxId = await kastle.signAndBroadcastTx("testnet-10", [
      { amount: "0.3", address: P2SHAddress.toString() },
    ]);
    document.getElementById("P2SHListAddress").innerText =
      P2SHAddress.toString();
    document.getElementById("listCommitTxId").innerText = commitTxId;
    document.getElementById("listScript").innerText = scriptBuilder.toString();

    document.getElementById("listErrorKRC20").innerText = "";
  } catch (error) {
    document.getElementById("listErrorKRC20").innerText = error.message;
  }
});

document.getElementById("krcListReveal").addEventListener("click", async () => {
  const rpc = new kaspaWasm.RpcClient({
    url: "wss://ws.tn10.kaspa.forbole.com/borsh",
    networkId: "testnet-10",
  });
  await rpc.connect();

  try {
    const P2SHAddress = document.getElementById("P2SHListAddress").innerText;
    const listScriptBuilder = kaspaWasm.ScriptBuilder.fromScript(
      document.getElementById("listScript").innerText,
    );

    let P2SHEntries = [];
    while (P2SHEntries.length === 0) {
      const P2SHUTXOs = await rpc.getUtxosByAddresses([P2SHAddress.toString()]);
      P2SHEntries = P2SHUTXOs.entries;

      if (P2SHEntries.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    const P2SHEntry = P2SHEntries[0];
    const entry = {
      address: P2SHEntry.address.toString(),
      amount: kaspaWasm.sompiToKaspaString(P2SHEntry.amount),
      scriptPublicKey: JSON.parse(P2SHEntry.scriptPublicKey.toString()),
      blockDaaScore: P2SHEntry.blockDaaScore.toString(),
      outpoint: JSON.parse(P2SHEntry.outpoint.toString()),
    };

    const sendPayload = {
      p: "krc-20",
      op: "send",
      tick: document.getElementById("tradeListTick").value.toLowerCase(),
    };

    const sendScriptBuilder = createKRC20ScriptBuilder(sendPayload);
    const sendScriptPublicKey = sendScriptBuilder.createPayToScriptHashScript();
    const sendP2SHAddress = kaspaWasm.addressFromScriptPublicKey(
      sendScriptPublicKey,
      "testnet-10",
    );

    document.getElementById("sendP2SHAddress").innerText =
      sendP2SHAddress.toString();
    document.getElementById("sendScript").innerText =
      sendScriptBuilder.toString();

    const revealTxId = await kastle.signAndBroadcastTx(
      "testnet-10",
      [{ amount: "0.3", address: sendP2SHAddress.toString() }],
      {
        priorityEntries: [entry],
        scripts: [
          {
            scriptHex: listScriptBuilder.toString(),
            inputIndex: 0,
          },
        ],
        priorityFee: "1",
      },
    );

    document.getElementById("listRevealTxId").innerText = revealTxId;
    document.getElementById("listErrorKRC20").innerText = "";
  } catch (error) {
    document.getElementById("listErrorKRC20").innerText = error.message;
  } finally {
    rpc.disconnect();
  }
});

document
  .getElementById("preparedSendTx")
  .addEventListener("click", async () => {
    const rpc = new kaspaWasm.RpcClient({
      url: "wss://ws.tn10.kaspa.forbole.com/borsh",
      networkId: "testnet-10",
    });
    await rpc.connect();

    try {
      const sendP2SHAddress =
        document.getElementById("sendP2SHAddress").innerText;
      const sendScriptBuilder = kaspaWasm.ScriptBuilder.fromScript(
        document.getElementById("sendScript").innerText,
      );
      const sellerAddress = document.getElementById("address").innerText;

      let sendP2SHEntries = [];
      while (sendP2SHEntries.length === 0) {
        const sendP2SHUTXOs = await rpc.getUtxosByAddresses([
          sendP2SHAddress.toString(),
        ]);
        sendP2SHEntries = sendP2SHUTXOs.entries;
      }

      const tx = new kaspaWasm.createTransaction(
        [sendP2SHEntries[0]],
        [{ address: sellerAddress, amount: kaspaWasm.kaspaToSompi("1") }],
        0n,
      );

      const preparedTxJson = tx.serializeToSafeJSON();
      const signedTx = await kastle.signTx("testnet-10", preparedTxJson, [
        {
          inputIndex: 0,
          scriptHex: sendScriptBuilder.toString(),
          signType: "SingleAnyOneCanPay",
        },
      ]);
      document.getElementById("sendPreparedTx").innerText = signedTx;
      document.getElementById("sendPreparedError").innerText = "None";
    } catch (error) {
      document.getElementById("sendPreparedError").innerText = error;
    } finally {
      rpc.disconnect();
    }
  });

document
  .getElementById("krcCancelReveal")
  .addEventListener("click", async () => {
    const rpc = new kaspaWasm.RpcClient({
      url: "wss://ws.tn10.kaspa.forbole.com/borsh",
      networkId: "testnet-10",
    });
    await rpc.connect();

    try {
      const P2SHAddress = document.getElementById("sendP2SHAddress").innerText;
      const sendScriptBuilder = kaspaWasm.ScriptBuilder.fromScript(
        document.getElementById("sendScript").innerText,
      );

      let P2SHEntries = [];
      while (P2SHEntries.length === 0) {
        const P2SHUTXOs = await rpc.getUtxosByAddresses([
          P2SHAddress.toString(),
        ]);
        P2SHEntries = P2SHUTXOs.entries;

        if (P2SHEntries.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      const P2SHEntry = P2SHEntries[0];
      const entry = {
        address: P2SHEntry.address.toString(),
        amount: kaspaWasm.sompiToKaspaString(P2SHEntry.amount),
        scriptPublicKey: JSON.parse(P2SHEntry.scriptPublicKey.toString()),
        blockDaaScore: P2SHEntry.blockDaaScore.toString(),
        outpoint: JSON.parse(P2SHEntry.outpoint.toString()),
      };
      const revealTxId = await kastle.signAndBroadcastTx("testnet-10", [], {
        priorityEntries: [entry],
        scripts: [
          {
            scriptHex: sendScriptBuilder.toString(),
            inputIndex: 0,
          },
        ],
        priorityFee: "0.02",
      });
      document.getElementById("cancelTradeTxId").innerText = revealTxId;
      document.getElementById("cancelErrorKRC20").innerText = "";
    } catch (error) {
      document.getElementById("cancelErrorKRC20").innerText = error.message;
    } finally {
      rpc.disconnect();
    }
  });

document.getElementById("krcBuyReveal").addEventListener("click", async () => {
  const txJson = document.getElementById("sendPreparedTx").innerText;
  const tx = kaspaWasm.Transaction.deserializeFromSafeJSON(txJson);

  const address = document.getElementById("address").innerText;
  const rpc = new kaspaWasm.RpcClient({
    url: "wss://ws.tn10.kaspa.forbole.com/borsh",
    networkId: "testnet-10",
  });
  await rpc.connect();

  try {
    const amount = tx.outputs
      .map((output) => output.value)
      .reduce((a, b) => a + b, 0n);
    const entries = [];
    const utxos = await rpc.getUtxosByAddresses([address]);
    let total = 0n;
    const fee = kaspaWasm.kaspaToSompi("0.01");
    while (total < amount + fee) {
      const entry = utxos.entries.pop();
      entries.push(entry);
      total += entry.amount;
    }

    const newInputs = entries.map((entry) => {
      return {
        previousOutpoint: entry.outpoint,
        sequence: 0n,
        sigOpCount: 1,
        utxo: entry,
      };
    });

    tx.inputs = [...tx.inputs, ...newInputs];
    const balanceOfInputs = tx.inputs
      .map((input) => input.utxo.amount)
      .reduce((a, b) => a + b, 0n);
    const change = balanceOfInputs - amount - fee;
    tx.outputs = [
      ...tx.outputs,
      { value: change, scriptPublicKey: kaspaWasm.payToAddressScript(address) },
    ];

    const signedTx = await kastle.signTx(
      "testnet-10",
      tx.serializeToSafeJSON(),
    );
    const { transactionId } = await rpc.submitTransaction(
      kaspaWasm.Transaction.deserializeFromSafeJSON(signedTx),
    );
    document.getElementById("buyTradeTxId").innerText = transactionId;
  } catch (error) {
    document.getElementById("buyErrorKRC20").innerText = error.message;
  } finally {
    rpc.disconnect();
  }
});
