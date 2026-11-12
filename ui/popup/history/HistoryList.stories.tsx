import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "storybook/test";
import { HistoryList } from "@/ui/popup/history/HistoryList";
import {
  COMMON_EXTRAS,
  KCC20_RECORDS,
  KRC20_EXTRAS,
  KRC20_RECORDS,
  RECORDS,
  designedDetail,
  designedRow,
} from "@/ui/popup/history/historyFixtures";

const meta = {
  title: "Popup/History/Components/HistoryList",
  component: HistoryList,
  decorators: [
    (Story) => (
      <div className="relative flex min-h-[600px] w-[375px] flex-col bg-daintree-900 p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    getRowExtras: designedRow,
    getDetailExtras: designedDetail,
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

// Pointer over "TX Hash" opens the card: date, Committed, Revealed (KRC-20 only).
export const Hover: Story = {
  args: { records: KRC20_RECORDS, getRowExtras: () => KRC20_EXTRAS },
  play: async ({ canvasElement }) => {
    const [hash] = within(canvasElement).getAllByText("TX Hash");
    await userEvent.hover(hash);
  },
};

// Any other family: date, then the record's status with the explorer link.
export const HoverOtherFamily: Story = {
  args: { records: KCC20_RECORDS, getRowExtras: () => COMMON_EXTRAS },
  play: Hover.play,
};

// Next page in flight: the small spinner under the last row.
export const LoadMore: Story = {
  args: {
    records: KRC20_RECORDS,
    hasMore: true,
    isLoadingMore: true,
    getRowExtras: () => KRC20_EXTRAS,
  },
};
