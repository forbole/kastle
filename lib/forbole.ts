import { NetworkType } from "@/contexts/SettingsContext.tsx";

export const FORBOLE_PAYOUT_ADDRESSES = {
  [NetworkType.Mainnet]:
    "kaspa:qzfyzpg4fn83skqk8m4ejsj5az88wjj04kkmw9t36w72p3mpqavzymp3amawn",
  [NetworkType.TestnetT10]:
    "kaspatest:qz0jqtnshjfde837j6jx08ymm4p000quf58e9cv00ql30f4ysceuyuec5msqx",
} as const;
