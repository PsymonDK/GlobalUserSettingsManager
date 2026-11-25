import type { ReactNode } from 'react';
import { MessageBar, MessageBarBody, MessageBarTitle, MessageBarActions, Button, Spinner } from '@fluentui/react-components';
import {
  Checkmark16Regular, Warning16Regular, ErrorCircle16Regular, LockClosed12Regular, ArrowSync16Regular, Clock16Regular, Dismiss16Regular,
} from '@fluentui/react-icons';
import { JobStatus, MODE_NAMES } from '../settings';

export function Card({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return <section aria-label={label} className={`card ${className ?? ''}`}>{children}</section>;
}

export type Notice = { intent: 'success' | 'error' | 'warning' | 'info'; title?: string; text: string; action?: { label: string; onClick: () => void } };

export function NoticeBar({ notice, onDismiss }: { notice?: Notice; onDismiss?: () => void }) {
  if (!notice) return null;
  return (
    <MessageBar intent={notice.intent} layout="multiline">
      <MessageBarBody>
        {notice.title && <MessageBarTitle>{notice.title}</MessageBarTitle>}
        {notice.text}
      </MessageBarBody>
      <MessageBarActions containerAction={onDismiss ? <Button appearance="transparent" aria-label="Dismiss" icon={<Dismiss16Regular />} onClick={onDismiss} /> : undefined}>
        {notice.action && <Button onClick={notice.action.onClick}>{notice.action.label}</Button>}
      </MessageBarActions>
    </MessageBar>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div className="empty"><Spinner size="small" label={label} /></div>;
}

export function Status({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; children: ReactNode }) {
  const icon = tone === 'success' ? <Checkmark16Regular /> : tone === 'warning' ? <Warning16Regular /> : tone === 'danger' ? <ErrorCircle16Regular /> : null;
  return <span className={`status ${tone}`}>{icon}{children}</span>;
}

export function ModeLabel({ mode }: { mode: number | string }) {
  const name = typeof mode === 'number' ? MODE_NAMES[mode] : mode;
  if (name === 'Locked') return <span className="status" style={{ fontWeight: 600 }}><LockClosed12Regular />Locked</span>;
  if (name === 'Inherit') return <span className="muted">Inherit</span>;
  return <span>{name}</span>;
}

export function JobStatusLabel({ status, failed }: { status: number; failed?: number }) {
  switch (status) {
    case JobStatus.Running: return <span className="status info"><ArrowSync16Regular />Running</span>;
    case JobStatus.Pending: return <span className="status"><Clock16Regular />Pending</span>;
    case JobStatus.Completed: return failed ? <Status tone="danger">Completed, {failed} failed</Status> : <Status tone="success">Completed</Status>;
    case JobStatus.Failed: return <Status tone="danger">Failed</Status>;
    case JobStatus.Cancelled: return <span className="status muted">Cancelled</span>;
    default: return <span className="muted">Unknown</span>;
  }
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
