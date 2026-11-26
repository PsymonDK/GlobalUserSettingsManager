// Page "Users": find a user and see their effective settings, where each comes from, and whether their current value
// matches. pageInput.data.userId selects a user directly.
import * as React from 'react';
import { Toolbar, ToolbarButton, ToolbarDivider, SearchBox, Link, Avatar } from '@fluentui/react-components';
import { EditRegular, PlayRegular, ArrowClockwiseRegular, ChevronRightRegular } from '@fluentui/react-icons';
import { inputText, openPage, type PageProps } from '../shared/env';
import { searchUsers, getUser, type User } from '../shared/directory';
import { loadUserEffective, type UserEffective } from '../shared/effective';
import { applyDefaults, loadCurrentValues, loadLog, type LogEntry } from '../shared/operations';
import { findUserProfile, loadProfiles, type ProfileSummary } from '../shared/profiles';
import { errorText, formatDate, isGuid } from '../shared/dv';
import { LOG_SOURCE_NAMES, LogSource, settingLabel } from '../shared/settings';
import { PageRoot, Card, Loading, NoticeBar, Status, ModeLabel, Empty, shared, forget, type Notice } from '../shared/ui';

interface UserData { user: User; effective: UserEffective; profiles: ProfileSummary[]; log: LogEntry[] }

async function loadUserData(userId: string): Promise<UserData> {
  const [user, effective, profiles, log] = await Promise.all([getUser(userId), loadUserEffective(userId), loadProfiles(), loadLog({ userId, top: 10 })]);
  return { user, effective, profiles, log };
}

function openProfile(profileId: string, onError: (t: string) => void) {
  openPage('profiles', { profileId }).catch((e) => onError(errorText(e)));
}

