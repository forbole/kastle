import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ActionSheet from "./ActionSheet";
import AddCustomNodeForm from "@/ui/popup/custom-rpc/AddCustomNodeForm";

const meta: Meta<typeof ActionSheet> = {
  title: "General/ActionSheet",
  component: ActionSheet,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="relative h-[600px] w-[375px] overflow-hidden bg-icy-blue-950 font-sans text-white">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    onClose: { action: "close" },
  },
};

export default meta;
type Story = StoryObj<typeof ActionSheet>;

/** ActionSheet is a generic overlay shell — it only renders a backdrop + sliding sheet frame.
 * Real content (e.g. AddCustomNodeForm below) is passed in as children by the consumer. */
export const Open: Story = {
  render: () => {
    function Wrapper() {
      const [name, setName] = useState("");
      const [url, setUrl] = useState("");
      return (
        <ActionSheet isOpen>
          <AddCustomNodeForm
            name={name}
            url={url}
            onNameChange={setName}
            onUrlChange={setUrl}
            onSubmit={() => {}}
          />
        </ActionSheet>
      );
    }
    return <Wrapper />;
  },
};
