import useTotalBalanceByAccount from "./useTotalBalanceByAccount";
import useWalletManager from "../wallet/useWalletManager";

export default function useTotalBalance() {
  const { account } = useWalletManager();
  return useTotalBalanceByAccount(account);
}
