import type { Meta, StoryObj } from "@storybook/react";
import {
  Kcc20HistoryDetail,
  Kcc20HistoryDetailRow,
} from "@/components/kcc20-asset/Kcc20History";

// The activity sheet body: TX Hash, the time, Status only when the feed
// answers it, the truncated TX ID with copy, and View on Explorer.
const meta: Meta<typeof Kcc20HistoryDetail> = {
  title: "Popup/Kcc20/Kcc20HistoryDetail",
  component: Kcc20HistoryDetail,
  argTypes: { onClose: { action: "close" } },
  decorators: [
    (Story) => (
      <div className="w-[375px] rounded-t-3xl bg-icy-blue-950 p-4 font-sans">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Kcc20HistoryDetail>;

const row: Kcc20HistoryDetailRow = {
  id: "r1",
  txid: "f34f0243a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829e9cad",
  kind: "send",
  direction: "out",
  amount: 1000n,
  counterparty: { address: "kaspa:qf34f0243", label: "f34f0243...e9cad" },
  timeMs: Date.UTC(2026, 9, 1, 12),
  approxTime: true,
};

/** kascov today: no status field, so no Status row. */
export const WithoutStatus: Story = { args: { row } };

/** A feed that answers status gets the pill. */
export const WithStatus: Story = {
  args: { row: { ...row, status: "Confirmed" } },
};
