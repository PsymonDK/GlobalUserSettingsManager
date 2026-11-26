import type { Row } from './env';

export function errorText(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  const err = e as { message?: string; error?: { message?: string } };
  return err.message ?? err.error?.message ?? JSON.stringify(e);
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUALIFIED_RE = /^\/[a-z_][a-z0-9_]*\(([0-9a-f-]{36})\)$/i;

export function isGuid(s: string | undefined | null): s is string {
  return !!s && GUID_RE.test(s);
}

/** Bare id of a lookup (`_<field>_value`). The page runtime returns either a bare GUID or `/<table>(<guid>)`. */
export function ref(row: Row | undefined, field: string): string | undefined {
  const raw = row?.[`_${field}_value`];
  if (typeof raw !== 'string' || !raw) return undefined;
  const m = QUALIFIED_RE.exec(raw.trim());
  const id = (m ? m[1] : raw.trim()).toLowerCase();
  return isGuid(id) ? id : undefined;
}

/** Display text of a lookup or choice column (its OData formatted value). */
export function display(row: Row | undefined, field: string): string | undefined {
  if (!row) return undefined;
  return (row[`_${field}_value@OData.Community.Display.V1.FormattedValue`] as string | undefined)
    ?? (row[`${field}@OData.Community.Display.V1.FormattedValue`] as string | undefined);
}

/** Lookup write value for the page runtime: `/<table>(<id>)`, or null to clear. */
export function link(table: string, id: string | undefined | null): string | null {
  return id ? `/${table}(${id})` : null;
}

/** Quote a string for an OData filter. */
export function q(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
