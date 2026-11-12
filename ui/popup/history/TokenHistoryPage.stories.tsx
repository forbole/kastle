import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { MemoryRouter } from "react-router-dom";
import TokenDetailPage, {
  type TokenDetailTab,
} from "@/ui/popup/kcc20/TokenDetailPage";
import { HistoryList } from "@/ui/popup/history/HistoryList";
import { userEvent, within } from "storybook/test";
import type { HistoryRecord } from "@/lib/history/types";
import {
  KCC20_RECORDS,
  KRC20_RECORDS,
  designedDetail,
  designedRow,
} from "@/ui/popup/history/historyFixtures";

// The full popup page: the shared token header + tabs, HistoryList in the
// history slot, and the pinned Send button.
const meta = {
  title: "Popup/History/Screens/TokenHistoryPage",
  component: TokenDetailPage,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      // The shared asset header reads the router.
      <MemoryRouter>
        <div className="relative h-[600px] w-[375px] overflow-hidden bg-icy-blue-950 font-sans text-white">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
  argTypes: {
    onBack: { action: "back" },
    onClose: { action: "close" },
    onSend: { action: "send" },
  },
} satisfies Meta<typeof TokenDetailPage>;

export default meta;

type Story = StoryObj<typeof meta>;

const PAGE = {
  name: "NACHO",
  priceLabel: "$0.00041",
  network: "krc20",
  networkName: "Kaspa",
  tokenId: "84b93d7f...48dj6",
} as const;

function Page({
  isLoadingMore = false,
  records = KRC20_RECORDS,
  onSend,
}: {
  isLoadingMore?: boolean;
  records?: HistoryRecord[];
  onSend?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TokenDetailTab>("history");
  return (
    <TokenDetailPage
      {...PAGE}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onSend={onSend ?? (() => {})}
      history={
        <HistoryList
          records={records}
          isLoading={false}
          isLoadingMore={isLoadingMore}
          error={null}
          hasMore={isLoadingMore}
          onLoadMore={() => {}}
          onRetry={() => {}}
          getRowExtras={designedRow}
          getDetailExtras={designedDetail}
        />
      }
    />
  );
}

export const Default: Story = {
  args: { ...PAGE, activeTab: "history", onTabChange: () => {} },
  render: (args) => <Page onSend={args.onSend} />,
};

export const LoadMore: Story = {
  args: Default.args,
  render: (args) => <Page isLoadingMore onSend={args.onSend} />,
};

// KCC-20 page with a row tapped: the TX Hash sheet as mobile draws it.
export const DetailSheet: Story = {
  args: {
    ...PAGE,
    network: "kcc20",
    activeTab: "history",
    onTabChange: () => {},
  },
  render: (args) => <Page records={KCC20_RECORDS} onSend={args.onSend} />,
  play: async ({ canvasElement }) => {
    const [row] = within(canvasElement).getAllByText("Received");
    await userEvent.click(row);
  },
};
