export default function PassphraseInfoModal({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-6">
      <div className="relative w-full max-w-[390px] rounded-2xl bg-icy-blue-950 p-10">
        <button
          className="absolute right-2.5 top-2.5 flex size-[38px] items-center justify-center rounded-lg text-daintree-400 hover:bg-daintree-800"
          onClick={onClose}
          type="button"
        >
          <i className="hn hn-times text-sm" />
        </button>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2.5">
            <h2 className="text-center text-xl font-bold tracking-[0.1px] text-gray-200">
              What is a passphrase?
            </h2>
            <div className="text-sm leading-5 tracking-[0.07px] text-daintree-400">
              <p>{`An optional "25th word" added to your recovery phrase. Each passphrase opens a different wallet.`}</p>
              <p className="mt-4 font-semibold text-gray-200">Use this if:</p>
              <ul className="mt-1 list-disc pl-5">
                <li>
                  You created your wallet with a passphrase on another app
                </li>
                <li>{`You're importing a hidden wallet`}</li>
              </ul>
              <p className="mt-4">
                <span className="font-semibold text-gray-200">{`Skip this if you're unsure`}</span>
                {` — use "Recovery Phrase or Private Key" instead.`}
              </p>
              <p className="mt-4 font-semibold text-gray-200">⚠️ Important:</p>
              <ul className="mt-1 list-disc pl-5">
                <li>
                  Kastle never stores your passphrase — lose it, lose access
                  forever
                </li>
                <li>
                  A wrong passphrase silently opens a different wallet (no error
                  shown)
                </li>
                <li>{`Case-sensitive: "Hello" ≠ "hello"`}</li>
              </ul>
            </div>
          </div>

          <button
            className="w-full rounded-full border border-daintree-400 py-3.5 text-[15px] font-semibold tracking-[0.075px] text-[#c1d5de] hover:bg-daintree-800"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
