import { useState } from 'react';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Field, RadioGroup, Radio, Checkbox, Spinner } from '@fluentui/react-components';
import { applyDefaults, type ApplyResult } from '../data/operations';
import { errorText } from '../data/dv';

type ApplyMode = 'Full' | 'LockedOnly' | 'Auto';

/** "Roll out now": jhrb_ApplyDefaults with Scope=All. Queues a job; the job is processed in chunks. */
export function RolloutDialog({ open, onClose, onQueued }: { open: boolean; onClose: () => void; onQueued: (r: ApplyResult, dryRun: boolean) => void }) {
  const [mode, setMode] = useState<ApplyMode>('Auto');
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async () => {
    setBusy(true); setError(undefined);
    try {
      const r = await applyDefaults({ scope: 'All', applyMode: mode, dryRun });
      onQueued(r, dryRun);
      onClose();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async () => {
    setBusy(true); setError(undefined);
    try { await onConfirm(); onClose(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface>
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
