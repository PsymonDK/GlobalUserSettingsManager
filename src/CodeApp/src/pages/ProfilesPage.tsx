import { useCallback, useEffect, useState } from 'react';
import { Toolbar, ToolbarButton, ToolbarDivider, Link, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Field, Input, Spinner } from '@fluentui/react-components';
import { Add20Regular, Play20Regular, ArrowSync20Regular, ArrowClockwise20Regular } from '@fluentui/react-icons';
import { loadProfiles, loadScopes, describeScopes, createGroupProfile, updateProfile, type ProfileSummary, type Scope } from '../data/profiles';
import { loadJobs, loadLog, reconcile, type Job } from '../data/operations';
import { countLicensedUsers, countTeamMembers } from '../data/directory';
import { errorText, formatDate } from '../data/dv';
import { ProfileType, PROFILE_TYPE_NAMES, SETTINGS, byAttribute } from '../settings';
import { Card, Loading, NoticeBar, JobStatusLabel, Empty, type Notice } from '../components/common';
import { RolloutDialog, ConfirmDialog } from '../components/RolloutDialog';
import { navigate } from '../router';

interface Overview {
  profiles: ProfileSummary[];
  scopes: (Scope & { profileId: string })[];
  licensed: number;
  pilotMembers?: number;
  reverts: { setting: string; count: number }[];
  jobs: Job[];
}

