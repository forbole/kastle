import { KaspaPriceContext } from "@/contexts/KaspaPriceContext.tsx";

export default function useKaspaPrice() {
  return useContext(KaspaPriceContext);
}
