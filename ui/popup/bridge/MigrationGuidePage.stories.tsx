import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import MigrationGuidePage from "@/ui/popup/bridge/MigrationGuidePage";

const meta = {
  title: "Popup/Bridge/Screens/MigrationGuidePage",
  component: MigrationGuidePage,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="relative h-[600px] w-[375px] overflow-hidden bg-icy-blue-950 font-sans text-white">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    onBack: { action: "back" },
    onClose: { action: "close" },
    onOpenKatBridge: { action: "open KAT Bridge" },
  },
} satisfies Meta<typeof MigrationGuidePage>;

export default meta;

type Story = StoryObj<typeof meta>;

// Step 1; Next goes to step 2 (what to do on KAT Bridge).
export const Default: Story = {
  args: {
    onBack: fn(),
    onClose: fn(),
    onOpenKatBridge: fn(),
  },
};
