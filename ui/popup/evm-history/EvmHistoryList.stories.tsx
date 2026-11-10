import type { Meta, StoryObj } from "@storybook/react";
import type { HistoryRecord } from "@/lib/history/types";
import { EvmHistoryList } from "@/ui/popup/evm-history/EvmHistoryList";

const OWNER = "0x1111111111111111111111111111111111111111";
const PEER = "0x2222222222222222222222222222222222222222";
const NOW = Date.UTC(2026, 10, 10, 15, 4);
const NA = { value: null, quality: "unavailable" } as const;

function record(over: Partial<HistoryRecord> & { id: string }): HistoryRecord {
  return {
    family: "evm-native",
    txid: over.id,
    kind: "send",
    direction: "out",
    amount: {
      value: { raw: "1500000000000000000", decimals: 18, symbol: "KAS" },
      quality: "exact",
    },
    kasLeg: NA,
    fiat: NA,
    time: { value: NOW, quality: "exact" },
    counterparty: {
      value: { address: PEER, label: "0x2222…2222" },
      quality: "exact",
    },
    fee: NA,
    status: "finalized",
    explorer: { url: `https://explorer.kasplex.org/tx/${over.id}` },
    ...over,
  };
}

const native: HistoryRecord[] = [
  record({ id: "0xa1" }),
  record({
    id: "0xa2",
    kind: "receive",
    direction: "in",
    time: { value: NOW - 3_600_000, quality: "exact" },
  }),
  record({
    id: "0xa3",
    kind: "deploy",
    amount: NA,
    counterparty: NA,
    time: { value: NOW - 86_400_000, quality: "exact" },
  }),
  record({
    id: "0xa4",
    kind: "self",
    direction: "self",
    counterparty: { value: { address: OWNER }, quality: "exact" },
    explorer: null,
  }),
];

const usdc = (raw: string) => ({
  value: { raw, decimals: 6, symbol: "USDC" },
  quality: "exact" as const,
});
const erc20: HistoryRecord[] = [
  record({
    id: "0xb1:0",
    family: "erc20",
    kind: "mint",
    direction: "in",
    amount: usdc("1000000000"),
  }),
  record({ id: "0xb2:3", family: "erc20", amount: usdc("250500000") }),
  record({
    id: "0xb3:1",
    family: "erc20",
    kind: "receive",
    direction: "in",
    amount: usdc("1"),
  }),
];

const meta: Meta<typeof EvmHistoryList> = {
  title: "EvmHistory/EvmHistoryList",
  component: EvmHistoryList,
  decorators: [
    (Story) => (
      <div className="w-[375px] bg-icy-blue-950 p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    records: [],
    isLoading: false,
    error: null,
    unavailable: null,
    hasMore: false,
    isFetchingMore: false,
    loadMore: () => {},
    onRetry: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof EvmHistoryList>;

export const Native: Story = { args: { records: native, hasMore: true } };
export const Erc20: Story = { args: { records: erc20, symbol: "USDC" } };
export const Loading: Story = { args: { isLoading: true } };
export const Empty: Story = {};
export const Unavailable: Story = {
  args: {
    unavailable: { reason: "History is not available for this network" },
  },
};
export const Error: Story = {
  args: { error: new globalThis.Error("Explorer answered 502") },
};
export const ErrorWithRecords: Story = {
  args: {
    records: native,
    hasMore: true,
    error: new globalThis.Error("Explorer answered 502"),
  },
};
export const FetchingMore: Story = {
  args: { records: native, hasMore: true, isFetchingMore: true },
};
export const PendingAndFailed: Story = {
  args: {
    records: [
      record({ id: "0xc1", status: "pending" }),
      record({
        id: "0xc2",
        status: "failed",
        time: { value: NOW - 60_000, quality: "approximate" },
      }),
    ],
  },
};
