import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import SegmentedControl from "./SegmentedControl";

const meta: Meta<typeof SegmentedControl> = {
  title: "General/SegmentedControl",
  component: SegmentedControl,
  decorators: [
    (Story) => (
      <div className="w-[340px] bg-icy-blue-950 p-4 font-sans">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SegmentedControl>;

export const MainnetTestnet: Story = {
  render: () => {
    function Wrapper() {
      const [value, setValue] = useState("mainnet");
      return (
        <SegmentedControl
          options={[
            { label: "Mainnet", value: "mainnet" },
            { label: "Testnet", value: "testnet" },
          ]}
          value={value}
          onChange={setValue}
        />
      );
    }
    return <Wrapper />;
  },
};
