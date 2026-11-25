import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Toolbar, ToolbarButton, ToolbarDivider, TabList, Tab, Button, Switch, SearchBox, Field, Input, Dropdown, Option, Link, Spinner, Avatar,
} from '@fluentui/react-components';
import {
  ArrowLeft20Regular, Save20Regular, ArrowDownload20Regular, Play20Regular, Delete20Regular, Power20Regular, Warning16Regular, Checkmark16Regular, Dismiss16Regular, Add16Regular,
} from '@fluentui/react-icons';
import {
  loadProfile, findGlobal, loadScopes, addScope, removeScope, updateProfile, deleteProfile, readValue, readMode, valuePatch, type ProfileDetail, type Scope,
} from '../data/profiles';
import { applyDefaults, loadCurrentValues, loadLog, type LogEntry } from '../data/operations';
import { searchTeams, searchBusinessUnits, type Named } from '../data/directory';
import { display, errorText, formatDate, isGuid } from '../data/dv';
import { SETTINGS, GROUPS, Mode, MODE_NAMES, ProfileType, PROFILE_TYPE_NAMES, LOG_SOURCE_NAMES, byAttribute, formatValue, type SettingDefinition } from '../settings';
import { Card, Loading, NoticeBar, Empty, type Notice } from '../components/common';
import { ModeSwitch, ValueEditor } from '../components/SettingControls';
import { EntityPicker } from '../components/EntityPicker';
import { ConfirmDialog } from '../components/RolloutDialog';
import { navigate } from '../router';

type Edits = Record<string, unknown>;
const PILOT = '__pilot';

