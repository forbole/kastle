import PageHeader from "@/ui/general/PageHeader";
import SegmentedControl from "@/ui/general/SegmentedControl";
import ActionSheet from "@/ui/general/ActionSheet";
import Button from "@/ui/general/Button";
import NodeListItem from "./NodeListItem";
import AddCustomNodeForm from "./AddCustomNodeForm";

export interface RpcNode {
  id: string;
  name: string;
  url: string;
  isDefault?: boolean;
}

export type RpcNetwork = "mainnet" | "testnet";

export interface CustomRpcPageProps {
  network: RpcNetwork;
  onNetworkChange: (network: RpcNetwork) => void;
  /** Node list for the currently active network — swap this when network changes. */
  nodes: RpcNode[];
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  /** Edit mode — rows show a remove control (default node excluded); the bottom button becomes "Done". */
  editMode?: boolean;
  onToggleEdit?: () => void;
  onRemoveNode?: (id: string) => void;
  onBack?: () => void;

  isAddOpen: boolean;
  onOpenAdd: () => void;
  onCloseAdd: () => void;
  addName: string;
  addUrl: string;
  onAddNameChange: (value: string) => void;
  onAddUrlChange: (value: string) => void;
  addUrlError?: string;
  isAddSubmitting?: boolean;
  onAddSubmit: () => void;
}

export default function CustomRpcPage({
  network,
  onNetworkChange,
  nodes,
  selectedNodeId,
  onSelectNode,
  editMode = false,
  onToggleEdit,
  onRemoveNode,
  onBack,
  isAddOpen,
  onOpenAdd,
  onCloseAdd,
  addName,
  addUrl,
  onAddNameChange,
  onAddUrlChange,
  addUrlError,
  isAddSubmitting,
  onAddSubmit,
}: CustomRpcPageProps) {
  return (
    <div className="relative flex h-full flex-col bg-icy-blue-950 font-sans text-white">
      <PageHeader
        title="Custom RPC"
        subtitle="The node Kastle uses to reach Kaspa."
        paddingBottom="pb-4"
        onBack={onBack}
        rightIcon={editMode ? undefined : "hn hn-pencil"}
        onRightAction={onToggleEdit}
      />
      <div className="flex flex-1 flex-col gap-5 px-4">
        <SegmentedControl
          options={[
            { label: "Mainnet", value: "mainnet" as const },
            { label: "Testnet", value: "testnet" as const },
          ]}
          value={network}
          onChange={onNetworkChange}
        />
        <div className="flex flex-col">
          {nodes.map((node) => (
            <NodeListItem
              key={node.id}
              name={node.name}
              url={node.url}
              isDefault={node.isDefault}
              selected={node.id === selectedNodeId}
              editMode={editMode}
              onSelect={() => onSelectNode(node.id)}
              onRemove={() => onRemoveNode?.(node.id)}
            />
          ))}
        </div>
      </div>
      <div className="px-4 pb-6 pt-3">
        {editMode ? (
          <Button variant="primary" size="md" onClick={onToggleEdit}>
            Done
          </Button>
        ) : (
          <Button variant="secondary" size="md" onClick={onOpenAdd}>
            Add custom node
          </Button>
        )}
      </div>

      <ActionSheet isOpen={isAddOpen} onClose={onCloseAdd}>
        <AddCustomNodeForm
          name={addName}
          url={addUrl}
          onNameChange={onAddNameChange}
          onUrlChange={onAddUrlChange}
          urlError={addUrlError}
          submitting={isAddSubmitting}
          onSubmit={onAddSubmit}
        />
      </ActionSheet>
    </div>
  );
}
