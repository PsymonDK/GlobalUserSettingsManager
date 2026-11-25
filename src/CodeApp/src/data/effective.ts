import { byAttribute, formatValue, type SettingDefinition } from '../settings';
import { getUserSettings } from './directory';
import { resolveEffective, type EffectiveSetting } from './operations';

/** One managed setting for one user: what they should have, where it comes from, and what they have now. */
export interface EffectiveRow {
  def: SettingDefinition;
  effective: EffectiveSetting;
  effectiveText: string;
  currentText: string;
  differs: boolean;
}

/** ResolveEffectiveSettings returns values as invariant strings ("True", "105", a GUID, "(empty)"). */
function parseEffective(def: SettingDefinition, s: string): unknown {
  if (s === '(empty)') return null;
  if (def.kind === 'Boolean') return s.toLowerCase() === 'true';
  if (def.kind === 'Integer' || def.kind === 'Choice') return Number(s);
  return s;
}

function readCurrent(def: SettingDefinition, row: Record<string, unknown> | undefined): unknown {
  if (!row) return undefined;
  return def.kind === 'Lookup' || def.kind === 'LookupText' ? row[`_${def.attribute}_value`] : row[def.attribute];
}

function norm(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v).toLowerCase();
}

export interface UserEffective { rows: EffectiveRow[]; layers: string[]; inScope: boolean; hasSettingsRow: boolean }

export async function loadUserEffective(userId: string): Promise<UserEffective> {
  const [eff, current] = await Promise.all([resolveEffective(userId), getUserSettings(userId)]);
  const rows: EffectiveRow[] = [];
  for (const e of eff.settings) {
    const def = byAttribute.get(e.setting);
    if (!def || e.mode === 'Inherit') continue;
    const target = parseEffective(def, e.value);
    const now = readCurrent(def, current);
    rows.push({
      def,
      effective: e,
      effectiveText: formatValue(def, target) || '(empty)',
      currentText: current ? formatValue(def, now) || '(empty)' : '',
      differs: !!current && norm(target) !== norm(now),
    });
  }
  rows.sort((a, b) => Number(b.differs) - Number(a.differs) || a.def.label.localeCompare(b.def.label));
  return { rows, layers: eff.layers, inScope: eff.inScope, hasSettingsRow: !!current };
}
