import { twMerge } from "tailwind-merge";

export interface SegmentedOption<T extends string> {
  label: string;
  value: T;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div className="flex justify-center">
      <div className="flex gap-1 rounded-full border border-daintree-700 p-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={twMerge(
              "h-9 rounded-full px-3.5 text-sm font-medium text-gray-200",
              value === opt.value && "bg-white/10",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
