import { DependencyList } from "react";
import { IStaticMethods } from "preline/preline";

declare global {
  interface Window {
    HSStaticMethods: IStaticMethods;
  }
}

export default function useResetPreline(deps?: DependencyList) {
  useEffect(() => {
    window.HSStaticMethods.autoInit();
  }, [deps]);
}
