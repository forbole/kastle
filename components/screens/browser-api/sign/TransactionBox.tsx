import { useCopyToClipboard } from "usehooks-ts";

export default function TransactionDetailsBox({
  jsonContent,
}: {
  jsonContent: string;
}) {
  const [, copy] = useCopyToClipboard();

  const prettierJson = JSON.stringify(JSON.parse(jsonContent), null, 2);

  return (
    <div className="rounded-lg bg-[#102832] font-mono text-[#7B9AAA]">
      <div className="relative mx-auto max-w-3xl">
        <div
          className="absolute right-2 top-2 z-10 cursor-pointer rounded p-2 transition duration-200 hover:bg-gray-600 hover:text-white"
          onClick={() => {
            copy(jsonContent);
          }}
          title="Copy JSON"
        >
          <i className="hn hn-copy text-sm font-bold"></i>
        </div>

        <div className="rounded-lg p-4 pr-12 shadow-lg">
          <pre className="overflow-auto whitespace-pre text-xs">
            {prettierJson}
          </pre>
        </div>
      </div>
    </div>
  );
}
