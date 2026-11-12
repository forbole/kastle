import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
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
  args: {
    onBack: fn(),
    onClose: fn(),
    onOpenKatBridge: fn(),
  },
} satisfies Meta<typeof MigrationGuidePage>;

export default meta;

type Story = StoryObj<typeof meta>;

// Step 1: what is changing; Next is the only way into step 2.
export const Default: Story = {};

// Step 2: the KAT Bridge steps, the seed-phrase notice and the Open CTA.
export const BridgeSteps: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Next" }));
    await expect(
      canvas.getByRole("heading", { name: "Follow these steps on KAT Bridge" }),
    ).toHaveFocus();
    await expect(
      canvas.getByRole("button", { name: "Open KAT Bridge" }),
    ).toBeVisible();
  },
};
