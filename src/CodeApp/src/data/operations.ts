import { Jhrb_rolloutjobsService } from '../generated/services/Jhrb_rolloutjobsService';
import { Jhrb_settingslogsService } from '../generated/services/Jhrb_settingslogsService';
import { Jhrb_ApplyDefaultsService } from '../generated/services/Jhrb_ApplyDefaultsService';
import { Jhrb_ReconcileSettingsService } from '../generated/services/Jhrb_ReconcileSettingsService';
import { Jhrb_LoadCurrentSettingsService } from '../generated/services/Jhrb_LoadCurrentSettingsService';
import { Jhrb_ResolveEffectiveSettingsService } from '../generated/services/Jhrb_ResolveEffectiveSettingsService';
import { JobStatus } from '../settings';
import { display, ref, unwrap } from './dv';

type Row = Record<string, unknown>;

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

function toJob(r: Row): Job {
  return {
    id: r.jhrb_rolloutjobid as string,
    name: (r.jhrb_name as string) ?? '',
    status: r.jhrb_status as number,
    reason: r.jhrb_reason as number | undefined,
    applyMode: r.jhrb_applymode as number | undefined,
    scope: r.jhrb_scope as number | undefined,
    dryRun: r.jhrb_dryrun === true,
    processed: (r.jhrb_processed as number) ?? 0,
    updated: (r.jhrb_updated as number) ?? 0,
    unchanged: (r.jhrb_unchanged as number) ?? 0,
    failed: (r.jhrb_failed as number) ?? 0,
    chunks: (r.jhrb_chunks as number) ?? 0,
    settingFilter: r.jhrb_settingfilter as string | undefined,
    userName: display(r, 'jhrb_user'),
    profileId: ref(r, 'jhrb_profile'),
    profileName: display(r, 'jhrb_profile'),
    error: r.jhrb_error as string | undefined,
    createdOn: r.createdon as string | undefined,
    startedOn: r.jhrb_startedon as string | undefined,
    completedOn: r.jhrb_completedon as string | undefined,
  };
}

export async function loadJobs(top = 50, filter?: string): Promise<Job[]> {
  const rows = await unwrap(Jhrb_rolloutjobsService.getAll({ select: JOB_COLUMNS, orderBy: ['createdon desc'], top, filter }));
  return (rows as unknown as Row[]).map(toJob);
}

export async function cancelJob(id: string): Promise<void> {
  await unwrap(Jhrb_rolloutjobsService.update(id, { jhrb_status: JobStatus.Cancelled } as never));
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
  const rows = await unwrap(Jhrb_settingslogsService.getAll({
    select: ['jhrb_settingslogid', 'jhrb_setting', 'jhrb_source', 'jhrb_oldvalue', 'jhrb_attemptedvalue', 'jhrb_appliedvalue', '_jhrb_user_value', '_jhrb_profile_value', 'createdon'],
    filter: f.length ? f.join(' and ') : undefined,
    orderBy: ['createdon desc'],
    top: opts.top ?? 100,
  }));
  return (rows as unknown as Row[]).map((r) => ({
    id: r.jhrb_settingslogid as string,
    setting: r.jhrb_setting as string | undefined,
    source: r.jhrb_source as number | undefined,
    oldValue: r.jhrb_oldvalue as string | undefined,
    attempted: r.jhrb_attemptedvalue as string | undefined,
    applied: r.jhrb_appliedvalue as string | undefined,
    userId: ref(r, 'jhrb_user'),
    userName: display(r, 'jhrb_user'),
    profileId: ref(r, 'jhrb_profile'),
    profileName: display(r, 'jhrb_profile'),
    createdOn: r.createdon as string | undefined,
  }));
}

// ---- Custom APIs -------------------------------------------------------------

export interface ApplyResult { jobId?: string; updated: number; unchanged: number; failed: number }

export async function applyDefaults(args: { scope: 'All' | 'User'; userId?: string; applyMode?: 'Full' | 'LockedOnly' | 'Auto'; dryRun?: boolean; settings?: string[] }): Promise<ApplyResult> {
  const r = await unwrap(Jhrb_ApplyDefaultsService.jhrb_ApplyDefaults(args.scope, args.userId, args.settings?.join(','), args.dryRun, args.applyMode ?? 'Full'));
  const jobId = r.JobId as string | undefined;
  return {
    jobId: jobId && jobId !== '00000000-0000-0000-0000-000000000000' ? jobId : undefined,
    updated: (r.Updated as number) ?? 0,
    unchanged: (r.Unchanged as number) ?? 0,
    failed: (r.Failed as number) ?? 0,
  };
}

export async function reconcile(): Promise<string | undefined> {
  const r = await unwrap(Jhrb_ReconcileSettingsService.jhrb_ReconcileSettings());
  return r.JobId as string | undefined;
}

export interface LoadResult { profileId: string; loaded: number; keptManaged: number }

export async function loadCurrentValues(args: { profileId?: string; userId?: string; overwriteManaged?: boolean }): Promise<LoadResult> {
  const r = await unwrap(Jhrb_LoadCurrentSettingsService.jhrb_LoadCurrentSettings(args.profileId, args.userId, undefined, args.overwriteManaged));
  return { profileId: r.ProfileId as string, loaded: (r.Loaded as number) ?? 0, keptManaged: (r.KeptManaged as number) ?? 0 };
}

export interface EffectiveSetting { setting: string; label: string; value: string; mode: 'Inherit' | 'Default' | 'Locked'; source: string; sourceId: string }
export interface Effective { settings: EffectiveSetting[]; layers: string[]; inScope: boolean }

export async function resolveEffective(userId: string): Promise<Effective> {
  const r = await unwrap(Jhrb_ResolveEffectiveSettingsService.jhrb_ResolveEffectiveSettings(userId));
  return {
    settings: JSON.parse((r.Settings as string) || '[]'),
    layers: JSON.parse((r.Layers as string) || '[]'),
    inScope: r.InScope === true,
  };
}
