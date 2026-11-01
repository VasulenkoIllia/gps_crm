export interface DictOption {
  value: string;
  label: string;
  isActive: boolean;
}

// A deactivated value leaves the choice but stays where it was already chosen (references.md П4)
export function chooseableOptions(options: DictOption[], value: string | string[] | undefined) {
  const chosen = [value ?? []].flat();
  return options
    .filter((option) => option.isActive || chosen.includes(option.value))
    .map(({ value: optionValue, label }) => ({ value: optionValue, label }));
}
