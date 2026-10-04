import useSWR from "swr";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { getDotk } from "@/lib/dotk/client";

// lookup (not resolveName) because /names 404s for pending and ownerUnknown
// names too: "not found" must never be read as "free". An active lookup
// already carries the resolved record.
export function useDotkName(name?: string) {
  const { networkId } = useRpcClientStateful();
  const { data, isLoading, error } = useSWR(
    name && networkId ? ["dotk", "name", networkId, name] : null,
    () => getDotk(networkId!).lookup(name!),
  );
  return { lookup: data, isLoading, error };
}
