import { twMerge } from "tailwind-merge";
import React from "react";

const CURRENCIES = [
  ["usd", "United States Dollar", "US$"],
  ["eur", "Euro", "€"],
  ["cny", "Chinese Yuan", "¥"],
  ["jpy", "Japanese Yen", "¥"],
  ["hkd", "Hong Kong Dollar", "HK$"],
  ["twd", "New Taiwan Dollar", "NT$"],
  ["rub", "Russian Ruble", "₽"],
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number][0];

type CurrencySelectionProps = { isShown: boolean; toggleShow: () => void };

export default function CurrencySelection({
  isShown,
  toggleShow,
}: CurrencySelectionProps) {
  const [settings, setSettings] = useSettings();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCurrencies = CURRENCIES.filter(([_, name]) =>
    name.toLowerCase().startsWith(searchQuery.toLowerCase()),
  );

  const selectCurrency = async ([code]: (typeof CURRENCIES)[number]) => {
    await setSettings((prev) => ({ ...prev, currency: code }));
  };

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          isShown ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={toggleShow}
      />

      {/* Pop over */}
      <div
        className={twMerge(
          "no-scrollbar absolute bottom-0 left-0 z-50 h-[65vh] w-full transform rounded-t-2xl border border-daintree-700 bg-daintree-800 transition-transform duration-300 ease-out",
          isShown ? "translate-y-0" : "translate-y-[65vh]",
        )}
      >
        <div className="relative m-4 max-w-sm space-y-3">
          <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-4 text-daintree-400 peer-disabled:pointer-events-none peer-disabled:opacity-50">
            <i className="hn hn-search"></i>
          </div>

          <input
            type="text"
            className="block w-full rounded-lg border-daintree-700 bg-[#051D26] py-3 pe-4 ps-10 text-sm text-white placeholder-daintree-400 focus:border-daintree-700 focus:ring-daintree-700 disabled:pointer-events-none disabled:opacity-50"
            placeholder="Search currency"
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="no-scrollbar mx-2 flex flex-col overflow-y-scroll">
          {filteredCurrencies.map((currency) => (
            <button
              key={currency[0]}
              type="button"
              className={twMerge(
                "flex items-center justify-between rounded-lg px-4 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-700",
                settings?.currency === currency[0] && "bg-daintree-700",
              )}
              onClick={() => selectCurrency(currency)}
            >
              <span>{`${currency[1]} - ${currency[2]}`}</span>
            </button>
          ))}

          {filteredCurrencies.length === 0 && (
            <span className="text-center text-base font-medium text-daintree-400">
              No result found
            </span>
          )}
        </div>
      </div>
    </>
  );
}
