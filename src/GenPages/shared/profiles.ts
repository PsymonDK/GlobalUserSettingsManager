import { api, queryAll, queryTop, type Row } from './env';
import { SETTINGS, Mode, ProfileType, ScopeType, type SettingDefinition } from './settings';
import { display, errorText, link, ref } from './dv';

export interface ProfileSummary {
  id: string;
  name: string;
  type: number;
  priority?: number;
  active: boolean;
  userId?: string;
  userName?: string;
  pilotTeamId?: string;
  pilotTeamName?: string;
  modifiedOn?: string;
  defaults: number;
  locked: number;
}

export interface ProfileDetail extends ProfileSummary {
  row: Row;
}

const PROFILE_TABLE = 'jhrb_settingsprofile';
const PROFILE_BASE = ['jhrb_settingsprofileid', 'jhrb_name', 'jhrb_type', 'jhrb_priority', 'jhrb_isactive', '_jhrb_user_value', '_jhrb_pilotteam_value', 'modifiedon'];
const MODE_COLUMNS = SETTINGS.map((s) => s.modeColumn);
/** Value columns as the Web API names them (lookups read through _x_value). */
const VALUE_COLUMNS = SETTINGS.map((s) => (s.kind === 'Lookup' ? `_${s.valueColumn}_value` : s.valueColumn));

function summarize(r: Row): ProfileSummary {
  let defaults = 0;
  let locked = 0;
  for (const c of MODE_COLUMNS) {
    if (r[c] === Mode.Default) defaults++;
    else if (r[c] === Mode.Locked) locked++;
  }
  return {
    id: String(r.jhrb_settingsprofileid),
    name: (r.jhrb_name as string) ?? '',
    type: r.jhrb_type as number,
    priority: (r.jhrb_priority as number | null) ?? undefined,
    active: r.jhrb_isactive !== false,
    userId: ref(r, 'jhrb_user'),
    userName: display(r, 'jhrb_user'),
    pilotTeamId: ref(r, 'jhrb_pilotteam'),
    pilotTeamName: display(r, 'jhrb_pilotteam'),
    modifiedOn: r.modifiedon as string | undefined,
    defaults,
    locked,
  };
}

/** Precedence order used by the resolver: User > Group (priority desc) > Global. */
export function byPrecedence(a: ProfileSummary, b: ProfileSummary): number {
  const rank = (p: ProfileSummary) => (p.type === ProfileType.User ? 0 : p.type === ProfileType.Group ? 1 : 2);
  return rank(a) - rank(b) || (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name);
}

export async function loadProfiles(): Promise<ProfileSummary[]> {
  const rows = await queryAll(PROFILE_TABLE, { select: PROFILE_BASE.concat(MODE_COLUMNS), filter: 'statecode eq 0' });
  return rows.map(summarize).sort(byPrecedence);
}

export async function loadProfile(id: string): Promise<ProfileDetail> {
  const r = await api().retrieveRow(PROFILE_TABLE, { id, select: PROFILE_BASE.concat(MODE_COLUMNS, VALUE_COLUMNS) });
  return { ...summarize(r), row: r };
}

export async function findGlobal(): Promise<ProfileDetail | undefined> {
  const rows = await queryTop(PROFILE_TABLE, { select: ['jhrb_settingsprofileid'], filter: `jhrb_type eq ${ProfileType.Global} and statecode eq 0` }, 1);
  const id = rows[0]?.jhrb_settingsprofileid as string | undefined;
  return id ? loadProfile(id) : undefined;
}

export async function findUserProfile(userId: string): Promise<string | undefined> {
  const rows = await queryTop(PROFILE_TABLE, { select: ['jhrb_settingsprofileid'], filter: `jhrb_type eq ${ProfileType.User} and _jhrb_user_value eq ${userId}` }, 1);
  return rows[0]?.jhrb_settingsprofileid as string | undefined;
}

/** Value of a setting as stored on the profile row (lookups as their bare id). */
export function readValue(row: Row, def: SettingDefinition): unknown {
  return def.kind === 'Lookup' ? ref(row, def.valueColumn) ?? null : row[def.valueColumn];
}

