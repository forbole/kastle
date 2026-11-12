import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { MemoryRouter } from "react-router-dom";
import TokenDetailPage, {
  type TokenDetailTab,
} from "@/ui/popup/kcc20/TokenDetailPage";
import { HistoryList } from "@/ui/popup/history/HistoryList";
import { KRC20_RECORDS, designedRow } from "@/ui/popup/history/historyFixtures";

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
  onSend,
}: {
  isLoadingMore?: boolean;
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
          records={KRC20_RECORDS}
          isLoading={false}
          isLoadingMore={isLoadingMore}
          error={null}
          hasMore={isLoadingMore}
          onLoadMore={() => {}}
          onRetry={() => {}}
          getRowExtras={designedRow}
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
