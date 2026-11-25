import type { ReactNode } from 'react';
import { Avatar, Button, Tooltip } from '@fluentui/react-components';
import { Navigation20Regular, Options20Regular, Person20Regular, ArrowSync20Regular, TextBulletListSquare20Regular, WeatherMoon20Regular, WeatherSunny20Regular } from '@fluentui/react-icons';
import { href, type Route } from '../router';

const NAV: { heading: string; items: { route: Route; label: string; icon: ReactNode; match: Route['page'][] }[] }[] = [
  { heading: 'Configuration', items: [
    { route: { page: 'profiles' }, label: 'Profiles', icon: <Options20Regular />, match: ['profiles', 'profile'] },
    { route: { page: 'users' }, label: 'Users', icon: <Person20Regular />, match: ['users'] },
  ] },
  { heading: 'Operations', items: [
    { route: { page: 'rollouts' }, label: 'Rollouts', icon: <ArrowSync20Regular />, match: ['rollouts'] },
    { route: { page: 'log' }, label: 'Activity log', icon: <TextBulletListSquare20Regular />, match: ['log'] },
  ] },
];

/** Standalone shell: 48px top bar + left navigation, as a model-driven app draws it. Not used when embedded. */
export function Shell({ route, userName, dark, onToggleTheme, children }: {
  route: Route; userName?: string; dark: boolean; onToggleTheme: () => void; children: ReactNode;
}) {
  return (
    <div className="app">
      <header className="topbar">
        <Navigation20Regular aria-hidden />
        <span className="topbar-title">Default User Settings</span>
        <span className="topbar-tag">v{__APP_VERSION__}</span>
        <span className="grow" />
        <Tooltip content={dark ? 'Switch to light theme' : 'Switch to dark theme'} relationship="label">
          <Button appearance="transparent" icon={dark ? <WeatherSunny20Regular /> : <WeatherMoon20Regular />} onClick={onToggleTheme} />
        </Tooltip>
        {userName && <Avatar name={userName} size={32} color="colorful" aria-label={`Signed in as ${userName}`} />}
      </header>
      <div className="body">
        <nav aria-label="Main" className="nav">
          {NAV.map((g) => [
            <div key={g.heading} className="nav-heading">{g.heading}</div>,
            ...g.items.map((i) => (
              <a key={i.label} className="nav-item" href={href(i.route)} aria-current={i.match.includes(route.page) ? 'page' : undefined}>
                {i.icon}{i.label}
              </a>
            )),
          ])}
        </nav>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
