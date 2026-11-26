// Page "Profiles": overview of all profiles (Global, groups, user overrides) and the profile editor.
// pageInput.data.profileId opens a profile directly.
import * as React from 'react';
import {
  Toolbar, ToolbarButton, ToolbarDivider, TabList, Tab, Button, Switch, SearchBox, Field, Input, Dropdown, Option, Link, Spinner, Avatar,
  Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from '@fluentui/react-components';
import {
  AddRegular, PlayRegular, ArrowSyncRegular, ArrowClockwiseRegular, ArrowLeftRegular, SaveRegular, ArrowDownloadRegular, DeleteRegular, PowerRegular,
  WarningRegular, CheckmarkRegular, DismissRegular,
} from '@fluentui/react-icons';
import { inputText, openPage, type PageProps } from '../shared/env';
import {
  loadProfiles, loadProfile, findGlobal, loadScopes, addScope, removeScope, describeScopes, createGroupProfile, updateProfile, deleteProfile,
  readValue, readMode, valuePatch, pilotTeamPatch, type ProfileSummary, type ProfileDetail, type Scope,
} from '../shared/profiles';
import { applyDefaults, loadCurrentValues, loadJobs, loadLog, reconcile, type Job, type LogEntry } from '../shared/operations';
import { countLicensedUsers, countTeamMembers, searchTeams, searchBusinessUnits, type Named } from '../shared/directory';
import { display, errorText, formatDate, isGuid, plural } from '../shared/dv';
import {
  SETTINGS, GROUPS, Mode, MODE_NAMES, ProfileType, PROFILE_TYPE_NAMES, LOG_SOURCE_NAMES, LogSource, formatValue, settingLabel, type SettingDefinition,
} from '../shared/settings';
import {
  PageRoot, Card, Loading, NoticeBar, JobStatusLabel, Empty, ModeSwitch, ValueEditor, EntityPicker, RolloutDialog, ConfirmDialog, useMount, shared, forget, type Notice,
} from '../shared/ui';

// ---- Overview --------------------------------------------------------------------------------------------------

interface Overview {
  profiles: ProfileSummary[];
  scopes: Scope[];
  licensed: number;
  pilotMembers?: number;
  reverts: { setting: string; count: number }[];
  jobs: Job[];
}

async function loadOverview(): Promise<Overview> {
  const [profiles, scopes, licensed, jobs, reverts] = await Promise.all([
    loadProfiles(), loadScopes(), countLicensedUsers(), loadJobs(5),
    loadLog({ source: LogSource.Reverted, since: new Date(Date.now() - 7 * 86400000), top: 500 }),
  ]);
  const global = profiles.find((p) => p.type === ProfileType.Global);
  const pilotMembers = global?.pilotTeamId ? await countTeamMembers(global.pilotTeamId) : undefined;
  const counts: Record<string, number> = {};
  for (const r of reverts) if (r.setting) counts[r.setting] = (counts[r.setting] ?? 0) + 1;
  return {
    profiles, scopes, licensed, pilotMembers, jobs,
    reverts: Object.keys(counts).map((setting) => ({ setting, count: counts[setting] })).sort((a, b) => b.count - a.count).slice(0, 3),
  };
}

function ProfilesOverview({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = React.useState<Overview>();
  const [notice, setNotice] = React.useState<Notice>();
  const [rolloutOpen, setRolloutOpen] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [goLiveOpen, setGoLiveOpen] = React.useState(false);

  const load = React.useCallback(async (fresh?: boolean) => {
    if (fresh) forget('overview');
    try { setData(await shared('overview', loadOverview)); }
    catch (e) { setNotice({ intent: 'error', title: 'Could not load profiles.', text: errorText(e) }); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const global = data?.profiles.find((p) => p.type === ProfileType.Global);
  const groups = data?.profiles.filter((p) => p.type === ProfileType.Group) ?? [];
  const users = data?.profiles.filter((p) => p.type === ProfileType.User) ?? [];
  // Summed per active profile: the same setting on Global and a group counts twice.
  const listed = groups.concat(global ? [global] : []);
  const totalDefaults = listed.reduce((n, p) => n + (p.active ? p.defaults : 0), 0);
  const totalLocked = listed.reduce((n, p) => n + (p.active ? p.locked : 0), 0);
  const toRollouts = { label: 'Open rollouts', onClick: () => { openPage('rollouts').catch((e) => setNotice({ intent: 'error', text: errorText(e) })); } };

  const runReconcile = async () => {
    try { await reconcile(); setNotice({ intent: 'success', text: 'Reconcile queued. It applies changed layers to everyone and resumes stalled jobs.', action: toRollouts }); }
    catch (e) { setNotice({ intent: 'error', title: 'Reconcile failed.', text: errorText(e) }); }
  };

  return (
    <>
      <Card className="commandbar" label="Profile commands">
        <Toolbar aria-label="Profile commands" style={{ flexWrap: 'wrap', padding: 0 }}>
          <ToolbarButton icon={<AddRegular />} onClick={() => setNewOpen(true)}>New group profile</ToolbarButton>
          <ToolbarButton icon={<PlayRegular />} onClick={() => setRolloutOpen(true)}>Roll out now</ToolbarButton>
          <ToolbarButton icon={<ArrowSyncRegular />} onClick={runReconcile}>Reconcile</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<ArrowClockwiseRegular />} onClick={() => { setData(undefined); load(true); }}>Refresh</ToolbarButton>
        </Toolbar>
      </Card>

      <NoticeBar notice={notice} onDismiss={() => setNotice(undefined)} />

      {data && !global && <NoticeBar notice={{ intent: 'warning', title: 'No Global profile.', text: 'Nothing is managed until a Global profile exists. Create it with scripts/Seed-GlobalProfile.ps1.' }} />}
      {global && !global.active && <NoticeBar notice={{ intent: 'warning', title: 'Feature is off.', text: 'The Global profile is inactive, so no setting is applied or enforced for anyone.', action: { label: 'Open Global', onClick: () => onOpen(global.id) } }} />}
      {global?.active && global.pilotTeamId && (
        <NoticeBar notice={{
          intent: 'info', title: 'Pilot mode.',
          text: `Only members of the team ${global.pilotTeamName ?? ''} (${data?.pilotMembers === undefined ? '?' : plural(data.pilotMembers, 'user')}) get default or locked settings. Everyone else is untouched.`,
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
              <div className="kpi-value">{totalDefaults + totalLocked} <small>across {plural(listed.length, 'profile')}</small></div>
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
              <div className="small muted">{data.reverts[0] ? `Most often: ${settingLabel(data.reverts[0].setting)}` : 'No locked setting was changed'}</div>
            </Card>
            <Card className="card-pad" label="User overrides">
              <div className="small muted">User overrides</div>
              <div className="kpi-value">{users.length}</div>
              <div className="small muted"><Link onClick={() => openPage('users')}>Find a user</Link></div>
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
                      <td className="primary"><Link onClick={() => openPage('users')}>User overrides</Link></td>
                      <td><span className="badge">User</span></td>
                      <td>{plural(users.length, 'user')} with their own values</td>
                      <td className="num">{users.reduce((n, u) => n + u.defaults, 0)}</td>
                      <td className="num">{users.reduce((n, u) => n + u.locked, 0)}</td>
                      <td>Active</td>
                      <td>{formatDate(users.map((u) => u.modifiedOn ?? '').sort().pop())}</td>
                    </tr>
                  )}
                  {listed.map((p, i) => (
                    <tr key={p.id} style={p.active ? undefined : { color: 'var(--colorNeutralForeground3)' }}>
                      <td className="muted">{i + (users.length ? 2 : 1)}</td>
                      <td className="primary"><Link onClick={() => onOpen(p.id)}>{p.name}</Link></td>
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
            <div className="grid-footer"><span>Rows: {listed.length + (users.length ? 1 : 0)}</span></div>
          </Card>

          <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
            <Card label="Recent rollouts">
              <div className="card-head"><h2 className="card-title">Recent rollouts</h2><span className="grow" /><Link className="small" onClick={() => openPage('rollouts')}>See all</Link></div>
              {data.jobs.length === 0 ? <Empty>No rollouts yet</Empty> : (
                <table className="grid-table"><tbody>
                  {data.jobs.map((j) => (
                    <tr key={j.id}><td className="primary">{j.name}</td><td><JobStatusLabel status={j.status} failed={j.failed} /></td><td className="num muted">{j.dryRun ? `(${j.updated}) dry run` : `${j.updated} updated`}</td></tr>
                  ))}
                </tbody></table>
              )}
            </Card>
            <Card label="Most reverted locked settings">
              <div className="card-head"><h2 className="card-title">Most reverted locked settings</h2><span className="grow" /><Link className="small" onClick={() => openPage('log')}>Activity log</Link></div>
              {data.reverts.length === 0 ? <Empty>Nothing was reverted in the last 7 days</Empty> : (
                <table className="grid-table"><tbody>
                  {data.reverts.map((r) => (
                    <tr key={r.setting}><td className="primary">{settingLabel(r.setting)}</td><td className="num">{plural(r.count, 'revert')}</td></tr>
                  ))}
                </tbody></table>
              )}
            </Card>
          </div>
        </>
      )}

      <RolloutDialog open={rolloutOpen} onClose={() => setRolloutOpen(false)}
        onQueued={(_, dry) => setNotice({ intent: 'success', text: dry ? 'Dry run queued. The job counts what would change and writes nothing.' : 'Rollout queued.', action: toRollouts })} />
      <NewProfileDialog open={newOpen} onClose={() => setNewOpen(false)} taken={groups.map((g) => g.priority ?? 0)} onCreated={onOpen} />
      {global && (
        <ConfirmDialog open={goLiveOpen} onClose={() => setGoLiveOpen(false)} title="Go live for everyone?" confirmLabel="Go live"
          text={`This removes the pilot team from the Global profile. All ${data?.licensed ?? ''} licensed users come into scope: a rollout starts, locks are enforced for everyone, and defaults are applied to users whose layers changed.`}
          onConfirm={async () => { await updateProfile(global.id, pilotTeamPatch(undefined)); await load(true); }} />
      )}
    </>
  );
}

function NewProfileDialog({ open, onClose, taken, onCreated }: { open: boolean; onClose: () => void; taken: number[]; onCreated: (id: string) => void }) {
  const mount = useMount();
  const next = Math.max(0, ...taken) + 10;
  const [name, setName] = React.useState('');
  const [priority, setPriority] = React.useState<string>('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const prio = priority === '' ? next : Number(priority);
  const clash = taken.indexOf(prio) >= 0;

  const create = async () => {
    setBusy(true); setError(undefined);
    try { const id = await createGroupProfile(name.trim(), prio); setBusy(false); onClose(); onCreated(id); }
    catch (e) { setBusy(false); setError(errorText(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface mountNode={mount}>
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

// ---- Editor ----------------------------------------------------------------------------------------------------

type Edits = Record<string, unknown>;
const PILOT_KEY = '__pilot';
type EditorTab = 'settings' | 'scopes' | 'details' | 'history';

interface EditorData { profile: ProfileDetail; global?: ProfileDetail; scopes: Scope[] }

async function loadEditor(id: string): Promise<EditorData> {
  const profile = await loadProfile(id);
  const [global, scopes] = await Promise.all([
    profile.type === ProfileType.Global ? Promise.resolve(undefined) : findGlobal(),
    profile.type === ProfileType.Group ? loadScopes(id) : Promise.resolve([] as Scope[]),
  ]);
  return { profile, global, scopes };
}

function ProfileEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = React.useState<EditorData>();
  const [edits, setEdits] = React.useState<Edits>({});
  const [tab, setTab] = React.useState<EditorTab>('settings');
  const [group, setGroup] = React.useState(GROUPS[0]);
  const [managedOnly, setManagedOnly] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [notice, setNotice] = React.useState<Notice>();
  const [saving, setSaving] = React.useState(false);
  const [confirm, setConfirm] = React.useState<'load' | 'delete' | undefined>();

  const load = React.useCallback(async (fresh?: boolean) => {
    if (fresh) forget(`editor:${id}`);
    try { setData(await shared(`editor:${id}`, () => loadEditor(id))); }
    catch (e) { setNotice({ intent: 'error', title: 'Could not load the profile.', text: errorText(e) }); }
  }, [id]);
  React.useEffect(() => { setEdits({}); load(); }, [load]);

  const profile = data?.profile;
  const row = profile?.row ?? {};
  const value = (d: SettingDefinition) => (d.valueColumn in edits ? edits[d.valueColumn] : readValue(row, d));
  const mode = (d: SettingDefinition) => (d.modeColumn in edits ? (edits[d.modeColumn] as number) : readMode(row, d));
  const set = (key: string, v: unknown, original: unknown) => setEdits((e) => {
    const next = { ...e };
    if (v === original || (v === '' && (original === null || original === undefined))) delete next[key]; else next[key] = v;
    return next;
  });

  const changeCount = Object.keys(edits).length;
  const errors = React.useMemo(() => SETTINGS.filter((d) => {
    if (mode(d) === Mode.Inherit) return false;
    const v = value(d);
    if (v === null || v === undefined || v === '') return true;
    return (d.kind === 'GuidText' || d.kind === 'LookupText' || d.kind === 'Lookup') && !isGuid(String(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [edits, data]);
  const toRollouts = { label: 'Open rollouts', onClick: () => { openPage('rollouts').catch((e) => setNotice({ intent: 'error', text: errorText(e) })); } };

  const save = async () => {
    if (!profile) return;
    if (errors.length) { setNotice({ intent: 'error', title: 'Fix these settings first.', text: errors.map((d) => `${d.label} needs a valid value`).join('; ') }); return; }
    setSaving(true);
    try {
      let patch: Record<string, unknown> = {};
      for (const key of Object.keys(edits)) {
        const v = edits[key];
        if (key === PILOT_KEY) { patch = { ...patch, ...pilotTeamPatch((v as Named | undefined)?.id) }; continue; }
        const def = SETTINGS.find((d) => d.valueColumn === key);
        patch = { ...patch, ...(def ? valuePatch(def, v) : { [key]: v }) };
      }
      const changedSettings = SETTINGS.filter((d) => d.valueColumn in edits || d.modeColumn in edits).length;
      await updateProfile(profile.id, patch);
      setEdits({});
      await load(true);
      setSaving(false);
      setNotice({
        intent: 'success', title: 'Saved.',
        text: changedSettings ? `A rollout of ${plural(changedSettings, 'setting')} was queued for the users this profile applies to.` : 'Profile details saved.',
        action: changedSettings ? toRollouts : undefined,
      });
    } catch (e) { setSaving(false); setNotice({ intent: 'error', title: 'Not saved.', text: errorText(e) }); }
  };

  const preview = async () => {
    if (!profile) return;
    const managed = SETTINGS.filter((d) => readMode(row, d) !== Mode.Inherit).map((d) => d.attribute);
    if (!managed.length) { setNotice({ intent: 'info', text: 'This profile manages no setting yet, so a rollout would change nothing.' }); return; }
    try {
      await applyDefaults({ scope: 'All', applyMode: 'Full', dryRun: true, settings: managed });
      setNotice({ intent: 'success', text: 'Dry run queued for this profile\'s settings. It counts the users whose value would change and writes nothing.', action: toRollouts });
    } catch (e) { setNotice({ intent: 'error', title: 'Dry run failed.', text: errorText(e) }); }
  };

  if (!data || !profile) {
    return (
      <>
        <Card className="commandbar" label="Profile commands">
          <Toolbar aria-label="Profile commands" style={{ padding: 0 }}><ToolbarButton icon={<ArrowLeftRegular />} onClick={onBack}>Profiles</ToolbarButton></Toolbar>
        </Card>
        <NoticeBar notice={notice} />
        {!notice && <Loading />}
      </>
    );
  }

  const global = data.global;
  const isGlobal = profile.type === ProfileType.Global;
  const isGroup = profile.type === ProfileType.Group;
  const isUser = profile.type === ProfileType.User;
  const counts = { def: SETTINGS.filter((d) => mode(d) === Mode.Default).length, lock: SETTINGS.filter((d) => mode(d) === Mode.Locked).length };
  const visible = SETTINGS.filter((d) => (search ? `${d.label} ${d.attribute}`.toLowerCase().indexOf(search.toLowerCase()) >= 0 : d.group === group))
    .filter((d) => !managedOnly || mode(d) !== Mode.Inherit);
  const otherwise = (d: SettingDefinition): [string, string] => {
    if (isGlobal || !global) return ['Their own value', 'Not managed'];
    const gm = readMode(global.row, d);
    if (gm === Mode.Inherit) return ['Their own value', 'Not managed by Global'];
    return [formatValue(d, readValue(global.row, d)) || '(empty)', `Global · ${MODE_NAMES[gm]}`];
  };
  const pilot = PILOT_KEY in edits ? (edits[PILOT_KEY] as Named | undefined) : profile.pilotTeamId ? { id: profile.pilotTeamId, name: profile.pilotTeamName ?? '' } : undefined;
  const active = Boolean('jhrb_isactive' in edits ? edits.jhrb_isactive : profile.active);

  return (
    <>
      <Card className="commandbar" label="Profile commands">
        <Toolbar aria-label="Profile commands" style={{ flexWrap: 'wrap', padding: 0, width: '100%' }}>
          <ToolbarButton aria-label="Back to profiles" icon={<ArrowLeftRegular />} onClick={onBack} />
          <ToolbarButton icon={<SaveRegular />} disabled={!changeCount || saving} onClick={save}>Save</ToolbarButton>
          <ToolbarButton icon={<ArrowDownloadRegular />} onClick={() => setConfirm('load')}>Load current values</ToolbarButton>
          <ToolbarButton icon={<PlayRegular />} onClick={preview}>Preview rollout</ToolbarButton>
          <ToolbarButton icon={<PowerRegular />} onClick={() => set('jhrb_isactive', !active, profile.active)}>{active ? 'Deactivate' : 'Activate'}</ToolbarButton>
          <span className="grow" />
          {!isGlobal && <><ToolbarDivider /><ToolbarButton icon={<DeleteRegular />} onClick={() => setConfirm('delete')}>Delete</ToolbarButton></>}
        </Toolbar>
      </Card>

      <NoticeBar notice={notice} onDismiss={() => setNotice(undefined)} />

      <Card label="Profile header">
        <div className="row-flex" style={{ padding: '16px 20px 0' }}>
          <Avatar name={profile.name} size={40} color="brand" aria-hidden />
          <div className="grow">
            <h1 className="page-title">{profile.name} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· {changeCount ? 'Unsaved' : 'Saved'}</span></h1>
            <div className="muted">Settings profile · {PROFILE_TYPE_NAMES[profile.type]}{isUser && profile.userName ? ` · ${profile.userName}` : ''}</div>
          </div>
          <dl style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 32px', margin: 0 }}>
            {isGroup && <div><dt className="small muted">Priority</dt><dd style={{ margin: 0, fontWeight: 600 }}>{profile.priority}</dd></div>}
            {isGlobal && <div><dt className="small muted">Pilot team</dt><dd style={{ margin: 0, fontWeight: 600 }}>{profile.pilotTeamName ?? 'None (everyone)'}</dd></div>}
            <div><dt className="small muted">Managed</dt><dd style={{ margin: 0, fontWeight: 600 }}>{counts.def} default · {counts.lock} locked</dd></div>
            <div><dt className="small muted">Status</dt><dd style={{ margin: 0, fontWeight: 600 }}>{profile.active ? 'Active' : 'Inactive'}</dd></div>
          </dl>
        </div>
        <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as EditorTab)} style={{ padding: '8px 8px 0' }}>
          <Tab value="settings">Settings</Tab>
          {isGroup && <Tab value="scopes">Applies to ({data.scopes.length})</Tab>}
          <Tab value="details">Details</Tab>
          <Tab value="history">History</Tab>
        </TabList>
      </Card>

      {tab === 'settings' && (
        <div className="split">
          <nav aria-label="Setting groups" className="card groups" style={{ padding: 8, boxSizing: 'border-box' }}>
            {GROUPS.map((g) => {
              const n = SETTINGS.filter((d) => d.group === g && mode(d) !== Mode.Inherit).length;
              return (
                <button key={g} type="button" className="group-btn" aria-current={!search && g === group ? 'true' : 'false'} onClick={() => { setSearch(''); setGroup(g); }}>
                  <span>{g}</span><span className="small muted" style={{ fontWeight: 400 }}>{n ? `${n} managed` : ''}</span>
                </button>
              );
            })}
          </nav>
          <section aria-labelledby="dus-h-group" className="card wide">
            <div className="card-head">
              <h2 id="dus-h-group" className="card-title">{search ? `Search: ${search}` : group}</h2>
              <span className="small muted">Inherit = not managed here. Default = applied, the user may change it. Locked = applied and enforced.</span>
              <span className="grow" />
              <SearchBox size="small" placeholder="Find a setting" value={search} onChange={(_, d) => setSearch(d.value)} style={{ width: 200 }} />
              <Switch label="Managed only" checked={managedOnly} onChange={(_, d) => setManagedOnly(d.checked)} />
            </div>
            <div className="scroll-x">
              <div role="table" aria-label={`${group} settings`} className="setting-table">
                <div role="row" className="setting-row head">
                  <span role="columnheader">Setting</span><span role="columnheader">Value in this profile</span><span role="columnheader">Mode</span>
                  <span role="columnheader">{isGlobal ? 'Otherwise users keep' : 'Without this profile'}</span>
                </div>
                {visible.length === 0 && <Empty>{managedOnly ? 'This profile manages no setting in this group.' : 'No setting matches.'}</Empty>}
                {visible.map((d) => {
                  const m = mode(d);
                  const changed = d.valueColumn in edits || d.modeColumn in edits;
                  const [ov, os] = otherwise(d);
                  return (
                    <div role="row" key={d.attribute} className={`setting-row${changed ? ' changed' : ''}`}>
                      <div role="cell"><div>{d.label}</div><div className="small muted">{d.attribute}</div></div>
                      <div role="cell">
                        {m === Mode.Inherit
                          ? <div className="not-managed">Not managed here</div>
                          : <ValueEditor def={d} value={value(d)} displayName={d.kind === 'Lookup' ? display(row, d.valueColumn) : undefined}
                              onChange={(v) => set(d.valueColumn, v, readValue(row, d))} />}
                      </div>
                      <div role="cell"><ModeSwitch label={d.label} mode={m} onChange={(nm) => set(d.modeColumn, nm, readMode(row, d))} /></div>
                      <div role="cell" className="small"><div>{ov}</div><div className="muted">{os}</div></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === 'scopes' && isGroup && <ScopesTab profileId={profile.id} scopes={data.scopes} onChanged={() => load(true)} onError={(t) => setNotice({ intent: 'error', title: 'Scope not changed.', text: t })} />}

      {tab === 'details' && (
        <Card className="card-pad" label="Details">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, maxWidth: 900 }}>
            <Field label="Name" required>
              <Input appearance="filled-darker" value={String(('jhrb_name' in edits ? edits.jhrb_name : profile.name) ?? '')} onChange={(_, d) => set('jhrb_name', d.value, profile.name)} />
            </Field>
            <Field label="Type"><span>{PROFILE_TYPE_NAMES[profile.type]}</span></Field>
            {isGroup && (
              <Field label="Priority" hint="Higher wins when a user is in several groups. Must be unique.">
                <Input appearance="filled-darker" type="number" value={String(('jhrb_priority' in edits ? edits.jhrb_priority : profile.priority) ?? '')}
                  onChange={(_, d) => set('jhrb_priority', d.value === '' ? null : Number(d.value), profile.priority)} />
              </Field>
            )}
            <Field label="Active" hint={isGlobal ? 'Inactive Global turns the whole feature off.' : 'Inactive profiles are ignored.'}>
              <Switch checked={active} onChange={(_, d) => set('jhrb_isactive', d.checked, profile.active)} />
            </Field>
            {isUser && profile.userId && <Field label="User"><Link onClick={() => openPage('users', { userId: profile.userId ?? '' })}>{profile.userName}</Link></Field>}
            {isGlobal && (
              <Field label="Pilot team" hint="When set, only members of this team are in scope. Clear it to go live for everyone.">
                <div style={{ display: 'flex', gap: 8 }}>
                  <EntityPicker label="Pilot team" search={searchTeams} value={pilot} onChange={(v) => setEdits((e) => ({ ...e, [PILOT_KEY]: v }))} />
                  {pilot && <Button icon={<DismissRegular />} aria-label="Clear pilot team" onClick={() => setEdits((e) => ({ ...e, [PILOT_KEY]: undefined }))} />}
                </div>
              </Field>
            )}
          </div>
        </Card>
      )}

      {tab === 'history' && <HistoryTab profileId={profile.id} />}

      <div className="footer-bar">
        {changeCount ? (
          <>
            <span className="status warning"><WarningRegular className="icon16" /><strong>{plural(changeCount, 'unsaved change')}</strong></span>
            <span className="small muted">{isGlobal ? 'Saving rolls the changed settings out to everyone in scope.' : 'Saving rolls the changed settings out to the users this profile applies to.'}</span>
            <span className="grow" />
            <Button onClick={() => setEdits({})}>Discard</Button>
            <Button appearance="primary" disabled={saving} icon={saving ? <Spinner size="tiny" /> : undefined} onClick={save}>Save</Button>
          </>
        ) : (
          <span className="status muted"><CheckmarkRegular className="icon16" />All changes saved.</span>
        )}
      </div>

      <ConfirmDialog open={confirm === 'load'} onClose={() => setConfirm(undefined)} title="Load current values" confirmLabel="Load"
        text={`Copy ${isUser ? `${profile.userName ?? 'the user'}'s` : 'your own'} current personal settings into this profile? Only settings on Inherit are filled; settings on Default or Locked keep their values, and no mode is changed, so nothing is rolled out.`}
        onConfirm={async () => {
          const r = await loadCurrentValues({ profileId: profile.id });
          setEdits({});
          await load(true);
          setNotice({ intent: 'success', text: `Loaded ${r.loaded} value(s)${r.keptManaged ? `; kept ${r.keptManaged} managed setting(s)` : ''}. Set a mode to Default or Locked to apply a value.` });
        }} />
      <ConfirmDialog open={confirm === 'delete'} onClose={() => setConfirm(undefined)} title={`Delete ${profile.name}?`} confirmLabel="Delete" danger
        text="The profile is deleted and its users fall back to the remaining layers at the next rollout (queued right away). Users keep their current values until then. This cannot be undone."
        onConfirm={async () => { await deleteProfile(profile.id); forget('overview'); onBack(); }} />
    </>
  );
}

function ScopesTab({ profileId, scopes, onChanged, onError }: { profileId: string; scopes: Scope[]; onChanged: () => Promise<void>; onError: (t: string) => void }) {
  const mount = useMount();
  const [kind, setKind] = React.useState<'team' | 'bu'>('team');
  const [picked, setPicked] = React.useState<Named>();
  const [children, setChildren] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const add = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await addScope(profileId, kind === 'team' ? { teamId: picked.id, name: `Team ${picked.name}` } : { businessUnitId: picked.id, includeChildren: children, name: `BU ${picked.name}` });
      setPicked(undefined); setChildren(false);
      await onChanged();
    } catch (e) { onError(errorText(e)); }
    setBusy(false);
  };

  return (
    <Card label="Applies to">
      <div className="card-head">
        <h2 className="card-title">Applies to</h2>
        <span className="small muted">Members of any of these teams or business units get this profile (OR). Changes start a rollout.</span>
      </div>
      <table className="grid-table">
        <thead><tr><th scope="col">Type</th><th scope="col">Name</th><th scope="col">Child business units</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {scopes.length === 0 && <tr><td colSpan={4} className="muted">No scopes yet: this profile applies to nobody.</td></tr>}
          {scopes.map((s) => (
            <tr key={s.id}>
              <td><span className="badge">{s.teamId ? 'Team' : 'Business unit'}</span></td>
              <td className="primary">{s.teamName ?? s.businessUnitName}</td>
              <td>{s.teamId ? '' : s.includeChildren ? 'Included' : 'Not included'}</td>
              <td className="num"><Button appearance="subtle" icon={<DeleteRegular />} aria-label={`Remove ${s.teamName ?? s.businessUnitName ?? 'scope'}`}
                onClick={async () => { try { await removeScope(s.id); await onChanged(); } catch (e) { onError(errorText(e)); } }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-flex" style={{ padding: '12px 16px', borderTop: '1px solid var(--colorNeutralStroke2)' }}>
        <Dropdown aria-label="Scope type" appearance="filled-darker" mountNode={mount} value={kind === 'team' ? 'Team' : 'Business unit'} selectedOptions={[kind]}
          onOptionSelect={(_, d) => { setKind(d.optionValue as 'team' | 'bu'); setPicked(undefined); }} style={{ minWidth: 160 }}>
          <Option value="team">Team</Option>
          <Option value="bu">Business unit</Option>
        </Dropdown>
        <div style={{ width: 280 }}>
          <EntityPicker key={kind} label={kind === 'team' ? 'Team' : 'Business unit'} search={kind === 'team' ? searchTeams : searchBusinessUnits} value={picked} onChange={setPicked}
            placeholder={kind === 'team' ? 'Search teams' : 'Search business units'} />
        </div>
        {kind === 'bu' && <Switch label="Include child business units" checked={children} onChange={(_, d) => setChildren(d.checked)} />}
        <Button icon={<AddRegular />} disabled={!picked || busy} onClick={add}>Add</Button>
      </div>
    </Card>
  );
}

function HistoryTab({ profileId }: { profileId: string }) {
  const [rows, setRows] = React.useState<LogEntry[]>();
  React.useEffect(() => { loadLog({ profileId, top: 100 }).then(setRows).catch(() => setRows([])); }, [profileId]);
  if (!rows) return <Loading />;
  return (
    <Card label="History">
      <div className="card-head"><h2 className="card-title">Changes caused by this profile</h2><span className="small muted">Latest 100</span></div>
      {rows.length === 0 ? <Empty>Nothing yet</Empty> : (
        <div className="scroll-x">
          <table className="grid-table" style={{ minWidth: 760 }}>
            <thead><tr><th scope="col">When</th><th scope="col">User</th><th scope="col">What</th><th scope="col">Setting</th><th scope="col">Change</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.createdOn)}</td>
                  <td className="primary">{r.userId ? <Link onClick={() => openPage('users', { userId: r.userId ?? '' })}>{r.userName}</Link> : ''}</td>
                  <td>{LOG_SOURCE_NAMES[r.source ?? 0] ?? ''}</td>
                  <td>{settingLabel(r.setting)}</td>
                  <td>{r.source === LogSource.Reverted ? `${r.attempted ?? ''} reverted to ${r.applied ?? ''}` : `${r.oldValue ?? '(empty)'} → ${r.applied ?? ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---- Page ------------------------------------------------------------------------------------------------------

function ProfilesPage({ input }: { input: PageProps['pageInput'] }) {
  const [openId, setOpenId] = React.useState<string | undefined>(() => {
    const id = inputText(input, 'profileId');
    return isGuid(id) ? id : undefined;
  });
  return openId
    ? <ProfileEditor key={openId} id={openId} onBack={() => setOpenId(undefined)} />
    : <ProfilesOverview onOpen={setOpenId} />;
}

export default function Page(props: PageProps) {
  return (
    <PageRoot dataApi={props.dataApi} label="Default user settings: profiles">
      <ProfilesPage input={props.pageInput} />
    </PageRoot>
  );
}
