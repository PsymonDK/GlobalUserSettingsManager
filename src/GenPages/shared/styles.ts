// Page CSS, scoped under .dus so nothing leaks into the host app. Colours are Fluent tokens (CSS variables set by
// the host's FluentProvider), so the pages follow the app theme. Geometry follows the model-driven app (8px cards with
// shadow4, 42px grid rows, 32px controls).
export const PAGE_CSS = `
.dus { height: 100%; overflow-y: auto; box-sizing: border-box; position: relative; contain: layout; display: flex; flex-direction: column; gap: 16px;
  padding: 16px 24px 32px; background: var(--colorNeutralBackground2); color: var(--colorNeutralForeground1);
  font-family: var(--fontFamilyBase); font-size: 14px; line-height: 20px; }
.dus > * { flex-shrink: 0; }
.dus .grow { flex-grow: 1; }
.dus .card { background: var(--colorNeutralBackground1); border-radius: 8px; box-shadow: var(--shadow4); }
.dus .card-pad { padding: 12px 16px; }
.dus .card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px 16px; border-bottom: 1px solid var(--colorNeutralStroke3); }
.dus .card-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.dus .commandbar { min-height: 44px; box-sizing: border-box; padding: 6px 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.dus .page-title { margin: 0; font-size: 28px; line-height: 36px; font-weight: 700; }
.dus .muted { color: var(--colorNeutralForeground3); }
.dus .small { font-size: 12px; line-height: 16px; }
.dus .row-flex { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.dus .stack { display: flex; flex-direction: column; gap: 16px; }
.dus .split { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.dus .split > .wide { flex: 999 1 640px; min-width: 0; }
.dus .split > .side { flex: 1 1 260px; max-width: 360px; }
.dus .split > .groups { flex: 1 1 180px; max-width: 220px; }
.dus .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.dus .kpi-value { font-size: 28px; line-height: 36px; font-weight: 600; }
.dus .kpi-value small { font-size: 14px; font-weight: 400; color: var(--colorNeutralForeground3); }
.dus .scroll-x { overflow-x: auto; }
.dus .grid-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dus .grid-table th { height: 42px; text-align: left; font-weight: 600; color: var(--colorNeutralForeground3); padding: 0 12px; border-bottom: 1px solid var(--colorNeutralStroke2); white-space: nowrap; }
.dus .grid-table td { height: 42px; padding: 0 12px; border-bottom: 1px solid var(--colorNeutralStroke3); }
.dus .grid-table tbody tr:hover { background: var(--colorNeutralBackground1Hover); }
.dus .grid-table tbody tr.selected { background: var(--colorBrandBackground2); box-shadow: inset 3px 0 0 var(--colorBrandStroke1); }
.dus .grid-table tbody tr.changed { background: var(--colorPaletteYellowBackground1); }
.dus .grid-table tbody tr:last-child td { border-bottom: 0; }
.dus .grid-table .num { text-align: right; }
.dus .grid-table .primary { font-size: 14px; }
.dus .grid-footer { height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-top: 1px solid var(--colorNeutralStroke2); font-size: 12px; color: var(--colorNeutralForeground3); }
.dus .badge { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 6px; border-radius: 4px; font-size: 12px; background: var(--colorNeutralBackground3); color: var(--colorNeutralForeground1); white-space: nowrap; }
.dus .status { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.dus .status.success { color: var(--colorPaletteGreenForeground1); }
.dus .status.warning { color: var(--colorPaletteDarkOrangeForeground1); }
.dus .status.danger { color: var(--colorPaletteRedForeground1); }
.dus .status.info { color: var(--colorBrandForeground1); }
.dus .linkish { border: 0; padding: 0; background: none; font: inherit; color: var(--colorBrandForegroundLink); cursor: pointer; text-align: left; }
.dus .linkish:hover { text-decoration: underline; color: var(--colorBrandForegroundLinkHover); }
.dus .linkish:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--colorStrokeFocus2); border-radius: 2px; }
.dus .group-btn, .dus .list-btn { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 36px; padding: 0 12px;
  border: 0; border-radius: 4px; background: transparent; color: var(--colorNeutralForeground1); font: inherit; text-align: left; cursor: pointer; box-sizing: border-box; }
.dus .list-btn { justify-content: flex-start; min-height: 48px; }
.dus .group-btn:hover, .dus .list-btn:hover { background: var(--colorNeutralBackground1Hover); }
.dus .group-btn:focus-visible, .dus .list-btn:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--colorStrokeFocus2); }
.dus .group-btn[aria-current="true"], .dus .list-btn[aria-current="true"] { background: var(--colorBrandBackground2); font-weight: 600; }
.dus .group-btn[aria-current="true"]::before, .dus .list-btn[aria-current="true"]::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: var(--colorBrandStroke1); }
.dus .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dus .setting-row { display: grid; grid-template-columns: minmax(180px, 1.1fr) minmax(220px, 1.3fr) 240px minmax(180px, 1fr); gap: 16px; align-items: center; min-height: 56px; padding: 8px 16px; box-sizing: border-box; border-bottom: 1px solid var(--colorNeutralStroke3); }
.dus .setting-row.head { min-height: 36px; font-size: 12px; font-weight: 600; color: var(--colorNeutralForeground3); border-bottom-color: var(--colorNeutralStroke2); }
.dus .setting-row.changed { background: var(--colorPaletteYellowBackground1); }
.dus .setting-table { min-width: 880px; }
.dus .not-managed { height: 32px; display: flex; align-items: center; padding: 0 12px; border-radius: 4px; background: var(--colorNeutralBackground2); color: var(--colorNeutralForeground3); }
.dus .mode-switch { display: inline-flex; border: 1px solid var(--colorNeutralStroke1); border-radius: 4px; overflow: hidden; }
.dus .mode-switch button { height: 28px; padding: 0 10px; border: 0; border-right: 1px solid var(--colorNeutralStroke1); background: var(--colorNeutralBackground1); color: var(--colorNeutralForeground1); font: inherit; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.dus .mode-switch button:last-child { border-right: 0; }
.dus .mode-switch button:hover { background: var(--colorNeutralBackground1Hover); }
.dus .mode-switch button:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--colorStrokeFocus2); }
.dus .mode-switch button[aria-pressed="true"] { background: var(--colorBrandBackground2); color: var(--colorBrandForeground2); font-weight: 600; }
.dus .mode-switch button:disabled { color: var(--colorNeutralForegroundDisabled); cursor: default; }
.dus .layers { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dus .layer { display: inline-flex; flex-direction: column; padding: 6px 12px; border-radius: 4px; border: 1px solid var(--colorNeutralStroke2); color: var(--colorNeutralForeground1); background: transparent; font: inherit; text-align: left; }
.dus button.layer { cursor: pointer; }
.dus button.layer:hover { background: var(--colorNeutralBackground1Hover); }
.dus .footer-bar { position: sticky; bottom: 0; margin: 0 -24px -32px; padding: 10px 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; background: var(--colorNeutralBackground1); border-top: 1px solid var(--colorNeutralStroke2); }
/* No z-index on the footer: dialogs portal into .dus after it and must paint above it. */
.dus .empty { padding: 32px 16px; text-align: center; color: var(--colorNeutralForeground3); }
.dus .dl { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; font-size: 12px; }
.dus .dl dt { color: var(--colorNeutralForeground3); }
.dus .dl dd { margin: 0; font-size: 14px; font-weight: 600; }
.dus .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.dus .icon16 { font-size: 16px; }
.dus .icon12 { font-size: 12px; }
@media (max-width: 640px) { .dus { padding: 12px 16px 24px; } .dus .footer-bar { margin: 0 -16px -24px; padding: 10px 16px; } }
@media (prefers-reduced-motion: reduce) { .dus * { transition: none !important; animation: none !important; } }
`;
