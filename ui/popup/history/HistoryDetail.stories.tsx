import type { Meta, StoryObj } from "@storybook/react";
import ActionSheet from "@/ui/general/ActionSheet";
import { HistoryDetail } from "@/ui/popup/history/HistoryDetail";
import { RECORDS, designedDetail } from "@/ui/popup/history/historyFixtures";

const byId = (id: string) => {
  const found = RECORDS.find((r) => r.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

// The sheet inside its ActionSheet frame, over a 375×600 popup.
const meta = {
  title: "Popup/History/Components/HistoryDetail",
  component: HistoryDetail,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="relative h-[600px] w-[375px] overflow-hidden bg-icy-blue-950 font-sans text-white">
        <ActionSheet isOpen>
          <Story />
        </ActionSheet>
      </div>
    ),
  ],
  argTypes: { onClose: { action: "close" } },
  args: {
    record: byId("in"),
    onClose: () => {},
    ...designedDetail(byId("in")),
  },
} satisfies Meta<typeof HistoryDetail>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Finalized: Story = {};

export const Pending: Story = {
  args: { record: byId("pending"), ...designedDetail(byId("pending")) },
};

export const Failed: Story = {
  args: { record: byId("failed"), ...designedDetail(byId("failed")) },
};

// The source never said either way: neutral word, no pill colour.
export const Unconfirmed: Story = {
  args: { record: byId("unknown"), ...designedDetail(byId("unknown")) },
};

// No time, no TX ID, no explorer link, no fiat: those rows drop out. Status always shows (unknown → see Unconfirmed).
const MISSING = { ...byId("no-time"), explorer: null };
export const MissingFields: Story = {
  args: {
    record: MISSING,
    status: designedDetail(MISSING).status,
    fiatText: undefined,
  },
};
