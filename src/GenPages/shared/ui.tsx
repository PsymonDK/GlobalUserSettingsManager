import * as React from 'react';
import {
  MessageBar, MessageBarBody, MessageBarTitle, MessageBarActions, Button, Spinner, Dropdown, Option, Input, Switch, Combobox,
  Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Field, RadioGroup, Radio, Checkbox,
} from '@fluentui/react-components';
import { CheckmarkRegular, WarningRegular, ErrorCircleRegular, LockClosedRegular, ArrowSyncRegular, ClockRegular, DismissRegular } from '@fluentui/react-icons';
import { bindApi } from './env';
import { PAGE_CSS } from './styles';
import { JobStatus, MODE_NAMES, Mode, type SettingDefinition } from './settings';
import { errorText, isGuid } from './dv';
import { applyDefaults, type ApplyMode, type ApplyResult } from './operations';
import type { Named } from './directory';

// ---- Page frame ------------------------------------------------------------------------------------------------

/** Overlays (dialogs, dropdown lists) portal into the page container, never into the host's document.body. */
const MountContext = React.createContext<HTMLElement | undefined>(undefined);
export function useMount(): HTMLElement | undefined {
  return React.useContext(MountContext);
}

class PageErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {};
  }
  static getDerivedStateFromError(error: unknown) {
    return { error: errorText(error) };
  }
  render() {
    if (this.state.error) {
      return (
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody><MessageBarTitle>This page failed.</MessageBarTitle>{this.state.error}</MessageBarBody>
        </MessageBar>
      );
    }
    return this.props.children;
  }
}

/** Root of every page: binds the data API, scopes the CSS, gives overlays a mount node and catches render errors. */
export function PageRoot({ dataApi, label, children }: { dataApi: unknown; label: string; children: React.ReactNode }) {
  bindApi(dataApi);
  const [mount, setMount] = React.useState<HTMLElement | undefined>(undefined);
  const setRef = React.useCallback((node: HTMLDivElement | null) => setMount(node ?? undefined), []);
  return (
    <div ref={setRef} className="dus" role="main" aria-label={label}>
      <style>{PAGE_CSS}</style>
      <MountContext.Provider value={mount}>
        <PageErrorBoundary>{dataApi ? children : <Loading />}</PageErrorBoundary>
      </MountContext.Provider>
    </div>
  );
}

/**
 * The host mounts a page twice when it opens (a cached mount, then a fresh one ~300 ms later). Identical loads that
 * start within that window share one request.
 */
export function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__dusInflight = w.__dusInflight ?? {};
  const hit = w.__dusInflight[key];
  if (hit && Date.now() - hit.at < 2000) return hit.promise;
  const promise = load();
  w.__dusInflight[key] = { at: Date.now(), promise };
  promise.catch(() => { delete w.__dusInflight[key]; });
  return promise;
}

export function forget(prefix: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  for (const k of Object.keys(w.__dusInflight ?? {})) if (k.indexOf(prefix) === 0) delete w.__dusInflight[k];
}

// ---- Building blocks -------------------------------------------------------------------------------------------

export function Card({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  return <section aria-label={label} className={`card ${className ?? ''}`}>{children}</section>;
}

export type Notice = { intent: 'success' | 'error' | 'warning' | 'info'; title?: string; text: string; action?: { label: string; onClick: () => void } };

export function NoticeBar({ notice, onDismiss }: { notice?: Notice; onDismiss?: () => void }) {
  if (!notice) return null;
  return (
    <MessageBar intent={notice.intent} layout="multiline">
      <MessageBarBody>
        {notice.title && <MessageBarTitle>{notice.title}</MessageBarTitle>}
        {notice.text}
      </MessageBarBody>
      <MessageBarActions containerAction={onDismiss ? <Button appearance="transparent" aria-label="Dismiss" icon={<DismissRegular />} onClick={onDismiss} /> : undefined}>
        {notice.action && <Button onClick={notice.action.onClick}>{notice.action.label}</Button>}
      </MessageBarActions>
    </MessageBar>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div className="empty"><Spinner size="small" label={label} /></div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Status({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; children: React.ReactNode }) {
  const icon = tone === 'success' ? <CheckmarkRegular className="icon16" /> : tone === 'warning' ? <WarningRegular className="icon16" /> : tone === 'danger' ? <ErrorCircleRegular className="icon16" /> : null;
  return <span className={`status ${tone}`}>{icon}{children}</span>;
}

export function ModeLabel({ mode }: { mode: number | string }) {
  const name = typeof mode === 'number' ? MODE_NAMES[mode] : mode;
  if (name === 'Locked') return <span className="status" style={{ fontWeight: 600 }}><LockClosedRegular className="icon12" />Locked</span>;
  if (name === 'Inherit') return <span className="muted">Inherit</span>;
  return <span>{name}</span>;
}

export function JobStatusLabel({ status, failed }: { status: number; failed?: number }) {
  switch (status) {
    case JobStatus.Running: return <span className="status info"><ArrowSyncRegular className="icon16" />Running</span>;
    case JobStatus.Pending: return <span className="status"><ClockRegular className="icon16" />Pending</span>;
    case JobStatus.Completed: return failed ? <Status tone="danger">Completed, {failed} failed</Status> : <Status tone="success">Completed</Status>;
    case JobStatus.Failed: return <Status tone="danger">Failed</Status>;
    case JobStatus.Cancelled: return <span className="status muted">Cancelled</span>;
    default: return <span className="muted">Unknown</span>;
  }
}

// ---- Setting editors -------------------------------------------------------------------------------------------

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
          {m.value === Mode.Locked && <LockClosedRegular className="icon12" />}
          {m.name}
        </button>
      ))}
    </div>
  );
}

