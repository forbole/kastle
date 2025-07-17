import { useCopyToClipboard } from "usehooks-ts";

export default function ScriptDetailsBox({ content }: { content: string }) {
  const [, copy] = useCopyToClipboard();

  const prettierJson = JSON.stringify(JSON.parse(content), null, 2);

  return (
    <div className="rounded-lg bg-[#102832] font-mono text-[#7B9AAA]">
      <div className="relative mx-auto max-w-3xl">
        <div
          className="absolute right-2 top-2 z-10 cursor-pointer rounded p-2 transition duration-200 hover:bg-gray-600 hover:text-white"
          onClick={() => {
            copy(content);
          }}
          title="Copy JSON"
        >
          <i className="hn hn-copy text-sm font-bold"></i>
        </div>

        <div className="rounded-lg py-4 pl-4 shadow-lg">
          <pre className="thin-scrollbar mr-10 h-24 overflow-auto whitespace-pre pb-2 text-xs">
            {prettierJson}
          </pre>
        </div>
      </div>
    </div>
  );
}
