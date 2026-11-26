// Host contract: the generative page runtime passes `dataApi` (Dataverse rows) and `pageInput` (navigation data).
// Custom APIs go through dataApi.executeAction when the runtime has the page's bindings; otherwise (code `not_bound`,
// or a runtime without the method) through the app's own Xrm.WebApi.online.execute. See docs/decisions.md 37.
import customApis from '../custom-apis.json';

export type Row = Record<string, unknown>;

export interface QueryOptions { select?: string[]; filter?: string; orderBy?: string; pageSize?: number }
export interface DataTable { rows: Row[]; hasMoreRows: boolean; loadMoreRows?: () => Promise<DataTable> }
interface ActionResult { ok: boolean; indeterminate?: boolean; outputs?: Row; error?: { message: string; code?: string } }

export interface DataApi {
  queryTable(table: string, options: QueryOptions): Promise<DataTable>;
  retrieveRow(table: string, options: { id: string; select?: string[] }): Promise<Row>;
  createRow(table: string, row: Row): Promise<string>;
  updateRow(table: string, id: string, row: Row): Promise<unknown>;
  deleteRow(table: string, id: string): Promise<unknown>;
  executeAction?(request: { name: string; parameters?: Row }): Promise<ActionResult>;
}

export interface PageInput { entityName?: string; recordId?: string; data?: Record<string, unknown> }
export interface PageProps { dataApi?: unknown; pageInput?: PageInput }

let boundApi: DataApi | undefined;

/** Called by each page on render: the host hands a new dataApi object every render. */
export function bindApi(dataApi: unknown): void {
  if (dataApi) boundApi = dataApi as DataApi;
}

export function api(): DataApi {
  if (!boundApi) throw new Error('The data API is not ready yet.');
  return boundApi;
}

/** All rows of a query, following loadMoreRows up to `max`. */
export async function queryAll(table: string, options: QueryOptions, max = 5000): Promise<Row[]> {
  let page = await api().queryTable(table, { pageSize: Math.min(max, 5000), ...options });
  const rows = [...page.rows];
  while (page.hasMoreRows && page.loadMoreRows && rows.length < max) {
    page = await page.loadMoreRows();
    rows.push(...page.rows);
  }
  return rows.slice(0, max);
}

/** The first `top` rows of a query. */
export async function queryTop(table: string, options: QueryOptions, top: number): Promise<Row[]> {
  const page = await api().queryTable(table, { ...options, pageSize: top });
  return page.rows.slice(0, top);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function xrm(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Xrm;
}

type Kind = 'Guid' | 'String' | 'Boolean' | 'Integer';
const EDM: Record<Kind, string> = { Guid: 'Edm.Guid', String: 'Edm.String', Boolean: 'Edm.Boolean', Integer: 'Edm.Int32' };
const API_KINDS = customApis as Record<string, { parameterKinds: Record<string, Kind> }>;

/** Run a global Custom API (Action) and return its outputs. Throws with the server's message on failure. */
export async function callApi(name: string, parameters: Row): Promise<Row> {
  const params: Row = {};
  for (const [k, v] of Object.entries(parameters)) if (v !== undefined && v !== null && v !== '') params[k] = v;
  const runtime = api();
  if (typeof runtime.executeAction === 'function') {
    const r = await runtime.executeAction({ name, parameters: params });
    if (r.ok) return r.outputs ?? {};
    if (r.indeterminate || r.error?.code === 'indeterminate') throw new Error('No answer from the server. Refresh to see whether it ran.');
    if (r.error?.code !== 'not_bound' && r.error?.code !== 'not_enabled') throw new Error(r.error?.message ?? `${name} failed`);
  }
  const kinds = API_KINDS[name]?.parameterKinds ?? {};
  const parameterTypes: Row = {};
  const request: Row = {};
  for (const [k, v] of Object.entries(params)) {
    const kind = kinds[k];
    if (!kind) throw new Error(`${name}: unknown parameter ${k}`);
    parameterTypes[k] = { typeName: EDM[kind], structuralProperty: 1 };
    request[k] = kind === 'Guid' ? { guid: v } : v;
  }
  request.getMetadata = () => ({ boundParameter: null, operationType: 0, operationName: name, parameterTypes });
  const response = await xrm().WebApi.online.execute(request);
  const text = await response.text();
  return text ? (JSON.parse(text) as Row) : {};
}

// ---- Navigation between pages --------------------------------------------------------------------------------

export type PageKey = 'profiles' | 'users' | 'rollouts' | 'log';
export const PAGE_NAMES: Record<PageKey, string> = {
  profiles: 'Default User Settings - Profiles',
  users: 'Default User Settings - Users',
  rollouts: 'Default User Settings - Rollouts',
  log: 'Default User Settings - Activity log',
};

/** Page ids differ per environment, so pages find each other by name (cached for the session). */
async function pageId(key: PageKey): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__dusPageIds = w.__dusPageIds ?? {};
  if (!w.__dusPageIds[key]) {
    const name = PAGE_NAMES[key].replace(/'/g, "''");
    const r = await xrm().WebApi.retrieveMultipleRecords('uxagentproject', `?$select=uxagentprojectid&$filter=name eq '${name}'`);
    const id = r.entities[0]?.uxagentprojectid as string | undefined;
    if (!id) throw new Error(`Page "${PAGE_NAMES[key]}" is not installed.`);
    w.__dusPageIds[key] = id;
  }
  return w.__dusPageIds[key];
}

/** Open another page of this app. `data` arrives as pageInput.data there. */
export async function openPage(key: PageKey, data?: Record<string, string>): Promise<void> {
  await xrm().Navigation.navigateTo({ pageType: 'generative', pageId: await pageId(key), data: data ?? {} });
}

/** Open a record in its model-driven form. */
export async function openRecord(entityName: string, id: string): Promise<void> {
  await xrm().Navigation.navigateTo({ pageType: 'entityrecord', entityName, entityId: id });
}

/** A string from pageInput.data, or undefined. */
export function inputText(input: PageInput | undefined, key: string): string | undefined {
  const v = input?.data?.[key];
  return typeof v === 'string' && v ? v : undefined;
}
