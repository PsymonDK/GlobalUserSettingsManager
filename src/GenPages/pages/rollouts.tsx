// Page "Rollouts": rollout jobs with progress, refreshed every 10 seconds while a job runs.
import * as React from 'react';
import { Toolbar, ToolbarButton, ToolbarDivider, ProgressBar, Link } from '@fluentui/react-components';
import { PlayRegular, ArrowSyncRegular, ArrowClockwiseRegular, StopRegular } from '@fluentui/react-icons';
import { openPage, type PageProps } from '../shared/env';
import { loadJobs, cancelJob, isActive, reconcile, type Job } from '../shared/operations';
import { errorText, formatDate } from '../shared/dv';
import { APPLY_MODE_NAMES, JOB_REASON_NAMES, JobStatus, settingLabel } from '../shared/settings';
import { PageRoot, Card, Loading, NoticeBar, JobStatusLabel, Empty, RolloutDialog, shared, forget, type Notice } from '../shared/ui';

function RolloutsPage() {
  const [jobs, setJobs] = React.useState<Job[]>();
  const [selected, setSelected] = React.useState<string>();
  const [notice, setNotice] = React.useState<Notice>();
  const [rolloutOpen, setRolloutOpen] = React.useState(false);

  const load = React.useCallback(async (fresh?: boolean) => {
    if (fresh) forget('jobs');
    try { setJobs(await shared('jobs', () => loadJobs(50))); }
    catch (e) { setNotice({ intent: 'error', title: 'Could not load jobs.', text: errorText(e) }); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  // Poll while a job runs. Old rows stay on screen until the new ones arrive.
  const anyActive = jobs?.some(isActive) ?? false;
  React.useEffect(() => {
    if (!anyActive) return undefined;
    const t = setInterval(() => load(true), 10000);
    return () => clearInterval(t);
  }, [anyActive, load]);

  const job = jobs?.find((j) => j.id === selected) ?? jobs?.[0];

  return (
    <>
      <Card className="commandbar" label="Rollout commands">
        <Toolbar aria-label="Rollout commands" style={{ flexWrap: 'wrap', padding: 0, width: '100%' }}>
          <ToolbarButton icon={<PlayRegular />} onClick={() => setRolloutOpen(true)}>Roll out now</ToolbarButton>
          <ToolbarButton icon={<ArrowSyncRegular />} onClick={async () => {
            try { await reconcile(); setNotice({ intent: 'success', text: 'Reconcile queued.' }); await load(true); } catch (e) { setNotice({ intent: 'error', title: 'Reconcile failed.', text: errorText(e) }); }
          }}>Reconcile</ToolbarButton>
          <ToolbarButton icon={<StopRegular />} disabled={!job || !isActive(job)} onClick={async () => {
            if (!job) return;
            try { await cancelJob(job.id); setNotice({ intent: 'success', text: 'Job cancelled. It stops after the chunk in progress.' }); await load(true); } catch (e) { setNotice({ intent: 'error', title: 'Not cancelled.', text: errorText(e) }); }
          }}>Cancel job</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton icon={<ArrowClockwiseRegular />} onClick={() => load(true)}>Refresh</ToolbarButton>
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
                <div className="small"><span className="muted">Settings: </span>{job.settingFilter ? job.settingFilter.split(',').map((s) => settingLabel(s.trim())).join(', ') : 'All managed settings'}</div>
                {job.userName && <div className="small"><span className="muted">User: </span>{job.userName}</div>}
                {job.profileId && (
                  <div className="small"><span className="muted">Profile: </span>
                    <Link onClick={() => { openPage('profiles', { profileId: job.profileId ?? '' }).catch((e) => setNotice({ intent: 'error', text: errorText(e) })); }}>{job.profileName ?? 'Open'}</Link>
                  </div>
                )}
                {job.error && <div className="small status danger" style={{ whiteSpace: 'pre-wrap' }}>{job.error}</div>}
                {job.status === JobStatus.Pending && job.chunks > 0 && <div className="small muted">Paused at the platform depth limit. The daily heartbeat or Reconcile resumes it.</div>}
              </div>
            </Card>
          )}
        </div>
      )}

      <RolloutDialog open={rolloutOpen} onClose={() => setRolloutOpen(false)}
        onQueued={(_, dry) => { setNotice({ intent: 'success', text: dry ? 'Dry run queued.' : 'Rollout queued.' }); load(true); }} />
    </>
  );
}

export default function Page(props: PageProps) {
  return (
    <PageRoot dataApi={props.dataApi} label="Default user settings: rollouts">
      <RolloutsPage />
    </PageRoot>
  );
}
