import { useCallback, useEffect, useState } from 'react';
import { Toolbar, ToolbarButton, ToolbarDivider, SearchBox, Link, Avatar, Button } from '@fluentui/react-components';
import { Edit20Regular, Play20Regular, ArrowClockwise20Regular, ChevronRight16Regular, Open16Regular } from '@fluentui/react-icons';
import { searchUsers, getUser, type User } from '../data/directory';
import { loadUserEffective, type UserEffective } from '../data/effective';
import { applyDefaults, loadCurrentValues, loadLog, type LogEntry } from '../data/operations';
import { findUserProfile, loadProfiles, type ProfileSummary } from '../data/profiles';
import { errorText, formatDate } from '../data/dv';
import { LOG_SOURCE_NAMES, byAttribute } from '../settings';
import { Card, Loading, NoticeBar, Status, ModeLabel, Empty, type Notice } from '../components/common';
import { navigate } from '../router';

export function UsersPage({ id }: { id?: string }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<User[]>();
  const [notice, setNotice] = useState<Notice>();

  useEffect(() => {
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
            <div role="list" style={{ maxHeight: 640, overflowY: 'auto' }}>
              {results.map((u) => (
                <a role="listitem" key={u.id} href={`#/users/${u.id}`} className="nav-item" aria-current={u.id === id ? 'page' : undefined} style={{ height: 'auto', minHeight: 48, margin: '0 8px' }}>
                  <Avatar name={u.fullName} size={28} color="colorful" aria-hidden />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.fullName}</span>
                    <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.businessUnitName ?? u.email}{u.licensed ? '' : ' · unlicensed'}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </Card>
        <div className="wide stack">
          {id ? <UserView userId={id} /> : <Card className="card-pad" label="No user selected"><Empty>Pick a user on the left.</Empty></Card>}
        </div>
      </div>
    </>
  );
}

/** Effective settings for one user. `compact` is the embedded variant on the User form. */
export function UserView({ userId, compact, appUrl }: { userId: string; compact?: boolean; appUrl?: string }) {
  const [user, setUser] = useState<User>();
  const [data, setData] = useState<UserEffective>();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setData(undefined);
    try {
      const [u, eff, ps, lg] = await Promise.all([getUser(userId), loadUserEffective(userId), loadProfiles(), loadLog({ userId, top: compact ? 5 : 10 })]);
      setUser(u); setData(eff); setProfiles(ps); setLog(lg);
    } catch (e) { setNotice({ intent: 'error', title: 'Could not load this user.', text: errorText(e) }); }
  }, [userId, compact]);
  useEffect(() => { load(); }, [load]);

  const editOverride = async () => {
    setBusy(true);
    try {
      const existing = await findUserProfile(userId);
      const profileId = existing ?? (await loadCurrentValues({ userId })).profileId;
      if (compact && appUrl) window.open(`${appUrl}#/profiles/${profileId}`, '_blank'); else navigate({ page: 'profile', id: profileId });
    } catch (e) { setNotice({ intent: 'error', title: 'Could not open the override.', text: errorText(e) }); } finally { setBusy(false); }
  };

  const applyNow = async () => {
    setBusy(true);
    try {
      const r = await applyDefaults({ scope: 'User', userId, applyMode: 'Full' });
      setNotice({ intent: r.failed ? 'warning' : 'success', text: r.failed ? 'The apply failed for this user. See the activity log and the plugin trace.' : r.updated ? 'Applied: the differing values were written and logged.' : 'Nothing to change: the user already has the effective values.' });
      await load();
    } catch (e) { setNotice({ intent: 'error', title: 'Not applied.', text: errorText(e) }); } finally { setBusy(false); }
  };

  const profileId = (name: string) => profiles.find((p) => p.name === name)?.id;
  const differs = data?.rows.filter((r) => r.differs).length ?? 0;
  const shown = compact ? data?.rows.slice(0, 6) : data?.rows;

  return (
    <>
      <Card className="commandbar" label="User commands">
        <Toolbar aria-label="User commands" style={{ flexWrap: 'wrap', padding: 0, width: '100%' }}>
          <ToolbarButton icon={<Edit20Regular />} disabled={busy} onClick={editOverride}>Edit override</ToolbarButton>
          <ToolbarButton icon={<Play20Regular />} disabled={busy || !data?.inScope} onClick={applyNow}>Apply now</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<ArrowClockwise20Regular />} onClick={load}>Refresh</ToolbarButton>
          {compact && appUrl && <><span className="grow" /><Button appearance="transparent" icon={<Open16Regular />} iconPosition="after" onClick={() => window.open(`${appUrl}#/users/${userId}`, '_blank')}>Open in Settings Manager</Button></>}
        </Toolbar>
      </Card>
      <NoticeBar notice={notice} onDismiss={() => setNotice(undefined)} />
      {!data || !user ? (notice ? null : <Loading />) : (
        <>
          <Card label="User">
            <div className="stack" style={{ padding: '16px 20px' }}>
              <div className="row-flex">
                <Avatar name={user.fullName} size={40} color="colorful" aria-hidden />
                <div className="grow">
                  <h2 className="page-title" style={compact ? { fontSize: 20, lineHeight: '28px' } : undefined}>{user.fullName}</h2>
                  <div className="muted">{[user.title, user.businessUnitName && `Business unit ${user.businessUnitName}`, user.licensed ? undefined : 'Unlicensed'].filter(Boolean).join(' · ')}</div>
                </div>
                {data.inScope ? <span className="badge" style={{ color: 'var(--colorPaletteGreenForeground1)', fontWeight: 600 }}>In scope</span>
                  : <span className="badge">Not in scope</span>}
              </div>
              <div>
                <div className="small muted" style={{ fontWeight: 600, marginBottom: 8 }}>Layers that apply, highest first</div>
                <ol className="layers" aria-label="Layers">
                  {data.layers.map((name, i) => {
                    const pid = profileId(name);
                    return (
                      <li key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {pid ? <a className="layer" href={`#/profiles/${pid}`}><span style={{ fontWeight: 600 }}>{name}</span></a> : <span className="layer"><span style={{ fontWeight: 600 }}>{name}</span></span>}
                        {i < data.layers.length - 1 && <ChevronRight16Regular aria-hidden />}
                      </li>
                    );
                  })}
                  {data.layers.length === 0 && <li className="muted">No layer applies</li>}
                </ol>
              </div>
            </div>
          </Card>

          {!data.inScope && <NoticeBar notice={{ intent: 'info', text: 'This user is outside the scope (not in the pilot team, or the Global profile is inactive), so nothing is applied or enforced for them.' }} />}
          {data.inScope && differs > 0 && <NoticeBar notice={{ intent: 'warning', title: `${differs} setting${differs === 1 ? ' differs' : 's differ'} from the effective value.`, text: 'Locked settings change at the next rollout or reconcile (daily), or now with Apply now. A Default setting that differs may simply be the user\'s own choice.' }} />}
          {!data.hasSettingsRow && <NoticeBar notice={{ intent: 'info', text: 'This user has no personal settings row yet. It is created at first sign-in; defaults are applied then.' }} />}

          <Card label="Effective settings">
            <div className="card-head">
              <h2 className="card-title">Effective settings</h2>
              <span className="small muted">Managed settings only ({data.rows.length}). The rest stay as the user set them.</span>
            </div>
            {data.rows.length === 0 ? <Empty>No setting is managed for this user.</Empty> : (
              <div className="scroll-x">
                <table className="grid-table" style={{ minWidth: compact ? 720 : 900 }}>
                  <thead><tr><th scope="col">Setting</th><th scope="col">Effective value</th><th scope="col">Mode</th><th scope="col">From</th><th scope="col">User has now</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {shown!.map((r) => (
                      <tr key={r.def.attribute} className={r.differs && r.effective.mode === 'Locked' ? 'changed' : undefined}>
                        <td className="primary">{r.def.label}</td>
                        <td>{r.effectiveText}</td>
                        <td><ModeLabel mode={r.effective.mode} /></td>
                        <td>{profileId(r.effective.source) ? <Link href={`#/profiles/${profileId(r.effective.source)}`}>{r.effective.source}</Link> : r.effective.source}</td>
                        <td>{r.currentText}</td>
                        <td>{!r.differs ? <Status tone="success">Matches</Status>
                          : r.effective.mode === 'Locked' ? <Status tone="warning">Differs</Status>
                          : <span className="muted">Differs (user's own choice?)</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {compact && data.rows.length > (shown?.length ?? 0) && <div className="grid-footer"><span>Showing {shown?.length} of {data.rows.length}</span></div>}
          </Card>

          <Card label="Recent changes">
            <div className="card-head"><h2 className="card-title">Recent changes</h2></div>
            {log.length === 0 ? <Empty>No change logged for this user</Empty> : (
              <table className="grid-table"><tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td style={{ width: 150 }} className="muted">{formatDate(l.createdOn)}</td>
                    <td style={{ width: 100 }}>{LOG_SOURCE_NAMES[l.source ?? 0] ?? ''}</td>
                    <td>{byAttribute.get(l.setting ?? '')?.label ?? l.setting}: {l.source === 632490002 ? `${l.attempted ?? ''} reverted to ${l.applied ?? ''}` : `${l.oldValue ?? '(empty)'} → ${l.applied ?? ''}`}</td>
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