/** Editor for one profile value, by setting kind. */
export function ValueEditor({ def, value, onChange, displayName }: { def: SettingDefinition; value: unknown; onChange: (v: unknown) => void; displayName?: string }) {
  const mount = useMount();
  const label = `Value for ${def.label}`;
  switch (def.kind) {
    case 'Boolean':
      return <Switch aria-label={label} checked={value === true} label={value === true ? 'Yes' : 'No'} onChange={(_, d) => onChange(d.checked)} />;
    case 'Choice': {
      const selected = value === null || value === undefined ? undefined : String(value);
      const text = def.options?.find((o) => String(o.value) === selected)?.label ?? '';
      return (
        <Dropdown aria-label={label} appearance="filled-darker" style={{ minWidth: 0, width: '100%' }} value={text} selectedOptions={selected ? [selected] : []}
          mountNode={mount} placeholder="Select a value" onOptionSelect={(_, d) => onChange(d.optionValue === undefined ? null : Number(d.optionValue))}>
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

/** Search-as-you-type picker for a team, business unit or user. */
export function EntityPicker({ label, search, value, onChange, placeholder }: {
  label: string; search: (text: string) => Promise<Named[]>; value?: Named; onChange: (v: Named | undefined) => void; placeholder?: string;
}) {
  const mount = useMount();
  const [text, setText] = React.useState(value?.name ?? '');
  const [options, setOptions] = React.useState<Named[]>([]);

  React.useEffect(() => { setText(value?.name ?? ''); }, [value?.id, value?.name]);

  React.useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => { search(text).then((r) => { if (!cancelled) setOptions(r); }).catch(() => { if (!cancelled) setOptions([]); }); }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [text, search]);

  return (
    <Combobox aria-label={label} appearance="filled-darker" placeholder={placeholder ?? 'Search'} value={text} style={{ minWidth: 0, width: '100%' }}
      mountNode={mount} selectedOptions={value ? [value.id] : []}
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

// ---- Dialogs ---------------------------------------------------------------------------------------------------

/** "Roll out now": jhrb_ApplyDefaults with Scope=All. Queues a job; the job is processed in chunks. */
export function RolloutDialog({ open, onClose, onQueued }: { open: boolean; onClose: () => void; onQueued: (r: ApplyResult, dryRun: boolean) => void }) {
  const mount = useMount();
  const [mode, setMode] = React.useState<ApplyMode>('Auto');
  const [dryRun, setDryRun] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const run = async () => {
    setBusy(true); setError(undefined);
    try {
      const r = await applyDefaults({ scope: 'All', applyMode: mode, dryRun });
      setBusy(false);
      onQueued(r, dryRun);
      onClose();
    } catch (e) { setBusy(false); setError(errorText(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface mountNode={mount}>
        <DialogBody>
          <DialogTitle>Roll out now</DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span>Applies the effective settings to every user in scope. Only values that differ are written, and each write is logged.</span>
            <Field label="What to apply">
              <RadioGroup value={mode} onChange={(_, d) => setMode(d.value as ApplyMode)}>
                <Radio value="Auto" label="Auto: full for users whose layers changed or who are new, locks only for the rest" />
                <Radio value="Full" label="Full: Default and Locked values for everyone (overwrites users' own Default choices)" />
                <Radio value="LockedOnly" label="Locked only: enforce locks, leave Default settings alone" />
              </RadioGroup>
            </Field>
            <Checkbox checked={dryRun} onChange={(_, d) => setDryRun(d.checked === true)} label="Dry run: count what would change, write nothing" />
            {error && <span className="status danger">{error}</span>}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button appearance="primary" disabled={busy} icon={busy ? <Spinner size="tiny" /> : undefined} onClick={run}>{dryRun ? 'Start dry run' : 'Roll out'}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Generic confirmation dialog. */
export function ConfirmDialog({ open, title, text, confirmLabel, onConfirm, onClose, danger }: {
  open: boolean; title: string; text: string; confirmLabel: string; onConfirm: () => Promise<void> | void; onClose: () => void; danger?: boolean;
}) {
  const mount = useMount();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const run = async () => {
    setBusy(true); setError(undefined);
    try { await onConfirm(); setBusy(false); onClose(); } catch (e) { setBusy(false); setError(errorText(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface mountNode={mount}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span>{text}</span>
            {error && <span className="status danger">{error}</span>}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button appearance="primary" disabled={busy} onClick={run} style={danger ? { background: 'var(--colorPaletteRedBackground3)' } : undefined}>{confirmLabel}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