function UserView({ userId }: { userId: string }) {
  const [data, setData] = React.useState<UserData>();
  const [notice, setNotice] = React.useState<Notice>();
  const [busy, setBusy] = React.useState(false);
  const showError = (t: string) => setNotice({ intent: 'error', text: t });

  const load = React.useCallback(async (fresh?: boolean) => {
    if (fresh) forget(`user:${userId}`);
    try { setData(await shared(`user:${userId}`, () => loadUserData(userId))); }
    catch (e) { setNotice({ intent: 'error', title: 'Could not load this user.', text: errorText(e) }); }
  }, [userId]);
  React.useEffect(() => { setData(undefined); load(); }, [load]);

  const editOverride = async () => {
    setBusy(true);
    try {
      const existing = await findUserProfile(userId);
      const profileId = existing ?? (await loadCurrentValues({ userId })).profileId;
      setBusy(false);
      openProfile(profileId, showError);
    } catch (e) { setBusy(false); setNotice({ intent: 'error', title: 'Could not open the override.', text: errorText(e) }); }
  };

  const applyNow = async () => {
    setBusy(true);
    try {
      const r = await applyDefaults({ scope: 'User', userId, applyMode: 'Full' });
      setBusy(false);
      setNotice({ intent: r.failed ? 'warning' : 'success', text: r.failed ? 'The apply failed for this user. See the activity log and the plugin trace.' : r.updated ? 'Applied: the differing values were written and logged.' : 'Nothing to change: the user already has the effective values.' });
      await load(true);
    } catch (e) { setBusy(false); setNotice({ intent: 'error', title: 'Not applied.', text: errorText(e) }); }
  };

  const profileId = (name: string) => data?.profiles.find((p) => p.name === name)?.id;
  const eff = data?.effective;
  const differs = eff?.rows.filter((r) => r.differs).length ?? 0;

  return (
    <>
      <Card className="commandbar" label="User commands">
        <Toolbar aria-label="User commands" style={{ flexWrap: 'wrap', padding: 0, width: '100%' }}>
          <ToolbarButton icon={<EditRegular />} disabled={busy} onClick={editOverride}>Edit override</ToolbarButton>
          <ToolbarButton icon={<PlayRegular />} disabled={busy || !eff?.inScope} onClick={applyNow}>Apply now</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<ArrowClockwiseRegular />} onClick={() => { setData(undefined); load(true); }}>Refresh</ToolbarButton>
        </Toolbar>
      </Card>
      <NoticeBar notice={notice} onDismiss={() => setNotice(undefined)} />
      {!data || !eff ? (notice ? null : <Loading />) : (
        <>
          <Card label="User">
            <div className="stack" style={{ padding: '16px 20px' }}>
              <div className="row-flex">
                <Avatar name={data.user.fullName} size={40} color="colorful" aria-hidden />
                <div className="grow">
                  <h2 className="page-title">{data.user.fullName}</h2>
                  <div className="muted">{[data.user.title, data.user.businessUnitName && `Business unit ${data.user.businessUnitName}`, data.user.licensed ? undefined : 'Unlicensed'].filter(Boolean).join(' · ')}</div>
                </div>
                {eff.inScope ? <span className="badge" style={{ color: 'var(--colorPaletteGreenForeground1)', fontWeight: 600 }}>In scope</span> : <span className="badge">Not in scope</span>}
              </div>
              <div>
                <div className="small muted" style={{ fontWeight: 600, marginBottom: 8 }}>Layers that apply, highest first</div>
                <ol className="layers" aria-label="Layers">
                  {eff.layers.map((name, i) => {
                    const pid = profileId(name);
                    return (
                      <li key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {pid
                          ? <button type="button" className="layer" onClick={() => openProfile(pid, showError)}><span style={{ fontWeight: 600 }}>{name}</span></button>
                          : <span className="layer"><span style={{ fontWeight: 600 }}>{name}</span></span>}
                        {i < eff.layers.length - 1 && <ChevronRightRegular className="icon16" aria-hidden />}
                      </li>
                    );
                  })}
                  {eff.layers.length === 0 && <li className="muted">No layer applies</li>}
                </ol>
              </div>
            </div>
          </Card>

          {!eff.inScope && <NoticeBar notice={{ intent: 'info', text: 'This user is outside the scope (not in the pilot team, or the Global profile is inactive), so nothing is applied or enforced for them.' }} />}
          {eff.inScope && differs > 0 && <NoticeBar notice={{ intent: 'warning', title: `${differs} setting${differs === 1 ? ' differs' : 's differ'} from the effective value.`, text: 'Locked settings change at the next rollout or reconcile (daily), or now with Apply now. A Default setting that differs may simply be the user\'s own choice.' }} />}
          {!eff.hasSettingsRow && <NoticeBar notice={{ intent: 'info', text: 'This user has no personal settings row yet. It is created at first sign-in; defaults are applied then.' }} />}

          <Card label="Effective settings">
            <div className="card-head">
              <h2 className="card-title">Effective settings</h2>
              <span className="small muted">Managed settings only ({eff.rows.length}). The rest stay as the user set them.</span>
            </div>
            {eff.rows.length === 0 ? <Empty>No setting is managed for this user.</Empty> : (
              <div className="scroll-x">
                <table className="grid-table" style={{ minWidth: 900 }}>
                  <thead><tr><th scope="col">Setting</th><th scope="col">Effective value</th><th scope="col">Mode</th><th scope="col">From</th><th scope="col">User has now</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {eff.rows.map((r) => {
                      const source = profileId(r.effective.source);
                      return (
                        <tr key={r.def.attribute} className={r.differs && r.effective.mode === 'Locked' ? 'changed' : undefined}>
                          <td className="primary">{r.def.label}</td>
                          <td>{r.effectiveText}</td>
                          <td><ModeLabel mode={r.effective.mode} /></td>
                          <td>{source ? <Link onClick={() => openProfile(source, showError)}>{r.effective.source}</Link> : r.effective.source}</td>
                          <td>{r.currentText}</td>
                          <td>{!r.differs ? <Status tone="success">Matches</Status>
                            : r.effective.mode === 'Locked' ? <Status tone="warning">Differs</Status>
                            : <span className="muted">Differs (user's own choice?)</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card label="Recent changes">
            <div className="card-head"><h2 className="card-title">Recent changes</h2><span className="grow" /><Link className="small" onClick={() => openPage('log')}>Activity log</Link></div>
            {data.log.length === 0 ? <Empty>No change logged for this user</Empty> : (
              <table className="grid-table"><tbody>
                {data.log.map((l) => (
                  <tr key={l.id}>
                    <td style={{ width: 150 }} className="muted">{formatDate(l.createdOn)}</td>
                    <td style={{ width: 100 }}>{LOG_SOURCE_NAMES[l.source ?? 0] ?? ''}</td>
                    <td>{settingLabel(l.setting)}: {l.source === LogSource.Reverted ? `${l.attempted ?? ''} reverted to ${l.applied ?? ''}` : `${l.oldValue ?? '(empty)'} → ${l.applied ?? ''}`}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function UsersPage({ input }: { input: PageProps['pageInput'] }) {
  const [text, setText] = React.useState('');
  const [results, setResults] = React.useState<User[]>();
  const [selected, setSelected] = React.useState<string | undefined>(() => {
    const id = inputText(input, 'userId');
    return isGuid(id) ? id : undefined;
  });
  const [notice, setNotice] = React.useState<Notice>();

  React.useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      searchUsers(text, 25).then((r) => { if (!cancelled) setResults(r); }).catch((e) => { if (!cancelled) setNotice({ intent: 'error', title: 'Search failed.', text: errorText(e) }); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [text]);

  return (
    <>
      <div className="row-flex" style={{ alignItems: 'baseline' }}>
        <h1 className="page-title">Users</h1>
        <span className="muted">Find a user to see the settings they get, where each one comes from, and whether their current value matches.</span>
      </div>
      <NoticeBar notice={notice} onDismiss={() => setNotice(undefined)} />
      <div className="split">
        <Card className="side" label="Find a user">
          <div className="card-head"><SearchBox placeholder="Search by name or email" value={text} onChange={(_, d) => setText(d.value)} style={{ width: '100%' }} /></div>
          {!results ? <Loading /> : results.length === 0 ? <Empty>No user matches</Empty> : (
            <div role="list" style={{ maxHeight: 640, overflowY: 'auto', padding: 8 }}>
              {results.map((u) => (
                <div role="listitem" key={u.id}>
                  <button type="button" className="list-btn" aria-current={u.id === selected ? 'true' : 'false'} onClick={() => setSelected(u.id)}>
                    <Avatar name={u.fullName} size={28} color="colorful" aria-hidden />
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span className="ellipsis">{u.fullName}</span>
                      <span className="small muted ellipsis">{u.businessUnitName ?? u.email}{u.licensed ? '' : ' · unlicensed'}</span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="wide stack">
          {selected ? <UserView key={selected} userId={selected} /> : <Card className="card-pad" label="No user selected"><Empty>Pick a user on the left.</Empty></Card>}
        </div>
      </div>
    </>
  );
}

export default function Page(props: PageProps) {
  return (
    <PageRoot dataApi={props.dataApi} label="Default user settings: users">
      <UsersPage input={props.pageInput} />
    </PageRoot>
  );
}
