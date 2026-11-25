import { useEffect, useState } from 'react';
import { FluentProvider, webLightTheme, webDarkTheme } from '@fluentui/react-components';
import { getContext } from '@microsoft/power-apps/app';
import { Shell } from './components/Shell';
import { ProfilesPage } from './pages/ProfilesPage';
import { ProfileEditorPage } from './pages/ProfileEditorPage';
import { UsersPage, UserView } from './pages/UsersPage';
import { RolloutsPage, LogPage } from './pages/RolloutsPage';
import { Empty } from './components/common';
import { useRoute } from './router';
import { isGuid } from './data/dv';

const THEME_KEY = 'dus-theme';

function readTheme(): boolean {
  try { return localStorage.getItem(THEME_KEY) === 'dark'; } catch { return false; }
}

interface Launch { embedded: boolean; userId?: string; userName?: string; appUrl?: string }

/**
 * Embedded mode, for a tab on the User form: ?embed=1&user=<systemuserid>. A model-driven IFRAME control with
 * "Pass record object-type code and unique identifier as parameters" appends id={GUID}&typename=systemuser, which also works.
 * Standalone otherwise.
 */
function readLaunch(p: Record<string, string>): Launch {
  const get = (k: string) => Object.entries(p).find(([key]) => key.toLowerCase() === k)?.[1];
  const fromForm = get('typename') === 'systemuser' ? get('id')?.replace(/[{}]/g, '') : undefined;
  const embed = get('embed');
  return { embedded: embed === '1' || embed === 'true' || !!fromForm, userId: get('user') ?? fromForm };
}

function useLaunch(): Launch | undefined {
  const [launch, setLaunch] = useState<Launch>();
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search);
    getContext()
      .then((c) => {
        setLaunch({ ...readLaunch({ ...Object.fromEntries(fromUrl), ...(c.app.queryParams ?? {}) }), userName: c.user.fullName, appUrl: c.app.appUrl?.split('?')[0] });
      })
      .catch(() => setLaunch(readLaunch(Object.fromEntries(fromUrl))));
  }, []);
  return launch;
}

export default function App() {
  const route = useRoute();
  const launch = useLaunch();
  const [dark, setDark] = useState(readTheme);

  const toggleTheme = () => setDark((d) => {
    try { localStorage.setItem(THEME_KEY, d ? 'light' : 'dark'); } catch { /* per-viewer convenience only */ }
    return !d;
  });

  if (!launch) return <FluentProvider theme={webLightTheme} />;

  // Inside a model-driven form the host decides the theme (light); no shell, one user only.
  if (launch.embedded) {
    return (
      <FluentProvider theme={webLightTheme} className="app">
        <main className="main embedded">
          {isGuid(launch.userId) ? <UserView userId={launch.userId} compact appUrl={launch.appUrl} /> : <Empty>Open this from a saved user record.</Empty>}
        </main>
      </FluentProvider>
    );
  }

  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
      <Shell route={route} userName={launch.userName} dark={dark} onToggleTheme={toggleTheme}>
        {route.page === 'profiles' && <ProfilesPage />}
        {route.page === 'profile' && route.id && <ProfileEditorPage key={route.id} id={route.id} />}
        {route.page === 'users' && <UsersPage id={route.id} />}
        {route.page === 'rollouts' && <RolloutsPage />}
        {route.page === 'log' && <LogPage />}
      </Shell>
    </FluentProvider>
  );
}
