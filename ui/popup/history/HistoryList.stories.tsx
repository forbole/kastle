import type { Meta, StoryObj } from "@storybook/react";
import type { HistoryRecord } from "@/lib/history/types";
import { HistoryList } from "@/ui/popup/history/HistoryList";

const NOW = Date.UTC(2026, 10, 10, 11, 51);
const ADDRESS =
  "kaspa:qpamkvhgh0kzx50gwvvp5xs8ktmqutcy3dfs9dc3w7lm9rq0zs76vf959mmrp";
const TXID = "9f1c2b7e4d3a5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8";

function record(overrides: Partial<HistoryRecord> & { id: string }) {
  return {
    family: "kcc20",
    txid: TXID,
    kind: "receive",
    direction: "in",
    amount: {
      value: { raw: "123456000000", decimals: 8, symbol: "NACHO" },
      quality: "exact",
    },
    kasLeg: { value: null, quality: "unavailable" },
    fiat: { value: null, quality: "unavailable" },
    time: { value: NOW, quality: "exact" },
    counterparty: { value: { address: ADDRESS }, quality: "exact" },
    fee: { value: null, quality: "unavailable" },
    status: "finalized",
    explorer: { url: `https://kaspa.stream/transactions/${TXID}` },
    ...overrides,
  } satisfies HistoryRecord;
}

const RECORDS: HistoryRecord[] = [
  record({ id: "in" }),
  record({
    id: "out",
    kind: "send",
    direction: "out",
    counterparty: {
      value: { address: ADDRESS, label: "alice.kas" },
      quality: "exact",
    },
    time: { value: NOW - 3_600_000, quality: "exact" },
  }),
  record({
    id: "self",
    kind: "self",
    direction: "self",
    time: { value: NOW - 7_200_000, quality: "exact" },
  }),
  record({
    id: "unknown",
    kind: "unknown",
    direction: "in",
    status: "unknown",
    amount: {
      value: { raw: "50000000", decimals: 8, symbol: "NACHO" },
      quality: "approximate",
    },
    explorer: null,
  }),
  record({ id: "pending", status: "pending" }),
  record({
    id: "failed",
    kind: "send",
    direction: "out",
    status: "failed",
  }),
  record({
    id: "no-amount",
    kind: "buy",
    amount: { value: null, quality: "unavailable" },
    counterparty: { value: null, quality: "unavailable" },
  }),
  record({
    id: "no-time",
    kind: "sell",
    direction: "out",
    time: { value: null, quality: "unavailable" },
    txid: null,
  }),
];

const meta = {
  title: "Popup/History/HistoryList",
  component: HistoryList,
  decorators: [
    (Story) => (
      <div className="relative flex min-h-[600px] w-[375px] flex-col bg-daintree-900 p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    records: RECORDS,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    onLoadMore: () => {},
    onRetry: () => {},
  },
} satisfies Meta<typeof HistoryList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const Empty: Story = { args: { records: [] } };

export const Loading: Story = { args: { records: [], isLoading: true } };

export const LoadError: Story = {
  args: { records: [], error: new Error("network") },
};

export const Unavailable: Story = {
  args: { unavailableMessage: "History is shown on mainnet only." },
};

export const Truncated: Story = {
  args: { truncatedMessage: "Older history is not shown." },
};