export function ProfileEditorPage({ id }: { id: string }) {
  const [profile, setProfile] = useState<ProfileDetail>();
  const [global, setGlobal] = useState<ProfileDetail>();
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [edits, setEdits] = useState<Edits>({});
  const [tab, setTab] = useState<'settings' | 'scopes' | 'details' | 'history'>('settings');
  const [group, setGroup] = useState(GROUPS[0]);
  const [managedOnly, setManagedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<Notice>();
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<'load' | 'delete' | undefined>();

  const load = useCallback(async () => {
    try {
      const p = await loadProfile(id);
      setProfile(p);
      setGlobal(p.type === ProfileType.Global ? undefined : await findGlobal());
      setScopes(p.type === ProfileType.Group ? await loadScopes(id) : []);
    } catch (e) { setNotice({ intent: 'error', title: 'Could not load the profile.', text: errorText(e) }); }
  }, [id]);
  useEffect(() => { setEdits({}); load(); }, [load]);

  const row = profile?.row ?? {};
  const value = (d: SettingDefinition) => (d.valueColumn in edits ? edits[d.valueColumn] : readValue(row, d));
  const mode = (d: SettingDefinition) => (d.modeColumn in edits ? (edits[d.modeColumn] as number) : readMode(row, d));
  const set = (key: string, v: unknown, original: unknown) => setEdits((e) => {
    const next = { ...e };
    if (v === original || (v === '' && (original === null || original === undefined))) delete next[key]; else next[key] = v;
    return next;
  });

  const changeCount = Object.keys(edits).length;
  const errors = useMemo(() => SETTINGS.filter((d) => {
    if (mode(d) === Mode.Inherit) return false;
    const v = value(d);
    if (v === null || v === undefined || v === '') return true;
    return (d.kind === 'GuidText' || d.kind === 'LookupText' || d.kind === 'Lookup') && !isGuid(String(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [edits, profile]);

  const save = async () => {
    if (!profile) return;
    if (errors.length) { setNotice({ intent: 'error', title: 'Fix these settings first.', text: errors.map((d) => `${d.label} needs a valid value`).join('; ') }); return; }
    setSaving(true);
    try {
      let patch: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(edits)) {
        if (key === PILOT) { patch['jhrb_PilotTeam@odata.bind'] = v ? `/teams(${(v as Named).id})` : null; continue; }
        const def = SETTINGS.find((d) => d.valueColumn === key);
        patch = { ...patch, ...(def ? valuePatch(def, v) : { [key]: v }) };
      }
      const changedSettings = SETTINGS.filter((d) => d.valueColumn in edits || d.modeColumn in edits).length;
      await updateProfile(profile.id, patch);
      setEdits({});
      await load();
      setNotice({
        intent: 'success', title: 'Saved.',
        text: changedSettings ? `A rollout of ${changedSettings} setting${changedSettings === 1 ? '' : 's'} was queued for the users this profile applies to.` : 'Profile details saved.',
        action: changedSettings ? { label: 'Open rollouts', onClick: () => navigate({ page: 'rollouts' }) } : undefined,
      });
    } catch (e) { setNotice({ intent: 'error', title: 'Not saved.', text: errorText(e) }); } finally { setSaving(false); }
  };

  const preview = async () => {
    if (!profile) return;
    const managed = SETTINGS.filter((d) => readMode(row, d) !== Mode.Inherit).map((d) => d.attribute);
    if (!managed.length) { setNotice({ intent: 'info', text: 'This profile manages no setting yet, so a rollout would change nothing.' }); return; }
    try {
      await applyDefaults({ scope: 'All', applyMode: 'Full', dryRun: true, settings: managed });
      setNotice({ intent: 'success', text: 'Dry run queued for this profile\'s settings. It counts the users whose value would change and writes nothing.', action: { label: 'Open rollouts', onClick: () => navigate({ page: 'rollouts' }) } });
    } catch (e) { setNotice({ intent: 'error', title: 'Dry run failed.', text: errorText(e) }); }
  };

  if (!profile) return <><NoticeBar notice={notice} />{!notice && <Loading />}</>;

  const isGlobal = profile.type === ProfileType.Global;
  const isGroup = profile.type === ProfileType.Group;
  const isUser = profile.type === ProfileType.User;
  const counts = { def: SETTINGS.filter((d) => mode(d) === Mode.Default).length, lock: SETTINGS.filter((d) => mode(d) === Mode.Locked).length };
  const visible = SETTINGS.filter((d) => (search ? `${d.label} ${d.attribute}`.toLowerCase().includes(search.toLowerCase()) : d.group === group))
    .filter((d) => !managedOnly || mode(d) !== Mode.Inherit);
  const otherwise = (d: SettingDefinition): [string, string] => {
    if (isGlobal || !global) return ['Their own value', 'Not managed'];
    const gm = readMode(global.row, d);
    if (gm === Mode.Inherit) return ['Their own value', 'Not managed by Global'];
    return [formatValue(d, readValue(global.row, d)) || '(empty)', `Global · ${MODE_NAMES[gm]}`];
  };
  const pilot = PILOT in edits ? (edits[PILOT] as Named | undefined) : profile.pilotTeamId ? { id: profile.pilotTeamId, name: profile.pilotTeamName ?? '' } : undefined;

  return (
    <>
      <Card className="commandbar" label="Profile commands">
        <Toolbar aria-label="Profile commands" style={{ flexWrap: 'wrap', padding: 0, width: '100%' }}>
          <ToolbarButton aria-label="Back to profiles" icon={<ArrowLeft20Regular />} onClick={() => navigate({ page: 'profiles' })} />
          <ToolbarButton icon={<Save20Regular />} disabled={!changeCount || saving} onClick={save}>Save</ToolbarButton>
          <ToolbarButton icon={<ArrowDownload20Regular />} onClick={() => setConfirm('load')}>Load current values</ToolbarButton>
          <ToolbarButton icon={<Play20Regular />} onClick={preview}>Preview rollout</ToolbarButton>
          <ToolbarButton icon={<Power20Regular />} onClick={() => set('jhrb_isactive', !(('jhrb_isactive' in edits) ? edits.jhrb_isactive : profile.active), profile.active)}>
            {(('jhrb_isactive' in edits) ? edits.jhrb_isactive : profile.active) ? 'Deactivate' : 'Activate'}
          </ToolbarButton>
          <span className="grow" />
          {!isGlobal && <><ToolbarDivider /><ToolbarButton icon={<Delete20Regular />} onClick={() => setConfirm('delete')}>Delete</ToolbarButton></>}
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
        <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as typeof tab)} style={{ padding: '8px 8px 0' }}>
          <Tab value="settings">Settings</Tab>
          {isGroup && <Tab value="scopes">Applies to ({scopes.length})</Tab>}
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
          <section aria-labelledby="h-group" className="card wide">
            <div className="card-head">
              <h2 id="h-group" className="card-title">{search ? `Search: ${search}` : group}</h2>
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

      {tab === 'scopes' && isGroup && <ScopesTab profileId={profile.id} scopes={scopes} onChanged={load} onError={(t) => setNotice({ intent: 'error', title: 'Scope not changed.', text: t })} />}

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
              <Switch checked={Boolean('jhrb_isactive' in edits ? edits.jhrb_isactive : profile.active)} onChange={(_, d) => set('jhrb_isactive', d.checked, profile.active)} />
            </Field>
            {isUser && <Field label="User"><Link href={`#/users/${profile.userId}`}>{profile.userName}</Link></Field>}
            {isGlobal && (
              <Field label="Pilot team" hint="When set, only members of this team are in scope. Clear it to go live for everyone.">
                <div style={{ display: 'flex', gap: 8 }}>
                  <EntityPicker label="Pilot team" search={searchTeams} value={pilot}
                    onChange={(v) => setEdits((e) => ({ ...e, [PILOT]: v }))} />
                  {pilot && <Button icon={<Dismiss16Regular />} aria-label="Clear pilot team" onClick={() => setEdits((e) => ({ ...e, [PILOT]: undefined }))} />}
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
            <span className="status warning"><Warning16Regular /><strong>{changeCount} unsaved change{changeCount === 1 ? '' : 's'}</strong></span>
            <span className="small muted">{isGlobal ? 'Saving rolls the changed settings out to everyone in scope.' : 'Saving rolls the changed settings out to the users this profile applies to.'}</span>
            <span className="grow" />
            <Button onClick={() => setEdits({})}>Discard</Button>
            <Button appearance="primary" disabled={saving} icon={saving ? <Spinner size="tiny" /> : undefined} onClick={save}>Save</Button>
          </>
        ) : (
          <span className="status muted"><Checkmark16Regular />All changes saved.</span>
        )}
      </div>

      <ConfirmDialog open={confirm === 'load'} onClose={() => setConfirm(undefined)} title="Load current values" confirmLabel="Load"
        text={`Copy ${isUser ? `${profile.userName ?? 'the user'}'s` : 'your own'} current personal settings into this profile? Only settings on Inherit are filled; settings on Default or Locked keep their values, and no mode is changed, so nothing is rolled out.`}
        onConfirm={async () => {
          const r = await loadCurrentValues({ profileId: profile.id });
          setEdits({}); await load();
          setNotice({ intent: 'success', text: `Loaded ${r.loaded} value(s)${r.keptManaged ? `; kept ${r.keptManaged} managed setting(s)` : ''}. Set a mode to Default or Locked to apply a value.` });
        }} />
      <ConfirmDialog open={confirm === 'delete'} onClose={() => setConfirm(undefined)} title={`Delete ${profile.name}?`} confirmLabel="Delete" danger
        text="The profile is deleted and its users fall back to the remaining layers at the next rollout (queued right away). Users keep their current values until then. This cannot be undone."
        onConfirm={async () => { await deleteProfile(profile.id); navigate({ page: 'profiles' }); }} />
    </>
  );
}

function ScopesTab({ profileId, scopes, onChanged, onError }: { profileId: string; scopes: Scope[]; onChanged: () => Promise<void>; onError: (t: string) => void }) {
  const [kind, setKind] = useState<'team' | 'bu'>('team');
  const [picked, setPicked] = useState<Named>();
  const [children, setChildren] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await addScope(profileId, kind === 'team' ? { teamId: picked.id, name: `Team ${picked.name}` } : { businessUnitId: picked.id, includeChildren: children, name: `BU ${picked.name}` });
      setPicked(undefined); setChildren(false); await onChanged();
    } catch (e) { onError(errorText(e)); } finally { setBusy(false); }
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
              <td className="num"><Button appearance="subtle" icon={<Delete20Regular />} aria-label={`Remove ${s.teamName ?? s.businessUnitName}`}
                onClick={async () => { try { await removeScope(s.id); await onChanged(); } catch (e) { onError(errorText(e)); } }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-flex" style={{ padding: '12px 16px', borderTop: '1px solid var(--colorNeutralStroke2)' }}>
        <Dropdown aria-label="Scope type" appearance="filled-darker" value={kind === 'team' ? 'Team' : 'Business unit'} selectedOptions={[kind]}
          onOptionSelect={(_, d) => { setKind(d.optionValue as 'team' | 'bu'); setPicked(undefined); }} style={{ minWidth: 160 }}>
          <Option value="team">Team</Option>
          <Option value="bu">Business unit</Option>
        </Dropdown>
        <div style={{ width: 280 }}>
          <EntityPicker key={kind} label={kind === 'team' ? 'Team' : 'Business unit'} search={kind === 'team' ? searchTeams : searchBusinessUnits} value={picked} onChange={setPicked}
            placeholder={kind === 'team' ? 'Search teams' : 'Search business units'} />
        </div>
        {kind === 'bu' && <Switch label="Include child business units" checked={children} onChange={(_, d) => setChildren(d.checked)} />}
        <Button icon={<Add16Regular />} disabled={!picked || busy} onClick={add}>Add</Button>
      </div>
    </Card>
  );
}

function HistoryTab({ profileId }: { profileId: string }) {
  const [rows, setRows] = useState<LogEntry[]>();
  useEffect(() => { loadLog({ profileId, top: 100 }).then(setRows).catch(() => setRows([])); }, [profileId]);
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
                  <td className="primary">{r.userId ? <Link href={`#/users/${r.userId}`}>{r.userName}</Link> : ''}</td>
                  <td>{LOG_SOURCE_NAMES[r.source ?? 0] ?? ''}</td>
                  <td>{byAttribute.get(r.setting ?? '')?.label ?? r.setting}</td>
                  <td>{r.source === 632490002 ? `${r.attempted ?? ''} reverted to ${r.applied ?? ''}` : `${r.oldValue ?? '(empty)'} → ${r.applied ?? ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
