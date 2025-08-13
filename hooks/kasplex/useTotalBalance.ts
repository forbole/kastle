import useTotalBalanceByAccount from "./useTotalBalanceByAccount";

export default function useTotalBalance() {
  const { account } = useWalletManager();
  return useTotalBalanceByAccount(account?.balance ? account : undefined);
}
