import type { Meta, StoryObj } from "@storybook/react";
import CurveProgress from "./CurveProgress";

const meta: Meta<typeof CurveProgress> = {
  title: "Popup/Kasseal/Components/CurveProgress",
  component: CurveProgress,
  decorators: [
    (Story) => (
      <div className="w-[343px] bg-icy-blue-950 p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof CurveProgress>;

export const Half: Story = {
  args: { percent: 50, raised: "50,000 / 100,000 KAS" },
};
export const Compact: Story = { args: { percent: 12, compact: true } };
export const Full: Story = { args: { percent: 100 } };
