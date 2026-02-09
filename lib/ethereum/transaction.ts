import { PublicClient, Hex, TransactionSerializable, hexToNumber } from "viem";

interface SendEvmTransactionParams {
  ethClient: PublicClient;
  signer: {
    signTransaction: (transaction: TransactionSerializable) => Promise<Hex>;
  };
  sender: Hex;
  to: Hex;
  valueInWei?: bigint;
  gas: bigint;
  chainId: Hex | number;
  data?: Hex;
}

export async function sendEvmTransaction({
  ethClient,
  signer,
  sender,
  to,
  valueInWei,
  gas,
  chainId,
  data,
}: SendEvmTransactionParams): Promise<Hex> {
  const [estimatedGas, nonce, gasPrice] = await Promise.all([
    ethClient.estimateFeesPerGas(),
    ethClient.getTransactionCount({
      address: sender,
    }),
    ethClient.getGasPrice(),
  ]);
  // Use the higher of estimated or minimum required gas price
  const maxFeePerGas = estimatedGas.maxFeePerGas
    ? estimatedGas.maxFeePerGas > gasPrice
      ? estimatedGas.maxFeePerGas
      : gasPrice
    : gasPrice;

  const maxPriorityFeePerGas = estimatedGas.maxPriorityFeePerGas
    ? estimatedGas.maxPriorityFeePerGas > gasPrice
      ? estimatedGas.maxPriorityFeePerGas
      : gasPrice
    : gasPrice;

  const transaction: TransactionSerializable = {
    to,
    value: valueInWei,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: typeof chainId === "number" ? chainId : hexToNumber(chainId),
    type: "eip1559",
    nonce,
    ...(data && { data }),
  };

  const signed = await signer.signTransaction(transaction);
  const txId = await ethClient.sendRawTransaction({
    serializedTransaction: signed,
  });

  return txId;
}
