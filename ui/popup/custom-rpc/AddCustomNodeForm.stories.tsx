import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ActionSheet from "@/ui/general/ActionSheet";
import AddCustomNodeForm from "./AddCustomNodeForm";

const meta: Meta<typeof AddCustomNodeForm> = {
  title: "Popup/CustomRpc/Components/AddCustomNodeForm",
  component: AddCustomNodeForm,
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
    onSubmit: { action: "submit" },
  },
};

export default meta;
type Story = StoryObj<typeof AddCustomNodeForm>;

function InteractiveTemplate({
  initialName = "",
  initialUrl = "",
  urlError,
  submitting = false,
}: {
  initialName?: string;
  initialUrl?: string;
  urlError?: string;
  submitting?: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);

  return (
    <ActionSheet isOpen>
      <AddCustomNodeForm
        name={name}
        url={url}
        onNameChange={setName}
        onUrlChange={setUrl}
        urlError={urlError}
        submitting={submitting}
        onSubmit={() => {}}
      />
    </ActionSheet>
  );
}

export const Empty: Story = {
  render: () => <InteractiveTemplate />,
};

export const Filled: Story = {
  render: () => (
    <InteractiveTemplate
      initialName="Community node"
      initialUrl="community-node37814791hdsahdvcxvjsahk2.com"
    />
  ),
};

export const Error: Story = {
  render: () => (
    <InteractiveTemplate
      initialName="Community node"
      initialUrl="Community-node37814791hdsahdvcxvjsahk2.c"
      urlError="Enter a valid WebSocket address (ws:// or wss://)"
    />
  ),
};

export const Submitting: Story = {
  render: () => (
    <InteractiveTemplate
      initialName="Community node"
      initialUrl="community-node37814791hdsahdvcxvjsahk2.com"
      submitting
    />
  ),
};
