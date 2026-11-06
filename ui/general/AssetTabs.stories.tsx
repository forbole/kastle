import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import AssetTabs, { AssetTab } from "@/components/AssetTabs";

// The shared History | Token info bar. Real tabs: click, or focus one and use
// ←/→/Home/End; only the selected tab is a tab stop.
const meta: Meta<typeof AssetTabs> = {
  title: "General/AssetTabs",
  component: AssetTabs,
  decorators: [
    (Story) => (
      <div className="w-[340px] bg-icy-blue-950 p-4 font-sans">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AssetTabs>;

function Template({ initial }: { initial: AssetTab }) {
  const [active, setActive] = useState<AssetTab>(initial);
  return <AssetTabs active={active} onChange={setActive} />;
}

export const HistorySelected: Story = {
  render: () => <Template initial="history" />,
};

export const TokenInfoSelected: Story = {
  render: () => <Template initial="info" />,
};
