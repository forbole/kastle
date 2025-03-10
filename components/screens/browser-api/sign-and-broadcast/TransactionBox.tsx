import { useCopyToClipboard } from "usehooks-ts";

export default function TransactionDetailsBox({
  jsonContent,
}: {
  jsonContent: string;
}) {
  const [, copy] = useCopyToClipboard();

  return (
    <div className="min-h-screen bg-gray-900 p-6 font-mono text-gray-100">
      <div className="mx-auto max-w-3xl">
        <div className="relative overflow-auto rounded-lg bg-gray-800 p-6 shadow-lg">
          <div
            className="absolute right-2 top-2 z-10 cursor-pointer rounded bg-gray-700 p-2 text-gray-300 transition duration-200 hover:bg-gray-600 hover:text-white"
            onClick={() => {
              copy(jsonContent);
            }}
            title="Copy JSON"
          >
            <span className="text-sm font-bold">hn</span>
          </div>

          <pre className="whitespace-pre text-sm">
            <span className="text-gray-300">
              {jsonContent.split("").map((char, index) => {
                // Simple syntax highlighting
                if (char === "{" || char === "}") {
                  return (
                    <span key={index} className="text-yellow-300">
                      {char}
                    </span>
                  );
                } else if (char === "[" || char === "]") {
                  return (
                    <span key={index} className="text-green-300">
                      {char}
                    </span>
                  );
                } else if (char === ":") {
                  return (
                    <span key={index} className="text-pink-400">
                      {char}
                    </span>
                  );
                } else if (char === ",") {
                  return (
                    <span key={index} className="text-gray-400">
                      {char}
                    </span>
                  );
                } else if (char === '"') {
                  return (
                    <span key={index} className="text-cyan-300">
                      {char}
                    </span>
                  );
                } else {
                  return <span key={index}>{char}</span>;
                }
              })}
            </span>
          </pre>
        </div>
      </div>
    </div>
  );
}
