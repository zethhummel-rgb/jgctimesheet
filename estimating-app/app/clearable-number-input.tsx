"use client";

import { useState, type InputHTMLAttributes } from "react";

type ClearableNumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "onChange" | "type" | "value"> & {
  value: number | null;
  emptyValue?: number | null;
  normalizeValue?: (value: number) => number;
  formatEditedValue?: (value: number) => string;
  onValueChange: (value: number | null) => void;
};

export function ClearableNumberInput({
  value,
  emptyValue = 0,
  normalizeValue,
  formatEditedValue,
  onValueChange,
  onFocus,
  onBlur,
  ...inputProps
}: ClearableNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayedValue = draft ?? (value === null || !Number.isFinite(value) ? "" : String(value));

  const normalized = (nextValue: number) => normalizeValue ? normalizeValue(nextValue) : nextValue;

  return (
    <input
      {...inputProps}
      type="number"
      value={displayedValue}
      onFocus={(event) => {
        setDraft(event.currentTarget.value);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const rawValue = event.currentTarget.value;
        if (rawValue === "") {
          setDraft("");
          onValueChange(emptyValue);
          return;
        }

        const nextValue = event.currentTarget.valueAsNumber;
        if (!Number.isFinite(nextValue)) {
          setDraft(rawValue);
          return;
        }

        const nextNormalizedValue = normalized(nextValue);
        setDraft(formatEditedValue ? formatEditedValue(nextNormalizedValue) : rawValue);
        onValueChange(nextNormalizedValue);
      }}
      onBlur={(event) => {
        setDraft(null);
        onBlur?.(event);
      }}
    />
  );
}
