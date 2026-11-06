import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Switch from "./Switch";

const meta: Meta<typeof Switch> = {
  title: "General/Switch",
  component: Switch,
  decorators: [
    (Story) => (
      <div className="flex w-[340px] gap-4 bg-icy-blue-950 p-4 font-sans">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const ShownHidden: Story = {
  render: () => {
    function Wrapper() {
      const [a, setA] = useState(true);
      const [b, setB] = useState(false);
      return (
        <>
          <Switch checked={a} onChange={setA} label="Show KASPY" />
          <Switch checked={b} onChange={setB} label="Show NACHO" />
          <Switch checked disabled onChange={() => {}} label="Disabled" />
        </>
      );
    }
    return <Wrapper />;
  },
};
