import Copy from "@/components/Copy";

export default function ScriptDetailsBox({ content }: { content: string }) {
  const isParsable = content.startsWith("{") && content.endsWith("}");
  const formatted = isParsable
    ? JSON.stringify(JSON.parse(content), null, 2)
    : content;

  return (
    <div className="rounded-lg bg-[#102832] font-mono text-[#7B9AAA]">
      <div className="relative mx-auto max-w-3xl">
        <div className="absolute right-2 top-2 z-10">
          <Copy textToCopy={content} id="copy-script-details">
            <div className="cursor-pointer rounded p-2 transition duration-200 hover:bg-gray-600 hover:text-white">
              <i className="hn hn-copy text-sm font-bold" />
            </div>
          </Copy>
        </div>

        <div className="rounded-lg py-4 pl-4 shadow-lg">
          <pre className="thin-scrollbar mr-10 overflow-auto whitespace-pre pb-2 text-xs">
            {formatted}
          </pre>
        </div>
      </div>
    </div>
  );
}
