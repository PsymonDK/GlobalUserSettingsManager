import { useEffect, useState } from 'react';

/** Hash routes: #/profiles, #/profiles/<id>, #/users, #/users/<id>, #/rollouts, #/log */
export interface Route { page: 'profiles' | 'profile' | 'users' | 'rollouts' | 'log'; id?: string }

export function parseRoute(hash: string): Route {
  const [, section, id] = hash.replace(/^#/, '').split('/');
  switch (section) {
    case 'profiles': return id ? { page: 'profile', id } : { page: 'profiles' };
    case 'users': return { page: 'users', id };
    case 'rollouts': return { page: 'rollouts' };
    case 'log': return { page: 'log' };
    default: return { page: 'profiles' };
  }
}

export function href(route: Route): string {
  switch (route.page) {
    case 'profile': return `#/profiles/${route.id}`;
    case 'users': return route.id ? `#/users/${route.id}` : '#/users';
    default: return `#/${route.page}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
