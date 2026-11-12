import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "storybook/test";
import { HistoryList } from "@/ui/popup/history/HistoryList";
import {
  KRC20_EXTRAS,
  KRC20_RECORDS,
  LONG_AMOUNT_RECORDS,
  NO_COUNTERPARTY_RECORDS,
  NO_PRICE_RECORDS,
  OTHER_YEAR_RECORDS,
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

// No price: no fiat line, the amount stays level with the title.
export const NoPrice: Story = { args: { records: NO_PRICE_RECORDS } };

// A very long amount stays on one line and ends in an ellipsis.
export const LongAmount: Story = { args: { records: LONG_AMOUNT_RECORDS } };

// No counterparty: "Sent" alone; a mint never names an address.
export const NoCounterparty: Story = {
  args: { records: NO_COUNTERPARTY_RECORDS },
};

// Another year shows the year in the date.
export const OtherYear: Story = { args: { records: OTHER_YEAR_RECORDS } };

// KRC-20 row tapped: the sheet's Status row lists Committed and Revealed.
export const SheetSteps: Story = {
  args: { records: KRC20_RECORDS, getRowExtras: () => KRC20_EXTRAS },
  play: async ({ canvasElement }) => {
    const [row] = within(canvasElement).getAllByText(/^Sent to/);
    await userEvent.click(row);
  },
};

// Sheet open, pointer over the To value: the full address in a tooltip.
export const SheetAddressTooltip: Story = {
  args: { records: KRC20_RECORDS, getRowExtras: () => KRC20_EXTRAS },
  play: async ({ canvasElement }) => {
    const [row] = within(canvasElement).getAllByText(/^Sent to/);
    await userEvent.click(row);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.hover(
      await body
        .findByRole("dialog")
        .then((dialog) => within(dialog).getByText(/^kaspa:/)),
    );
  },
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
