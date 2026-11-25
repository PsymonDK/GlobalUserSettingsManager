import { SystemusersService } from '../generated/services/SystemusersService';
import { TeamsService } from '../generated/services/TeamsService';
import { BusinessunitsService } from '../generated/services/BusinessunitsService';
import { UsersettingscollectionService } from '../generated/services/UsersettingscollectionService';
import { SETTINGS } from '../settings';
import { display, q, ref, unwrap } from './dv';

type Row = Record<string, unknown>;

export interface User {
  id: string;
  fullName: string;
  title?: string;
  email?: string;
  businessUnitId?: string;
  businessUnitName?: string;
  disabled: boolean;
  licensed: boolean;
}

const USER_COLUMNS = ['systemuserid', 'fullname', 'title', 'internalemailaddress', '_businessunitid_value', 'isdisabled', 'islicensed'];

function toUser(r: Row): User {
  return {
    id: r.systemuserid as string,
    fullName: (r.fullname as string) ?? '',
    title: r.title as string | undefined,
    email: r.internalemailaddress as string | undefined,
    businessUnitId: ref(r, 'businessunitid'),
    businessUnitName: display(r, 'businessunitid'),
    disabled: r.isdisabled === true,
    licensed: r.islicensed === true,
  };
}

/** Interactive, enabled users whose name or email starts with the text. */
export async function searchUsers(text: string, top = 20): Promise<User[]> {
  const t = text.trim();
  const match = t ? ` and (startswith(fullname,${q(t)}) or startswith(internalemailaddress,${q(t)}) or contains(fullname,${q(t)}))` : '';
  const rows = await unwrap(SystemusersService.getAll({
    select: USER_COLUMNS,
    filter: `isdisabled eq false and accessmode eq 0 and applicationid eq null${match}`,
    orderBy: ['fullname asc'],
    top,
  }));
  return (rows as unknown as Row[]).map(toUser);
}

export async function getUser(id: string): Promise<User> {
  return toUser((await unwrap(SystemusersService.get(id, { select: USER_COLUMNS }))) as unknown as Row);
}

/** Licensed interactive users (the population a rollout can touch). Dataverse caps counts at 5000. */
export async function countLicensedUsers(): Promise<number> {
  const r = await SystemusersService.getAll({ select: ['systemuserid'], filter: 'isdisabled eq false and islicensed eq true and accessmode eq 0 and applicationid eq null', count: true, top: 1 });
  return (r as unknown as { count?: number }).count ?? 0;
}

export async function countTeamMembers(teamId: string): Promise<number> {
  const r = await SystemusersService.getAll({ select: ['systemuserid'], filter: `isdisabled eq false and teammembership_association/any(t:t/teamid eq ${teamId})`, count: true, top: 1 });
  return (r as unknown as { count?: number }).count ?? 0;
}

export interface Named { id: string; name: string }

export async function searchTeams(text: string): Promise<Named[]> {
  const rows = await unwrap(TeamsService.getAll({ select: ['teamid', 'name'], filter: text ? `contains(name,${q(text)})` : undefined, orderBy: ['name asc'], top: 25 }));
  return (rows as unknown as Row[]).map((r) => ({ id: r.teamid as string, name: r.name as string }));
}

export async function searchBusinessUnits(text: string): Promise<Named[]> {
  const rows = await unwrap(BusinessunitsService.getAll({ select: ['businessunitid', 'name'], filter: text ? `contains(name,${q(text)})` : undefined, orderBy: ['name asc'], top: 25 }));
  return (rows as unknown as Row[]).map((r) => ({ id: r.businessunitid as string, name: r.name as string }));
}

/** The user's usersettings row (managed attributes only), or undefined if it does not exist yet. */
export async function getUserSettings(userId: string): Promise<Row | undefined> {
  const select = SETTINGS.map((s) => (s.kind === 'Lookup' || s.kind === 'LookupText' ? `_${s.attribute}_value` : s.attribute));
  const r = await UsersettingscollectionService.get(userId, { select });
  return r.error ? undefined : (r.data as unknown as Row);
}
