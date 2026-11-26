// Page "Activity log": every rollout write, revert and captured admin edit (jhrb_settingslog, kept 90 days).
import * as React from 'react';
import { Toolbar, ToolbarButton, Link, Dropdown, Option } from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import { openPage, type PageProps } from '../shared/env';
import { loadLog, type LogEntry } from '../shared/operations';
import { errorText, formatDate } from '../shared/dv';
import { LOG_SOURCE_NAMES, settingLabel } from '../shared/settings';
import { PageRoot, Card, Loading, NoticeBar, Empty, useMount, shared, forget, type Notice } from '../shared/ui';

const SOURCES = [{ value: 0, label: 'All sources' }].concat(Object.keys(LOG_SOURCE_NAMES).map((v) => ({ value: Number(v), label: LOG_SOURCE_NAMES[Number(v)] })));

function LogPage() {
  const mount = useMount();
  const [rows, setRows] = React.useState<LogEntry[]>();
  const [source, setSource] = React.useState(0);
  const [notice, setNotice] = React.useState<Notice>();
  const fail = (e: unknown) => setNotice({ intent: 'error', text: errorText(e) });

  const load = React.useCallback(async (fresh?: boolean) => {
    if (fresh) forget(`log:${source}`);
    setRows(undefined);
    try { setRows(await shared(`log:${source}`, () => loadLog({ top: 200, source: source || undefined }))); }
    catch (e) { setNotice({ intent: 'error', title: 'Could not load the log.', text: errorText(e) }); }
  }, [source]);
  React.useEffect(() => { load(); }, [load]);

  return (
    <>
      <Card className="commandbar" label="Log commands">
        <Toolbar aria-label="Log commands" style={{ flexWrap: 'wrap', padding: 0, width: '100%' }}>
          <ToolbarButton icon={<ArrowClockwiseRegular />} onClick={() => load(true)}>Refresh</ToolbarButton>
          <span className="grow" />
          <Dropdown aria-label="Source" appearance="filled-darker" mountNode={mount} value={SOURCES.find((s) => s.value === source)?.label} selectedOptions={[String(source)]}
            onOptionSelect={(_, d) => setSource(Number(d.optionValue))} style={{ minWidth: 160 }}>
            {SOURCES.map((s) => <Option key={s.value} value={String(s.value)}>{s.label}</Option>)}
          </Dropdown>
        </Toolbar>
      </Card>
      <NoticeBar notice={notice} onDismiss={() => setNotice(undefined)} />
      <div className="row-flex" style={{ alignItems: 'baseline' }}>
        <h1 className="page-title">Activity log</h1>
        <span className="muted">Every rollout write, revert and captured admin edit. Rows are kept for 90 days.</span>
      </div>
      <Card label="Activity log">
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nothing logged</Empty> : (
          <div className="scroll-x">
            <table className="grid-table" style={{ minWidth: 900 }}>
              <thead><tr><th scope="col">When</th><th scope="col">User</th><th scope="col">Source</th><th scope="col">Setting</th><th scope="col">Old</th><th scope="col">Attempted</th><th scope="col">Applied</th><th scope="col">Profile</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.createdOn)}</td>
                    <td className="primary">{r.userId ? <Link onClick={() => { openPage('users', { userId: r.userId ?? '' }).catch(fail); }}>{r.userName ?? 'User'}</Link> : ''}</td>
                    <td>{LOG_SOURCE_NAMES[r.source ?? 0] ?? ''}</td>
                    <td>{settingLabel(r.setting)}</td>
                    <td>{r.oldValue}</td>
                    <td>{r.attempted}</td>
                    <td>{r.applied}</td>
                    <td>{r.profileId ? <Link onClick={() => { openPage('profiles', { profileId: r.profileId ?? '' }).catch(fail); }}>{r.profileName ?? 'Profile'}</Link> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && <div className="grid-footer"><span>Rows: {rows.length}{rows.length === 200 ? ' (latest 200)' : ''}</span></div>}
      </Card>
    </>
  );
}

export default function Page(props: PageProps) {
  return (
    <PageRoot dataApi={props.dataApi} label="Default user settings: activity log">
      <LogPage />
    </PageRoot>
  );
}
