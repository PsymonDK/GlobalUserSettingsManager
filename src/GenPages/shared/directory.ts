import { api, queryAll, queryTop, type Row } from './env';
import { SETTINGS } from './settings';
import { display, q, ref } from './dv';

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
const INTERACTIVE = 'isdisabled eq false and accessmode eq 0 and applicationid eq null';

function toUser(r: Row): User {
  return {
    id: String(r.systemuserid),
    fullName: (r.fullname as string) ?? '',
    title: (r.title as string | null) ?? undefined,
    email: (r.internalemailaddress as string | null) ?? undefined,
    businessUnitId: ref(r, 'businessunitid'),
    businessUnitName: display(r, 'businessunitid'),
    disabled: r.isdisabled === true,
    licensed: r.islicensed === true,
  };
}

/** Interactive, enabled users whose name or email matches the text. */
export async function searchUsers(text: string, top = 25): Promise<User[]> {
  const t = text.trim();
  const match = t ? ` and (startswith(fullname,${q(t)}) or startswith(internalemailaddress,${q(t)}) or contains(fullname,${q(t)}))` : '';
  return (await queryTop('systemuser', { select: USER_COLUMNS, filter: INTERACTIVE + match, orderBy: 'fullname asc' }, top)).map(toUser);
}

export async function getUser(id: string): Promise<User> {
  return toUser(await api().retrieveRow('systemuser', { id, select: USER_COLUMNS }));
}

/** Licensed interactive users (the population a rollout can touch). The page runtime has no $count, so this pages through ids. */
export async function countLicensedUsers(): Promise<number> {
  return (await queryAll('systemuser', { select: ['systemuserid'], filter: `islicensed eq true and ${INTERACTIVE}` }, 50000)).length;
}

export async function countTeamMembers(teamId: string): Promise<number> {
  return (await queryAll('systemuser', { select: ['systemuserid'], filter: `isdisabled eq false and teammembership_association/any(t:t/teamid eq ${teamId})` }, 50000)).length;
}

export interface Named { id: string; name: string }

export async function searchTeams(text: string): Promise<Named[]> {
  const rows = await queryTop('team', { select: ['teamid', 'name'], filter: text ? `contains(name,${q(text)})` : undefined, orderBy: 'name asc' }, 25);
  return rows.map((r) => ({ id: String(r.teamid), name: String(r.name ?? '') }));
}

export async function searchBusinessUnits(text: string): Promise<Named[]> {
  const rows = await queryTop('businessunit', { select: ['businessunitid', 'name'], filter: text ? `contains(name,${q(text)})` : undefined, orderBy: 'name asc' }, 25);
  return rows.map((r) => ({ id: String(r.businessunitid), name: String(r.name ?? '') }));
}

/** The user's usersettings row (managed attributes only), or undefined if it does not exist yet. */
export async function getUserSettings(userId: string): Promise<Row | undefined> {
  const select = SETTINGS.map((s) => (s.kind === 'Lookup' || s.kind === 'LookupText' ? `_${s.attribute}_value` : s.attribute));
  const rows = await queryTop('usersettings', { select, filter: `systemuserid eq ${userId}` }, 1);
  return rows[0];
}
