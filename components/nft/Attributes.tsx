import { useState } from "react";
import Copy from "@/components/Copy";

type AttributesProps = {
  attributes: Array<{
    trait_type: string;
    value: string;
  }>;
};

const SHOW_ATTRIBUTES_LIMIT = 4;


export default function Attributes({ attributes }: AttributesProps) {
  const [showMoreAttributes, setShowMoreAttributes] = useState(false);

  const shownAttributes = showMoreAttributes
    ? attributes
    : attributes.slice(0, SHOW_ATTRIBUTES_LIMIT);
  return (
    <div className="space-y-3 rounded-xl border border-daintree-700 bg-daintree-800 p-4">
      <h3 className="text-sm">Attributes</h3>

      {attributes.length > 0 ? (
        <>
          <div className="flex justify-between px-2 text-[#7B9AAA]">
            <span>TRAIT TYPE</span>
            <span>VALUE</span>
          </div>
          <ul className="flex flex-col">
            {shownAttributes.map((attr, index) => (
              <li
                key={index}
                className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:rounded-t-xl last:rounded-b-xl"
              >
                <div className="flex w-full items-start justify-between">
                  <span>{attr.trait_type}</span>
                  <Copy textToCopy={attr.value} id={`copy-attribute-${index}`}>
                    <span className="cursor-pointer font-medium">
                      {attr.value}
                    </span>
                  </Copy>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="py-10 text-center text-base text-daintree-400">
          No traits available
        </div>
      )}

      {!showMoreAttributes && attributes.length > SHOW_ATTRIBUTES_LIMIT && (
        <div
          className="mx-auto cursor-pointer text-center text-base font-semibold leading-none text-cyan-500"
          onClick={() => setShowMoreAttributes(true)}
        >
          <i className="hn hn-chevron-down ml-1"></i> Show more
        </div>
      )}
    </div>
  );
}
