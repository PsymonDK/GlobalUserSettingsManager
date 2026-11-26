import { api, callApi, queryTop, type Row } from './env';
import { JobStatus } from './settings';
import { display, ref } from './dv';

export interface Job {
  id: string;
  name: string;
  status: number;
  reason?: number;
  applyMode?: number;
  scope?: number;
  dryRun: boolean;
  processed: number;
  updated: number;
  unchanged: number;
  failed: number;
  chunks: number;
  settingFilter?: string;
  userName?: string;
  profileId?: string;
  profileName?: string;
  error?: string;
  createdOn?: string;
  startedOn?: string;
  completedOn?: string;
}

const JOB_COLUMNS = ['jhrb_rolloutjobid', 'jhrb_name', 'jhrb_status', 'jhrb_reason', 'jhrb_applymode', 'jhrb_scope', 'jhrb_dryrun', 'jhrb_processed', 'jhrb_updated',
  'jhrb_unchanged', 'jhrb_failed', 'jhrb_chunks', 'jhrb_settingfilter', '_jhrb_user_value', '_jhrb_profile_value', 'jhrb_error', 'createdon', 'jhrb_startedon', 'jhrb_completedon'];

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function toJob(r: Row): Job {
  return {
    id: String(r.jhrb_rolloutjobid),
    name: (r.jhrb_name as string) ?? '',
    status: r.jhrb_status as number,
    reason: r.jhrb_reason as number | undefined,
    applyMode: r.jhrb_applymode as number | undefined,
    scope: r.jhrb_scope as number | undefined,
    dryRun: r.jhrb_dryrun === true,
    processed: num(r.jhrb_processed),
    updated: num(r.jhrb_updated),
    unchanged: num(r.jhrb_unchanged),
    failed: num(r.jhrb_failed),
    chunks: num(r.jhrb_chunks),
    settingFilter: (r.jhrb_settingfilter as string | null) ?? undefined,
    userName: display(r, 'jhrb_user'),
    profileId: ref(r, 'jhrb_profile'),
    profileName: display(r, 'jhrb_profile'),
    error: (r.jhrb_error as string | null) ?? undefined,
    createdOn: r.createdon as string | undefined,
    startedOn: (r.jhrb_startedon as string | null) ?? undefined,
    completedOn: (r.jhrb_completedon as string | null) ?? undefined,
  };
}

export async function loadJobs(top = 50): Promise<Job[]> {
  return (await queryTop('jhrb_rolloutjob', { select: JOB_COLUMNS, orderBy: 'createdon desc' }, top)).map(toJob);
}

export async function cancelJob(id: string): Promise<void> {
  await api().updateRow('jhrb_rolloutjob', id, { jhrb_status: JobStatus.Cancelled });
}

export function isActive(j: Job): boolean {
  return j.status === JobStatus.Pending || j.status === JobStatus.Running;
}

export interface LogEntry {
  id: string;
  setting?: string;
  source?: number;
  oldValue?: string;
  attempted?: string;
  applied?: string;
  userId?: string;
  userName?: string;
  profileId?: string;
  profileName?: string;
  createdOn?: string;
}

export async function loadLog(opts: { top?: number; userId?: string; profileId?: string; source?: number; since?: Date } = {}): Promise<LogEntry[]> {
  const f: string[] = [];
  if (opts.userId) f.push(`_jhrb_user_value eq ${opts.userId}`);
  if (opts.profileId) f.push(`_jhrb_profile_value eq ${opts.profileId}`);
  if (opts.source) f.push(`jhrb_source eq ${opts.source}`);
  if (opts.since) f.push(`createdon ge ${opts.since.toISOString()}`);
  const rows = await queryTop('jhrb_settingslog', {
    select: ['jhrb_settingslogid', 'jhrb_setting', 'jhrb_source', 'jhrb_oldvalue', 'jhrb_attemptedvalue', 'jhrb_appliedvalue', '_jhrb_user_value', '_jhrb_profile_value', 'createdon'],
    filter: f.length ? f.join(' and ') : undefined,
    orderBy: 'createdon desc',
  }, opts.top ?? 100);
  return rows.map((r) => ({
    id: String(r.jhrb_settingslogid),
    setting: (r.jhrb_setting as string | null) ?? undefined,
    source: r.jhrb_source as number | undefined,
    oldValue: (r.jhrb_oldvalue as string | null) ?? undefined,
    attempted: (r.jhrb_attemptedvalue as string | null) ?? undefined,
    applied: (r.jhrb_appliedvalue as string | null) ?? undefined,
    userId: ref(r, 'jhrb_user'),
    userName: display(r, 'jhrb_user'),
    profileId: ref(r, 'jhrb_profile'),
    profileName: display(r, 'jhrb_profile'),
    createdOn: r.createdon as string | undefined,
  }));
}

// ---- Custom APIs ---------------------------------------------------------------------------------------------

export interface ApplyResult { jobId?: string; updated: number; unchanged: number; failed: number }
export type ApplyMode = 'Full' | 'LockedOnly' | 'Auto';

export async function applyDefaults(args: { scope: 'All' | 'User'; userId?: string; applyMode?: ApplyMode; dryRun?: boolean; settings?: string[] }): Promise<ApplyResult> {
  const r = await callApi('jhrb_ApplyDefaults', {
    Scope: args.scope, UserId: args.userId, Setting: args.settings?.join(','), DryRun: args.dryRun, ApplyMode: args.applyMode ?? 'Full',
  });
  const jobId = r.JobId as string | undefined;
  return {
    jobId: jobId && jobId !== '00000000-0000-0000-0000-000000000000' ? jobId : undefined,
    updated: num(r.Updated),
    unchanged: num(r.Unchanged),
    failed: num(r.Failed),
  };
}

export async function reconcile(): Promise<string | undefined> {
  const r = await callApi('jhrb_ReconcileSettings', {});
  return r.JobId as string | undefined;
}

export interface LoadResult { profileId: string; loaded: number; keptManaged: number }

export async function loadCurrentValues(args: { profileId?: string; userId?: string; overwriteManaged?: boolean }): Promise<LoadResult> {
  const r = await callApi('jhrb_LoadCurrentSettings', { ProfileId: args.profileId, UserId: args.userId, OverwriteManaged: args.overwriteManaged });
  return { profileId: String(r.ProfileId), loaded: num(r.Loaded), keptManaged: num(r.KeptManaged) };
}

export interface EffectiveSetting { setting: string; label: string; value: string; mode: 'Inherit' | 'Default' | 'Locked'; source: string; sourceId: string }
export interface Effective { settings: EffectiveSetting[]; layers: string[]; inScope: boolean }

export async function resolveEffective(userId: string): Promise<Effective> {
  const r = await callApi('jhrb_ResolveEffectiveSettings', { UserId: userId });
  return {
    settings: JSON.parse((r.Settings as string) || '[]'),
    layers: JSON.parse((r.Layers as string) || '[]'),
    inScope: r.InScope === true,
  };
}
