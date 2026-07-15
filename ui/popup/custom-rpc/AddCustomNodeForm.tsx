import { twMerge } from "tailwind-merge";
import Button from "@/ui/general/Button";

export interface AddCustomNodeFormProps {
  name: string;
  url: string;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  /** Error message shown under the RPC URL field, e.g. "Enter a valid WebSocket address (ws:// or wss://)". */
  urlError?: string;
  submitting?: boolean;
  onSubmit: () => void;
}

export default function AddCustomNodeForm({
  name,
  url,
  onNameChange,
  onUrlChange,
  urlError,
  submitting = false,
  onSubmit,
}: AddCustomNodeFormProps) {
  const canSubmit =
    name.trim().length > 0 && url.trim().length > 0 && !submitting;

  return (
    <div className="flex flex-col pt-3">
      <h2 className="text-lg font-semibold text-gray-200">Add custom node</h2>
      <p className="mt-1 text-sm text-daintree-400">
        Connect Kastle to your own Kaspa node.
      </p>
      <div className="mt-3 h-px bg-daintree-700" />

      <div className="mt-4 flex flex-col gap-1.5">
        <label
          htmlFor="node-name"
          className="text-sm font-semibold text-gray-200"
        >
          Node Name
        </label>
        <input
          id="node-name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={submitting}
          placeholder="Home node"
          className="h-[46px] rounded-lg border border-daintree-700 bg-icy-blue-950 px-4 text-sm font-medium text-white placeholder:text-daintree-400 focus:outline-none"
        />
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <label
          htmlFor="rpc-url"
          className="text-sm font-semibold text-gray-200"
        >
          RPC URL
        </label>
        <input
          id="rpc-url"
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          disabled={submitting}
          placeholder="ws:// or wss://"
          className={twMerge(
            "h-[46px] rounded-lg border bg-icy-blue-950 px-4 text-sm font-medium text-white placeholder:text-daintree-400 focus:outline-none",
            urlError ? "border-red-500" : "border-daintree-700",
          )}
        />
        <p className="h-5 text-sm font-medium text-red-500">{urlError}</p>
      </div>

      <div className="mt-5">
        <Button
          variant="primary"
          size="lg"
          disabled={!canSubmit}
          loading={submitting}
          onClick={onSubmit}
        >
          Add
        </Button>
      </div>
      <p className="mt-4 text-center text-xs text-daintree-400">
        Only add a node you trust.
      </p>
    </div>
  );
}
