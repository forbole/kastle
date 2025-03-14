import { ScriptOption } from "@/lib/wallet/wallet-interface";

export default function ScriptItem({ script }: { script: ScriptOption }) {
  return (
    <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
      {/* Input Index */}
      <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
        <div className="flex w-full items-start justify-between">
          <span className="font-medium">Input Index</span>
          <div className="flex flex-col text-right">
            <span className="font-medium">{script.inputIndex}</span>
          </div>
        </div>
      </li>

      {/* Sign Type */}
      <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
        <div className="flex w-full items-start justify-between">
          <span className="font-medium">Sign Type</span>
          <div className="flex flex-col text-right">
            <span className="font-medium">{script.signType ?? "All"}</span>
          </div>
        </div>
      </li>

      {/* Script */}
      <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
        <div className="flex w-full flex-col items-start gap-2">
          <span className="font-medium">Content</span>
          <div className="flex flex-col text-right text-xs text-[#7B9AAA]">
            <span className="break-all text-left font-medium">
              {script.scriptHex}
            </span>
          </div>
        </div>
      </li>
    </ul>
  );
}
