import { useEffect, useState } from 'react';
import { Combobox, Option } from '@fluentui/react-components';
import type { Named } from '../data/directory';

/** Search-as-you-type picker for a team, business unit or user. */
export function EntityPicker({ label, search, value, onChange, placeholder }: {
  label: string; search: (text: string) => Promise<Named[]>; value?: Named; onChange: (v: Named | undefined) => void; placeholder?: string;
}) {
  const [text, setText] = useState(value?.name ?? '');
  const [options, setOptions] = useState<Named[]>([]);

  useEffect(() => { setText(value?.name ?? ''); }, [value?.id, value?.name]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => { search(text).then((r) => { if (!cancelled) setOptions(r); }).catch(() => { if (!cancelled) setOptions([]); }); }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [text, search]);

  return (
    <Combobox aria-label={label} appearance="filled-darker" placeholder={placeholder ?? 'Search'} value={text} style={{ minWidth: 0, width: '100%' }}
      selectedOptions={value ? [value.id] : []}
      onInput={(e) => { setText((e.target as HTMLInputElement).value); if (value) onChange(undefined); }}
      onOptionSelect={(_, d) => {
        const picked = options.find((o) => o.id === d.optionValue);
        onChange(picked);
        setText(picked?.name ?? '');
      }}>
      {options.length === 0 ? <Option disabled value="" text="No matches">No matches</Option> : options.map((o) => <Option key={o.id} value={o.id} text={o.name}>{o.name}</Option>)}
    </Combobox>
  );
}
