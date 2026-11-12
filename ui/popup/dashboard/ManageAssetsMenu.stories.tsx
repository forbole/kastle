import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import SegmentedControl from "@/ui/general/SegmentedControl";
import ManageAssetsMenu from "./ManageAssetsMenu";

// The menu sits at the right end of the dashboard tab row, so every story shows it there.
const meta: Meta<typeof ManageAssetsMenu> = {
  title: "Popup/ManageAssets/Components/ManageAssetsMenu",
  component: ManageAssetsMenu,
  argTypes: {
    onManageAssets: { action: "manageAssets" },
  },
  decorators: [
    (Story) => (
      <div className="h-[200px] w-[340px] bg-icy-blue-950 p-4 font-sans text-white">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ManageAssetsMenu>;

type DashboardTab = "assets" | "nft" | "names" | "text";
const TABS = [
  { label: "Assets", value: "assets" },
  { label: "NFT", value: "nft" },
  { label: "Names", value: "names" },
  { label: "TEXT", value: "text" },
] as const;

function TabRow(args: React.ComponentProps<typeof ManageAssetsMenu>) {
  const [tab, setTab] = useState<DashboardTab>("assets");
  return (
    <div className="flex items-center justify-between">
      <SegmentedControl options={[...TABS]} value={tab} onChange={setTab} />
      <ManageAssetsMenu {...args} isVisible={tab === "assets"} />
    </div>
  );
}

/** Closed. Click the icon to open it; click outside or press Esc to close. The icon hides off the Assets tab. */
export const Default: Story = {
  render: (args) => <TabRow {...args} />,
};

export const Open: Story = {
  args: { defaultOpen: true },
  render: (args) => <TabRow {...args} />,
};
