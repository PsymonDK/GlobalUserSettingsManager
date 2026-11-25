import { Dropdown, Option, Input, Switch } from '@fluentui/react-components';
import { LockClosed12Regular } from '@fluentui/react-icons';
import { Mode, type SettingDefinition } from '../settings';
import { isGuid } from '../data/dv';

const MODES = [
  { value: Mode.Inherit, name: 'Inherit' },
  { value: Mode.Default, name: 'Default' },
  { value: Mode.Locked, name: 'Locked' },
];

/** Inherit / Default / Locked as one segmented control. aria-pressed carries the state, not colour alone. */
export function ModeSwitch({ label, mode, onChange, disabled }: { label: string; mode: number; onChange: (m: number) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label={`Mode for ${label}`} className="mode-switch">
      {MODES.map((m) => (
        <button key={m.value} type="button" aria-pressed={mode === m.value} disabled={disabled} onClick={() => onChange(m.value)}>
          {m.value === Mode.Locked && <LockClosed12Regular />}
          {m.name}
        </button>
      ))}
    </div>
  );
}

/** Editor for one profile value, by setting kind. */
export function ValueEditor({ def, value, onChange, displayName }: { def: SettingDefinition; value: unknown; onChange: (v: unknown) => void; displayName?: string }) {
  const label = `Value for ${def.label}`;
  switch (def.kind) {
    case 'Boolean':
      return <Switch aria-label={label} checked={value === true} label={value === true ? 'Yes' : 'No'} onChange={(_, d) => onChange(d.checked)} />;
    case 'Choice': {
      const selected = value === null || value === undefined ? undefined : String(value);
      const text = def.options?.find((o) => String(o.value) === selected)?.label ?? '';
      return (
        <Dropdown aria-label={label} appearance="filled-darker" style={{ minWidth: 0, width: '100%' }} value={text} selectedOptions={selected ? [selected] : []}
          placeholder="Select a value" onOptionSelect={(_, d) => onChange(d.optionValue === undefined ? null : Number(d.optionValue))}>
          {(def.options ?? []).map((o) => <Option key={o.value} value={String(o.value)}>{o.label}</Option>)}
        </Dropdown>
      );
    }
    case 'Integer':
      return (
        <Input aria-label={label} appearance="filled-darker" type="number" style={{ width: '100%' }} value={value === null || value === undefined ? '' : String(value)}
          min={def.min ?? undefined} max={def.max ?? undefined}
          onChange={(_, d) => onChange(d.value === '' ? null : Number(d.value))} />
      );
    case 'Lookup':
    case 'LookupText':
    case 'GuidText': {
      const text = value === null || value === undefined ? '' : String(value);
      const invalid = text !== '' && !isGuid(text);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
          <Input aria-label={label} aria-invalid={invalid} appearance="filled-darker" style={{ width: '100%' }} value={text} placeholder="Record id (GUID)"
            onChange={(_, d) => onChange(d.value.trim() === '' ? null : d.value.trim())} />
          {invalid ? <span className="small status danger">Enter a GUID</span> : displayName ? <span className="small muted">{displayName}</span> : null}
        </div>
      );
    }
    default:
      return <Input aria-label={label} appearance="filled-darker" style={{ width: '100%' }} value={value === null || value === undefined ? '' : String(value)} maxLength={def.maxLength}
        onChange={(_, d) => onChange(d.value)} />;
  }
}
