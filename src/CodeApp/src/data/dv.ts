import type { IOperationResult } from '@microsoft/power-apps/data';

/** Unwrap a generated-service result: return data or throw the Dataverse error message. */
export async function unwrap<T>(p: Promise<IOperationResult<T>>): Promise<T> {
  const r = await p;
  if (r.error) throw new Error(errorText(r.error));
  return r.data as T;
}

export function errorText(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  const any = e as { message?: string; error?: { message?: string } };
  return any.message ?? any.error?.message ?? JSON.stringify(e);
}

type Row = Record<string, unknown>;

/** Display name of a lookup or choice: "<field>name" virtual property or the OData formatted value. */
export function display(row: Row | undefined, field: string): string | undefined {
  if (!row) return undefined;
  const lookup = `_${field}_value`;
  return (row[`${field}name`] as string | undefined)
    ?? (row[`${lookup}@OData.Community.Display.V1.FormattedValue`] as string | undefined)
    ?? (row[`${field}@OData.Community.Display.V1.FormattedValue`] as string | undefined);
}

/** Lookup id (`_<field>_value`). */
export function ref(row: Row | undefined, field: string): string | undefined {
  return (row?.[`_${field}_value`] as string | undefined) || undefined;
}

/** Quote a string for an OData filter. */
export function q(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function isGuid(s: string | undefined | null): s is string {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : dateFmt.format(d);
}
