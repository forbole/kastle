import { expect, test } from "@playwright/test";
import http from "node:http";
import {
  ContractFunctionRevertedError,
  createPublicClient,
  http as httpTransport,
  RpcRequestError,
} from "viem";
import { handleViemError, nodeFundsReason } from "@/lib/errors";

// handleViemError on the errors viem actually throws: a local JSON-RPC node
// answers every call with the error under test, through viem's http transport.
let url: string;
let server: http.Server;
let nextError: { code: number; message: string; data?: string };

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id } = JSON.parse(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error: nextError }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/rpc-secret-path`;
});
test.afterAll(() => server?.close());

const client = () =>
  createPublicClient({ transport: httpTransport(url, { retryCount: 0 }) });

async function thrownBy(
  call: "estimateGas" | "sendRawTransaction",
  error: typeof nextError,
) {
  nextError = error;
  try {
    if (call === "estimateGas")
      await client().estimateGas({
        account: "0x00000000000000000000000000000000000000aa",
        to: "0x00000000000000000000000000000000000000cc",
      });
    else await client().sendRawTransaction({ serializedTransaction: "0x02" });
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
}

const INTERNAL = { code: 5000, message: "Internal error" };

test("sendRawTransaction: node's insufficient-funds sentence reaches the page", async () => {
  const sentence =
    "insufficient funds for gas * price + value: balance 29300000000000000, tx cost 80673600000000000, overshot 51373600000000000";
  const out = handleViemError(
    await thrownBy("sendRawTransaction", { code: -32000, message: sentence }),
  );
  expect(out).toEqual({ code: -32000, message: sentence });
  expect(out.message).not.toContain("rpc-secret-path");
});

test("gas required exceeds allowance: reason, not Internal error (both call sites)", async () => {
  const reason = "gas required exceeds allowance (12183)";
  for (const call of ["sendRawTransaction", "estimateGas"] as const) {
    const out = handleViemError(
      await thrownBy(call, { code: -32000, message: reason }),
    );
    expect(out.message).toContain(reason);
    expect(out.message).not.toContain("Internal error");
    expect(out.message).not.toContain("127.0.0.1");
  }
});

test("estimateGas insufficient funds (wrapped in InsufficientFundsError): the node's reason", async () => {
  const sentence =
    "insufficient funds for gas * price + value: have 29300000000000000 want 80673600000000000";
  const err = await thrownBy("estimateGas", {
    code: -32000,
    message: sentence,
  });
  // viem's getNodeError layer sits between the estimate and the RPC error.
  expect((err as { cause?: { name?: string } }).cause?.name).toBe(
    "InsufficientFundsError",
  );
  expect(nodeFundsReason(err)).toBe(sentence);
  expect(handleViemError(err)).toEqual({ code: -32000, message: sentence });
});

test("every other error maps exactly as before", async () => {
  // A -32000 that is not about funds: unchanged INTERNAL_ERROR / estimate copy.
  expect(
    handleViemError(
      await thrownBy("sendRawTransaction", {
        code: -32000,
        message: "nonce too low",
      }),
    ),
  ).toEqual(INTERNAL);
  expect(
    handleViemError(
      await thrownBy("estimateGas", { code: -32000, message: "nonce too low" }),
    ),
  ).toEqual({ code: 3, message: "Failed to estimate gas" });
  expect(
    handleViemError(
      await thrownBy("estimateGas", {
        code: 3,
        message: "execution reverted: Pausable: paused",
      }),
    ),
  ).toEqual({
    code: 3,
    message: "Reverted: execution reverted: Pausable: paused",
  });
  expect(
    handleViemError(
      new ContractFunctionRevertedError({ abi: [], functionName: "f" }),
    ),
  ).toEqual({ code: 3, message: "Reverted: Unknown reason" });
  expect(
    handleViemError(
      new RpcRequestError({
        body: {},
        url,
        error: { code: -32005, message: "limit exceeded" },
      }),
    ),
  ).toEqual({ code: -32005, message: "RPC Request failed." });
  expect(handleViemError(new Error("insufficient funds"))).toEqual(INTERNAL);
  expect(handleViemError("nope")).toEqual(INTERNAL);
});