export function readMode(row: Row, def: SettingDefinition): number {
  return (row[def.modeColumn] as number | undefined) ?? Mode.Inherit;
}

/** Profile columns to write for a value change. Lookups are written as `_<column>_value: "/<table>(<id>)"`. */
export function valuePatch(def: SettingDefinition, value: unknown): Row {
  if (def.kind === 'Lookup') return { [`_${def.valueColumn}_value`]: link(def.target ?? 'transactioncurrency', value ? String(value) : null) };
  return { [def.valueColumn]: value === '' ? null : value };
}

export function pilotTeamPatch(teamId: string | undefined): Row {
  return { _jhrb_pilotteam_value: link('team', teamId) };
}

export async function updateProfile(id: string, changes: Row): Promise<void> {
  await api().updateRow(PROFILE_TABLE, id, changes);
}

export async function createGroupProfile(name: string, priority: number): Promise<string> {
  return api().createRow(PROFILE_TABLE, { jhrb_name: name, jhrb_type: ProfileType.Group, jhrb_priority: priority, jhrb_isactive: true });
}

/**
 * The profile change plugin runs asynchronously and queues a rollout job that references the profile. A delete that
 * overlaps that insert fails with a SQL REFERENCE constraint on jhrb_rolloutjob, so wait and retry a few times.
 */
const JOB_REFERENCE_CONFLICT = /REFERENCE constraint[\s\S]*jhrb_rolloutjob/i;

export async function deleteProfile(id: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await api().deleteRow(PROFILE_TABLE, id);
      return;
    } catch (e) {
      if (!JOB_REFERENCE_CONFLICT.test(errorText(e))) throw e;
      if (attempt >= 5) throw new Error('Rollout jobs for this profile are still being queued. Wait a few seconds and delete it again.');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export interface Scope {
  id: string;
  profileId: string;
  type: number;
  teamId?: string;
  teamName?: string;
  businessUnitId?: string;
  businessUnitName?: string;
  includeChildren: boolean;
}

export async function loadScopes(profileId?: string): Promise<Scope[]> {
  const rows = await queryAll('jhrb_profilescope', {
    select: ['jhrb_profilescopeid', 'jhrb_scopetype', '_jhrb_team_value', '_jhrb_businessunit_value', '_jhrb_profile_value', 'jhrb_includechildbu'],
    filter: profileId ? `_jhrb_profile_value eq ${profileId} and statecode eq 0` : 'statecode eq 0',
  });
  return rows.map((r) => ({
    id: String(r.jhrb_profilescopeid),
    profileId: ref(r, 'jhrb_profile') ?? '',
    type: r.jhrb_scopetype as number,
    teamId: ref(r, 'jhrb_team'),
    teamName: display(r, 'jhrb_team'),
    businessUnitId: ref(r, 'jhrb_businessunit'),
    businessUnitName: display(r, 'jhrb_businessunit'),
    includeChildren: r.jhrb_includechildbu === true,
  }));
}

export async function addScope(profileId: string, scope: { teamId?: string; businessUnitId?: string; includeChildren?: boolean; name: string }): Promise<void> {
  const row: Row = { jhrb_name: scope.name, _jhrb_profile_value: link('jhrb_settingsprofile', profileId), jhrb_includechildbu: !!scope.includeChildren };
  if (scope.teamId) { row.jhrb_scopetype = ScopeType.Team; row._jhrb_team_value = link('team', scope.teamId); }
  else { row.jhrb_scopetype = ScopeType.BusinessUnit; row._jhrb_businessunit_value = link('businessunit', scope.businessUnitId); }
  await api().createRow('jhrb_profilescope', row);
}

export async function removeScope(id: string): Promise<void> {
  await api().deleteRow('jhrb_profilescope', id);
}

export function describeScopes(scopes: Scope[]): string {
  if (scopes.length === 0) return 'No scopes yet';
  return scopes.map((s) => (s.teamId ? `Team ${s.teamName ?? ''}` : `BU ${s.businessUnitName ?? ''}${s.includeChildren ? ' + child BUs' : ''}`)).join('; ');
}
