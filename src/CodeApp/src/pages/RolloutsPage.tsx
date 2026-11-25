import { useCallback, useEffect, useState } from 'react';
import { Toolbar, ToolbarButton, ToolbarDivider, ProgressBar, Link, Dropdown, Option } from '@fluentui/react-components';
import { Play20Regular, ArrowSync20Regular, ArrowClockwise20Regular, Stop20Regular } from '@fluentui/react-icons';
import { loadJobs, cancelJob, isActive, reconcile, loadLog, type Job, type LogEntry } from '../data/operations';
import { errorText, formatDate } from '../data/dv';
import { APPLY_MODE_NAMES, JOB_REASON_NAMES, JobStatus, LOG_SOURCE_NAMES, byAttribute } from '../settings';
import { Card, Loading, NoticeBar, JobStatusLabel, Empty, type Notice } from '../components/common';
import { RolloutDialog } from '../components/RolloutDialog';

export function RolloutsPage() {
  const [jobs, setJobs] = useState<Job[]>();
  const [selected, setSelected] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [rolloutOpen, setRolloutOpen] = useState(false);

  const load = useCallback(async () => {
    try { setJobs(await loadJobs(50)); } catch (e) { setNotice({ intent: 'error', title: 'Could not load jobs.', text: errorText(e) }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Poll while a job runs. Old rows stay on screen until the new ones arrive.
  const anyActive = jobs?.some(isActive) ?? false;
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [anyActive, load]);

  const job = jobs?.find((j) => j.id === selected) ?? jobs?.[0];

  return (
    <>
      <Card className="commandbar" label="Rollout commands">
        <Toolbar aria-label="Rollout commands" style={{ flexWrap: 'wrap', padding: 0, width: '100%' }}>
          <ToolbarButton icon={<Play20Regular />} onClick={() => setRolloutOpen(true)}>Roll out now</ToolbarButton>
          <ToolbarButton icon={<ArrowSync20Regular />} onClick={async () => {
            try { await reconcile(); setNotice({ intent: 'success', text: 'Reconcile queued.' }); await load(); } catch (e) { setNotice({ intent: 'error', title: 'Reconcile failed.', text: errorText(e) }); }
          }}>Reconcile</ToolbarButton>
          <ToolbarButton icon={<Stop20Regular />} disabled={!job || !isActive(job)} onClick={async () => {
            if (!job) return;
            try { await cancelJob(job.id); setNotice({ intent: 'success', text: 'Job cancelled. It stops after the chunk in progress.' }); await load(); } catch (e) { setNotice({ intent: 'error', title: 'Not cancelled.', text: errorText(e) }); }
          }}>Cancel job</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<ArrowClockwise20Regular />} onClick={load}>Refresh</ToolbarButton>
          <span className="grow" />
          {anyActive && <span className="small muted">Updates every 10 seconds while a job runs</span>}
        </Toolbar>
      </Card>
      <NoticeBar notice={notice} onDismiss={() => setNotice(undefined)} />
      <h1 className="page-title">Rollouts</h1>

      {!jobs ? <Loading /> : (
        <div className="split">
          <Card className="wide" label="Rollout jobs">
            {jobs.length === 0 ? <Empty>No rollouts yet</Empty> : (
              <div className="scroll-x">
                <table className="grid-table" style={{ minWidth: 860 }}>
                  <thead><tr>
                    <th scope="col">Job</th><th scope="col">Reason</th><th scope="col">Mode</th><th scope="col">Status</th><th scope="col" style={{ width: 180 }}>Progress</th>
                    <th scope="col" className="num">Updated</th><th scope="col" className="num">Failed</th><th scope="col">Created</th>
                  </tr></thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id} className={j.id === job?.id ? 'selected' : undefined} aria-selected={j.id === job?.id}>
                        <td className="primary"><Link onClick={() => setSelected(j.id)}>{j.name}</Link>{j.dryRun && <span className="badge" style={{ marginLeft: 8 }}>Dry run</span>}</td>
                        <td>{JOB_REASON_NAMES[j.reason ?? 0] ?? ''}</td>
                        <td>{APPLY_MODE_NAMES[j.applyMode ?? 0] ?? ''}</td>
                        <td><JobStatusLabel status={j.status} failed={j.failed} /></td>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ProgressBar aria-label="Progress" value={j.status === JobStatus.Completed ? 1 : j.status === JobStatus.Running ? undefined : 0}
                            color={j.status === JobStatus.Completed ? (j.failed ? 'warning' : 'success') : 'brand'} style={{ flexGrow: 1 }} />
                          <span style={{ width: 40, textAlign: 'right' }}>{j.processed}</span>
                        </div></td>
                        <td className="num">{j.dryRun ? `(${j.updated})` : j.updated}</td>
                        <td className="num" style={j.failed ? { color: 'var(--colorPaletteRedForeground1)', fontWeight: 600 } : undefined}>{j.failed}</td>
                        <td>{formatDate(j.createdOn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid-footer"><span>Rows: {jobs.length}{jobs.length === 50 ? ' (latest 50)' : ''}</span></div>
          </Card>

          {job && (
            <Card className="side card-pad" label="Job details">
              <div className="stack" style={{ gap: 12 }}>
                <h2 className="card-title">{job.name}</h2>
                <JobStatusLabel status={job.status} failed={job.failed} />
                <dl className="dl">
                  <div><dt>Processed</dt><dd>{job.processed}</dd></div>
                  <div><dt>{job.dryRun ? 'Would update' : 'Updated'}</dt><dd>{job.updated}</dd></div>
                  <div><dt>Unchanged</dt><dd>{job.unchanged}</dd></div>
                  <div><dt>Failed</dt><dd>{job.failed}</dd></div>
                  <div><dt>Chunks</dt><dd>{job.chunks}</dd></div>
                  <div><dt>Mode</dt><dd>{APPLY_MODE_NAMES[job.applyMode ?? 0] ?? ''}</dd></div>
                  <div><dt>Started</dt><dd style={{ fontWeight: 400 }}>{formatDate(job.startedOn) || 'Not yet'}</dd></div>
                  <div><dt>Completed</dt><dd style={{ fontWeight: 400 }}>{formatDate(job.completedOn) || '—'}</dd></div>
                </dl>
                <div className="small"><span className="muted">Settings: </span>{job.settingFilter ? job.settingFilter.split(',').map((s) => byAttribute.get(s.trim())?.label ?? s).join(', ') : 'All managed settings'}</div>
                {job.userName && <div className="small"><span className="muted">User: </span>{job.userName}</div>}
                {job.profileId && <div className="small"><span className="muted">Profile: </span><Link href={`#/profiles/${job.profileId}`}>{job.profileName ?? 'Open'}</Link></div>}
                {job.error && <div className="small status danger" style={{ whiteSpace: 'pre-wrap' }}>{job.error}</div>}
                {job.status === JobStatus.Pending && job.chunks > 0 && <div className="small muted">Paused at the platform depth limit. The daily heartbeat or Reconcile resumes it.</div>}
              </div>
            </Card>
          )}
        </div>
      )}

      <RolloutDialog open={rolloutOpen} onClose={() => setRolloutOpen(false)}
        onQueued={(_, dry) => { setNotice({ intent: 'success', text: dry ? 'Dry run queued.' : 'Rollout queued.' }); load(); }} />
    </>
  );
}

const SOURCES = [{ value: 0, label: 'All sources' }, ...Object.entries(LOG_SOURCE_NAMES).map(([v, l]) => ({ value: Number(v), label: l }))];

export function LogPage() {
  const [rows, setRows] = useState<LogEntry[]>();
  const [source, setSource] = useState(0);
  const [notice, setNotice] = useState<Notice>();

  const load = useCallback(async () => {
    setRows(undefined);
    try { setRows(await loadLog({ top: 200, source: source || undefined })); } catch (e) { setNotice({ intent: 'error', title: 'Could not load the log.', text: errorText(e) }); }
  }, [source]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Card className="commandbar" label="Log commands">
        <Toolbar aria-label="Log commands" style={{ flexWrap: 'wrap', padding: 0, width: '100%' }}>
          <ToolbarButton icon={<ArrowClockwise20Regular />} onClick={load}>Refresh</ToolbarButton>
          <span className="grow" />
          <Dropdown aria-label="Source" appearance="filled-darker" value={SOURCES.find((s) => s.value === source)?.label} selectedOptions={[String(source)]}
            onOptionSelect={(_, d) => setSource(Number(d.optionValue))} style={{ minWidth: 160 }}>
            {SOURCES.map((s) => <Option key={s.value} value={String(s.value)}>{s.label}</Option>)}
          </Dropdown>
        </Toolbar>
      </Card>
      <NoticeBar notice={notice} onDismiss={() => setNotice(undefined)} />
      <div className="row-flex" style={{ alignItems: 'baseline' }}>
        <h1 className="page-title">Activity log</h1>
        <span className="muted">Every rollout write, revert and captured admin edit. Rows are kept for 90 days.</span>
      </div>
      <Card label="Activity log">
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nothing logged</Empty> : (
          <div className="scroll-x">
            <table className="grid-table" style={{ minWidth: 900 }}>
              <thead><tr><th scope="col">When</th><th scope="col">User</th><th scope="col">Source</th><th scope="col">Setting</th><th scope="col">Old</th><th scope="col">Attempted</th><th scope="col">Applied</th><th scope="col">Profile</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.createdOn)}</td>
                    <td className="primary">{r.userId ? <Link href={`#/users/${r.userId}`}>{r.userName ?? 'User'}</Link> : ''}</td>
                    <td>{LOG_SOURCE_NAMES[r.source ?? 0] ?? ''}</td>
                    <td>{byAttribute.get(r.setting ?? '')?.label ?? r.setting}</td>
                    <td>{r.oldValue}</td>
                    <td>{r.attempted}</td>
                    <td>{r.applied}</td>
                    <td>{r.profileId ? <Link href={`#/profiles/${r.profileId}`}>{r.profileName ?? 'Profile'}</Link> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && <div className="grid-footer"><span>Rows: {rows.length}{rows.length === 200 ? ' (latest 200)' : ''}</span></div>}
      </Card>
    </>
  );
}
