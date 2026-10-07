import useSWR from "swr";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { getDotk } from "@/lib/dotk/client";

// namesOf lists ACTIVE, indexed names only: a pending registration is invisible.
export function useDotkNames(address?: string, enabled = true) {
  const { networkId } = useRpcClientStateful();
  const { data, isLoading, error } = useSWR(
    enabled && address && networkId
      ? ["dotk", "names", networkId, address]
      : null,
    () => getDotk(networkId!).namesOf(address!),
  );
  return { names: data ?? [], isLoading, error };
}
