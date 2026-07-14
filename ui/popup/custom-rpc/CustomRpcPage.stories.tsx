import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import CustomRpcPage, { RpcNetwork, RpcNode } from "./CustomRpcPage";

const meta: Meta<typeof CustomRpcPage> = {
  title: "Popup/CustomRpc/Screens/CustomRpcPage",
  component: CustomRpcPage,
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
    onBack: { action: "back" },
  },
};

export default meta;
type Story = StoryObj<typeof CustomRpcPage>;

const mainnetDefault: RpcNode = {
  id: "mainnet-default",
  name: "Kastle node",
  url: "kastle-mainnet-borsh.rhyzome.co",
  isDefault: true,
};

const mainnetCommunity: RpcNode = {
  id: "mainnet-community",
  name: "Community node",
  url: "community-node.com",
};

const testnetDefault: RpcNode = {
  id: "testnet-default",
  name: "Kastle node",
  url: "kastle-testnet-borsh.rhyzome.co",
  isDefault: true,
};

/** Per-network state is fully independent — switching tabs swaps the whole list + selection, like navigating to a different node-list route. */
function InteractiveTemplate({
  initialMainnetNodes,
  initialTestnetNodes = [testnetDefault],
  initialEditMode = false,
}: {
  initialMainnetNodes: RpcNode[];
  initialTestnetNodes?: RpcNode[];
  initialEditMode?: boolean;
}) {
  const [network, setNetwork] = useState<RpcNetwork>("mainnet");
  const [mainnetNodes, setMainnetNodes] = useState(initialMainnetNodes);
  const [testnetNodes, setTestnetNodes] = useState(initialTestnetNodes);
  const [mainnetSelected, setMainnetSelected] = useState(initialMainnetNodes[0]?.id ?? "");
  const [testnetSelected, setTestnetSelected] = useState(initialTestnetNodes[0]?.id ?? "");
  const [editMode, setEditMode] = useState(initialEditMode);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");

  const nodes = network === "mainnet" ? mainnetNodes : testnetNodes;
  const selectedNodeId = network === "mainnet" ? mainnetSelected : testnetSelected;
  const setNodes = network === "mainnet" ? setMainnetNodes : setTestnetNodes;
  const setSelectedNodeId = network === "mainnet" ? setMainnetSelected : setTestnetSelected;

  return (
    <CustomRpcPage
      network={network}
      onNetworkChange={setNetwork}
      nodes={nodes}
      selectedNodeId={selectedNodeId}
      onSelectNode={setSelectedNodeId}
      editMode={editMode}
      onToggleEdit={() => setEditMode((v) => !v)}
      onRemoveNode={(id) => setNodes((prev) => prev.filter((n) => n.id !== id))}
      isAddOpen={isAddOpen}
      onOpenAdd={() => setIsAddOpen(true)}
      onCloseAdd={() => setIsAddOpen(false)}
      addName={addName}
      addUrl={addUrl}
      onAddNameChange={setAddName}
      onAddUrlChange={setAddUrl}
      onAddSubmit={() => {
        setNodes((prev) => [...prev, { id: addUrl, name: addName, url: addUrl }]);
        setAddName("");
        setAddUrl("");
        setIsAddOpen(false);
      }}
    />
  );
}

export const DefaultOnly: Story = {
  render: () => <InteractiveTemplate initialMainnetNodes={[mainnetDefault]} />,
};

export const WithCustomNodes: Story = {
  render: () => (
    <InteractiveTemplate initialMainnetNodes={[mainnetDefault, mainnetCommunity]} />
  ),
};

export const EditMode: Story = {
  render: () => (
    <InteractiveTemplate
      initialMainnetNodes={[mainnetDefault, mainnetCommunity]}
      initialEditMode
    />
  ),
};
