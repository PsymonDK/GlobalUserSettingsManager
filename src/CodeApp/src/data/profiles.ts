import { Jhrb_settingsprofilesService } from '../generated/services/Jhrb_settingsprofilesService';
import { Jhrb_profilescopesService } from '../generated/services/Jhrb_profilescopesService';
import { SETTINGS, Mode, ProfileType, type SettingDefinition } from '../settings';
import { display, ref, unwrap } from './dv';

type Row = Record<string, unknown>;

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

const BASE = ['jhrb_settingsprofileid', 'jhrb_name', 'jhrb_type', 'jhrb_priority', 'jhrb_isactive', '_jhrb_user_value', '_jhrb_pilotteam_value', 'modifiedon'];
const MODE_COLUMNS = SETTINGS.map((s) => s.modeColumn);
/** Value columns as the Web API names them (lookups read through _x_value). */
const VALUE_COLUMNS = SETTINGS.map((s) => (s.kind === 'Lookup' ? `_${s.valueColumn}_value` : s.valueColumn));

function summarize(r: Row): ProfileSummary {
  let defaults = 0, locked = 0;
  for (const c of MODE_COLUMNS) {
    if (r[c] === Mode.Default) defaults++;
    else if (r[c] === Mode.Locked) locked++;
  }
  return {
    id: r.jhrb_settingsprofileid as string,
    name: (r.jhrb_name as string) ?? '',
    type: r.jhrb_type as number,
    priority: (r.jhrb_priority as number | undefined) ?? undefined,
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
  const rows = await unwrap(Jhrb_settingsprofilesService.getAll({ select: [...BASE, ...MODE_COLUMNS], filter: 'statecode eq 0' }));
  return (rows as unknown as Row[]).map(summarize).sort(byPrecedence);
}

export async function loadProfile(id: string): Promise<ProfileDetail> {
  const r = (await unwrap(Jhrb_settingsprofilesService.get(id, { select: [...BASE, ...MODE_COLUMNS, ...VALUE_COLUMNS] }))) as unknown as Row;
  return { ...summarize(r), row: r };
}

export async function findGlobal(): Promise<ProfileDetail | undefined> {
  const rows = await unwrap(Jhrb_settingsprofilesService.getAll({ select: ['jhrb_settingsprofileid'], filter: `jhrb_type eq ${ProfileType.Global} and statecode eq 0`, top: 1 }));
  const id = (rows as unknown as Row[])[0]?.jhrb_settingsprofileid as string | undefined;
  return id ? loadProfile(id) : undefined;
}

export async function findUserProfile(userId: string): Promise<string | undefined> {
  const rows = await unwrap(Jhrb_settingsprofilesService.getAll({ select: ['jhrb_settingsprofileid'], filter: `jhrb_type eq ${ProfileType.User} and _jhrb_user_value eq ${userId}`, top: 1 }));
  return (rows as unknown as Row[])[0]?.jhrb_settingsprofileid as string | undefined;
}

/** Value of a setting as stored on the profile row (lookups as their id). */
export function readValue(row: Row, def: SettingDefinition): unknown {
  return def.kind === 'Lookup' ? row[`_${def.valueColumn}_value`] : row[def.valueColumn];
}

export function readMode(row: Row, def: SettingDefinition): number {
  return (row[def.modeColumn] as number | undefined) ?? Mode.Inherit;
}

/** Profile columns to PATCH for a value change. Lookups are written through @odata.bind. */
export function valuePatch(def: SettingDefinition, value: unknown): Row {
  if (def.kind === 'Lookup') {
    return value ? { [`${def.valueColumn}@odata.bind`]: `/${entitySet(def.target)}(${value})` } : { [def.valueColumn]: null };
  }
  return { [def.valueColumn]: value === '' ? null : value };
}

function entitySet(logicalName: string | undefined): string {
  const name = logicalName ?? 'transactioncurrency';
  if (name.endsWith('y')) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

export async function updateProfile(id: string, changes: Row): Promise<void> {
  await unwrap(Jhrb_settingsprofilesService.update(id, changes as never));
}

export async function createGroupProfile(name: string, priority: number): Promise<string> {
  const created = await unwrap(Jhrb_settingsprofilesService.create({ jhrb_name: name, jhrb_type: ProfileType.Group, jhrb_priority: priority, jhrb_isactive: true } as never));
  return (created as unknown as Row).jhrb_settingsprofileid as string;
}

export async function deleteProfile(id: string): Promise<void> {
  await unwrap(Jhrb_settingsprofilesService.delete(id));
}

export interface Scope {
  id: string;
  type: number;
  teamId?: string;
  teamName?: string;
  businessUnitId?: string;
  businessUnitName?: string;
  includeChildren: boolean;
}

export async function loadScopes(profileId?: string): Promise<(Scope & { profileId: string })[]> {
  const rows = await unwrap(Jhrb_profilescopesService.getAll({
    select: ['jhrb_profilescopeid', 'jhrb_scopetype', '_jhrb_team_value', '_jhrb_businessunit_value', '_jhrb_profile_value', 'jhrb_includechildbu'],
    filter: profileId ? `_jhrb_profile_value eq ${profileId} and statecode eq 0` : 'statecode eq 0',
  }));
  return (rows as unknown as Row[]).map((r) => ({
    id: r.jhrb_profilescopeid as string,
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
  const record: Row = {
    jhrb_name: scope.name,
    'jhrb_Profile@odata.bind': `/jhrb_settingsprofiles(${profileId})`,
    jhrb_includechildbu: !!scope.includeChildren,
  };
  if (scope.teamId) { record.jhrb_scopetype = 632490000; record['jhrb_Team@odata.bind'] = `/teams(${scope.teamId})`; }
  else { record.jhrb_scopetype = 632490001; record['jhrb_BusinessUnit@odata.bind'] = `/businessunits(${scope.businessUnitId})`; }
  await unwrap(Jhrb_profilescopesService.create(record as never));
}

export async function removeScope(id: string): Promise<void> {
  await unwrap(Jhrb_profilescopesService.delete(id));
}

export function describeScopes(scopes: Scope[]): string {
  if (scopes.length === 0) return 'No scopes yet';
  return scopes.map((s) => (s.teamId ? `Team ${s.teamName ?? ''}` : `BU ${s.businessUnitName ?? ''}${s.includeChildren ? ' + child BUs' : ''}`)).join('; ');
}