export function ProfilesPage() {
  const [data, setData] = useState<Overview>();
  const [notice, setNotice] = useState<Notice>();
  const [rolloutOpen, setRolloutOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [goLiveOpen, setGoLiveOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [profiles, scopes, licensed, jobs, reverts] = await Promise.all([
        loadProfiles(), loadScopes(), countLicensedUsers(), loadJobs(5),
        loadLog({ source: 632490002, since: new Date(Date.now() - 7 * 86400000), top: 500 }),
      ]);
      const global = profiles.find((p) => p.type === ProfileType.Global);
      const pilotMembers = global?.pilotTeamId ? await countTeamMembers(global.pilotTeamId) : undefined;
      const counts = new Map<string, number>();
      for (const r of reverts) if (r.setting) counts.set(r.setting, (counts.get(r.setting) ?? 0) + 1);
      setData({
        profiles, scopes, licensed, pilotMembers, jobs,
        reverts: [...counts].map(([setting, count]) => ({ setting, count })).sort((a, b) => b.count - a.count).slice(0, 3),
      });
    } catch (e) { setNotice({ intent: 'error', title: 'Could not load profiles.', text: errorText(e) }); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const global = data?.profiles.find((p) => p.type === ProfileType.Global);
  const groups = data?.profiles.filter((p) => p.type === ProfileType.Group) ?? [];
  const users = data?.profiles.filter((p) => p.type === ProfileType.User) ?? [];
  // Summed per active profile: the same setting on Global and a group counts twice.
  const totalDefaults = [global, ...groups].reduce((n, p) => n + (p && p.active ? p.defaults : 0), 0);
  const totalLocked = [global, ...groups].reduce((n, p) => n + (p && p.active ? p.locked : 0), 0);

  const runReconcile = async () => {
    try { await reconcile(); setNotice({ intent: 'success', text: 'Reconcile queued. It applies changed layers to everyone and resumes stalled jobs.', action: { label: 'Open rollouts', onClick: () => navigate({ page: 'rollouts' }) } }); }
    catch (e) { setNotice({ intent: 'error', title: 'Reconcile failed.', text: errorText(e) }); }
  };

  return (
    <>
      <Card className="commandbar" label="Profile commands">
        <Toolbar aria-label="Profile commands" style={{ flexWrap: 'wrap', padding: 0 }}>
          <ToolbarButton icon={<Add20Regular />} onClick={() => setNewOpen(true)}>New group profile</ToolbarButton>
          <ToolbarButton icon={<Play20Regular />} onClick={() => setRolloutOpen(true)}>Roll out now</ToolbarButton>
          <ToolbarButton icon={<ArrowSync20Regular />} onClick={runReconcile}>Reconcile</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<ArrowClockwise20Regular />} onClick={() => { setData(undefined); load(); }}>Refresh</ToolbarButton>
        </Toolbar>
      </Card>

      <NoticeBar notice={notice} onDismiss={() => setNotice(undefined)} />

      {data && !global && <NoticeBar notice={{ intent: 'warning', title: 'No Global profile.', text: 'Nothing is managed until a Global profile exists. Create it with scripts/Seed-GlobalProfile.ps1.' }} />}
      {global && !global.active && <NoticeBar notice={{ intent: 'warning', title: 'Feature is off.', text: 'The Global profile is inactive, so no setting is applied or enforced for anyone.', action: { label: 'Open Global', onClick: () => navigate({ page: 'profile', id: global.id }) } }} />}
      {global?.active && global.pilotTeamId && (
        <NoticeBar notice={{
          intent: 'info', title: 'Pilot mode.',
          text: `Only members of the team ${global.pilotTeamName ?? ''} (${data?.pilotMembers ?? '?'} user${data?.pilotMembers === 1 ? '' : 's'}) get default or locked settings. Everyone else is untouched.`,
          action: { label: 'Go live for everyone…', onClick: () => setGoLiveOpen(true) },
        }} />
      )}

      <div className="row-flex" style={{ alignItems: 'baseline' }}>
        <h1 className="page-title">Profiles</h1>
        <span className="muted">Highest precedence first. For each setting a user gets the first profile that does not say Inherit.</span>
      </div>

      {!data ? <Loading /> : (
        <>
          <div className="kpis">
            <Card className="card-pad" label="Managed settings">
              <div className="small muted">Default / locked values</div>
              <div className="kpi-value">{totalDefaults + totalLocked} <small>across {1 + groups.length} profiles</small></div>
              <div className="small muted">{totalDefaults} default · {totalLocked} locked · {SETTINGS.length} settings available</div>
            </Card>
            <Card className="card-pad" label="Users in scope">
              <div className="small muted">Users in scope</div>
              <div className="kpi-value">{global?.pilotTeamId ? data.pilotMembers ?? 0 : data.licensed} <small>of {data.licensed} licensed</small></div>
              <div className="small muted">{global?.pilotTeamId ? 'Limited by the pilot team' : 'All licensed, interactive users'}</div>
            </Card>
            <Card className="card-pad" label="Reverted this week">
              <div className="small muted">Reverted this week</div>
              <div className="kpi-value">{data.reverts.reduce((n, r) => n + r.count, 0)}</div>
              <div className="small muted">{data.reverts[0] ? `Most often: ${byAttribute.get(data.reverts[0].setting)?.label ?? data.reverts[0].setting}` : 'No locked setting was changed'}</div>
            </Card>
            <Card className="card-pad" label="User overrides">
              <div className="small muted">User overrides</div>
              <div className="kpi-value">{users.length}</div>
              <div className="small muted"><Link href="#/users">Find a user</Link></div>
            </Card>
          </div>

          <Card label="Profiles">
            <div className="scroll-x">
              <table className="grid-table" style={{ minWidth: 900 }}>
                <thead><tr>
                  <th scope="col">Order</th><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Applies to</th>
                  <th scope="col" className="num">Default</th><th scope="col" className="num">Locked</th><th scope="col">Status</th><th scope="col">Modified</th>
                </tr></thead>
                <tbody>
                  {users.length > 0 && (
                    <tr>
                      <td className="muted">1</td>
                      <td className="primary"><Link href="#/users">User overrides</Link></td>
                      <td><span className="badge">User</span></td>
                      <td>{users.length} user{users.length === 1 ? '' : 's'} with their own values</td>
                      <td className="num">{users.reduce((n, u) => n + u.defaults, 0)}</td>
                      <td className="num">{users.reduce((n, u) => n + u.locked, 0)}</td>
                      <td>Active</td>
                      <td>{formatDate(users.map((u) => u.modifiedOn ?? '').sort().pop())}</td>
                    </tr>
                  )}
                  {[...groups, ...(global ? [global] : [])].map((p, i) => (
                    <tr key={p.id} style={p.active ? undefined : { color: 'var(--colorNeutralForeground3)' }}>
                      <td className="muted">{i + (users.length ? 2 : 1)}</td>
                      <td className="primary"><Link href={`#/profiles/${p.id}`}>{p.name}</Link></td>
                      <td><span className="badge">{PROFILE_TYPE_NAMES[p.type]}{p.type === ProfileType.Group ? ` · ${p.priority ?? ''}` : ''}</span></td>
                      <td>{p.type === ProfileType.Global
                        ? `Everyone in scope${p.pilotTeamName ? ` (pilot: ${p.pilotTeamName})` : ''}`
                        : describeScopes(data.scopes.filter((s) => s.profileId === p.id))}</td>
                      <td className="num">{p.defaults}</td>
                      <td className="num">{p.locked}</td>
                      <td>{p.active ? 'Active' : 'Inactive'}</td>
                      <td>{formatDate(p.modifiedOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid-footer"><span>Rows: {groups.length + (global ? 1 : 0) + (users.length ? 1 : 0)}</span></div>
          </Card>

          <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
            <Card label="Recent rollouts">
              <div className="card-head"><h2 className="card-title">Recent rollouts</h2><span className="grow" /><Link href="#/rollouts" className="small">See all</Link></div>
              {data.jobs.length === 0 ? <Empty>No rollouts yet</Empty> : (
                <table className="grid-table"><tbody>
                  {data.jobs.map((j) => (
                    <tr key={j.id}><td className="primary">{j.name}</td><td><JobStatusLabel status={j.status} failed={j.failed} /></td><td className="num muted">{j.dryRun ? `(${j.updated}) dry run` : `${j.updated} updated`}</td></tr>
                  ))}
                </tbody></table>
              )}
            </Card>
            <Card label="Most reverted locked settings">
              <div className="card-head"><h2 className="card-title">Most reverted locked settings</h2><span className="grow" /><Link href="#/log" className="small">Activity log</Link></div>
              {data.reverts.length === 0 ? <Empty>Nothing was reverted in the last 7 days</Empty> : (
                <table className="grid-table"><tbody>
                  {data.reverts.map((r) => (
                    <tr key={r.setting}><td className="primary">{byAttribute.get(r.setting)?.label ?? r.setting}</td><td className="num">{r.count} revert{r.count === 1 ? '' : 's'}</td></tr>
                  ))}
                </tbody></table>
              )}
            </Card>
          </div>
        </>
      )}

      <RolloutDialog open={rolloutOpen} onClose={() => setRolloutOpen(false)}
        onQueued={(_, dry) => setNotice({ intent: 'success', text: dry ? 'Dry run queued. The job counts what would change and writes nothing.' : 'Rollout queued.', action: { label: 'Open rollouts', onClick: () => navigate({ page: 'rollouts' }) } })} />
      <NewProfileDialog open={newOpen} onClose={() => setNewOpen(false)} taken={groups.map((g) => g.priority ?? 0)} />
      {global && (
        <ConfirmDialog open={goLiveOpen} onClose={() => setGoLiveOpen(false)} title="Go live for everyone?" confirmLabel="Go live"
          text={`This removes the pilot team from the Global profile. All ${data?.licensed ?? ''} licensed users come into scope: a rollout starts, locks are enforced for everyone, and defaults are applied to users whose layers changed.`}
          onConfirm={async () => { await updateProfile(global.id, { 'jhrb_PilotTeam@odata.bind': null } as never); await load(); }} />
      )}
    </>
  );
}

function NewProfileDialog({ open, onClose, taken }: { open: boolean; onClose: () => void; taken: number[] }) {
  const next = (Math.max(0, ...taken) + 10);
  const [name, setName] = useState('');
  const [priority, setPriority] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const prio = priority === '' ? next : Number(priority);
  const clash = taken.includes(prio);

  const create = async () => {
    setBusy(true); setError(undefined);
    try { const id = await createGroupProfile(name.trim(), prio); onClose(); navigate({ page: 'profile', id }); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>New group profile</DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span className="muted">A group profile applies to members of the teams and business units you add under Applies to. It starts with every setting on Inherit, so creating it changes nothing.</span>
            <Field label="Name" required><Input appearance="filled-darker" value={name} onChange={(_, d) => setName(d.value)} /></Field>
            <Field label="Priority" hint="Higher wins when a user is in several groups. Must be unique." validationState={clash ? 'error' : 'none'} validationMessage={clash ? 'Another group already uses this priority.' : undefined}>
              <Input appearance="filled-darker" type="number" value={priority} placeholder={String(next)} onChange={(_, d) => setPriority(d.value)} />
            </Field>
            <span className="small muted">User overrides are created from the Users page.</span>
            {error && <span className="status danger">{error}</span>}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button appearance="primary" disabled={busy || !name.trim() || clash} icon={busy ? <Spinner size="tiny" /> : undefined} onClick={create}>Create</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
