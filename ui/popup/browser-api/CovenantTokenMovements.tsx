import TokenItem from "@/ui/popup/kcc20/TokenItem";
import { formatBalance } from "@/components/send/kcc20-send/formatBalance";
import { textEllipsis } from "@/lib/utils";
import type { DappTokenMovement } from "@/lib/kcc20/dapp-request";

export type CovenantTokenMovementsProps = {
  movements: DappTokenMovement[];
  status: "loading" | "ready" | "failed";
  // "mainnet" is the only network where standard KCC-20 pieces are checked.
  network: string;
};

const ROW =
  "-mt-px border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg";

/** One row per token: pieces of the same token (and extension) are summed, their destinations joined. */
function byToken(movements: DappTokenMovement[]) {
  const rows = new Map<
    string,
    { m: DappTokenMovement; amount: bigint; to: Set<string> }
  >();
  for (const m of movements) {
    const key = `${m.covenantId}:${m.extensionCommitment ?? ""}`;
    const row = rows.get(key) ?? { m, amount: 0n, to: new Set<string>() };
    row.amount += m.amount;
    m.destinations.forEach((d) =>
      row.to.add(
        d.address === null
          ? `Unknown destination (output ${d.outputIndex})`
          : textEllipsis(d.address),
      ),
    );
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** The KCC-20 pieces a covenant (version 1+) dApp request takes from the wallet. Renders only; never fetches. */
export function CovenantTokenMovements({
  movements,
  status,
  network,
}: CovenantTokenMovementsProps) {
  return (
    <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
      {status === "loading" && (
        <li className={ROW} role="status">
          Checking which KCC-20 tokens this request moves…
        </li>
      )}
      {status === "failed" && (
        <li className={`${ROW} text-red-500`} role="alert">
          Kastle could not check which KCC-20 tokens this request moves, so it
          cannot be confirmed.
        </li>
      )}
      {status === "ready" && movements.length === 0 && (
        <li className={ROW}>
          {network === "mainnet"
            ? "This request does not move any KCC-20 tokens from your wallet."
            : "No KCC-20 tokens that Kastle can check on this network move in this request. Standard KCC-20 tokens cannot be checked here."}
        </li>
      )}
      {status === "ready" && movements.length > 0 && (
        <>
          <li className={`${ROW} font-medium`}>
            KCC-20 tokens leaving your wallet
          </li>
          {byToken(movements).map(({ m, amount, to }) => (
            <li
              key={`${m.covenantId}:${m.extensionCommitment ?? ""}`}
              className={`${ROW} py-0`}
            >
              <TokenItem
                name={m.symbol || textEllipsis(m.covenantId)}
                subtitle={to.size > 0 ? `To ${[...to].join(", ")}` : undefined}
                amount={
                  m.decimals === undefined
                    ? `-${amount} base units`
                    : `-${formatBalance(amount, m.decimals)}`
                }
                network="kcc20"
              />
            </li>
          ))}
        </>
      )}
    </ul>
  );
}
