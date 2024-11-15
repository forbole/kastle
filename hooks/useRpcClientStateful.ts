import { RpcClientContext } from "@/contexts/RpcClientContext.tsx";

// TODO rename after removal of useRpcClient
export default function useRpcClientStateful() {
  return useContext(RpcClientContext);
}
