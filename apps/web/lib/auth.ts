'use client';

/**
 * Client session: bearer token from the control plane, kept in localStorage
 * (single-operator LAN tool, no third-party scripts; the API also rate-damps
 * failed logins and sessions expire server-side after 7 days).
 */
const KEY = 'nexrelm.token';

export function getToken(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
}
export function setToken(token: string): void {
  window.localStorage.setItem(KEY, token);
}
export function clearToken(): void {
  window.localStorage.removeItem(KEY);
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

/** Central 401 handling — drop the dead session and land on the login page. */
export function onUnauthorized(): void {
  if (typeof window === 'undefined') return;
  const p = window.location.pathname;
  if (p === '/login' || p === '/setup') return; // those pages handle their own errors
  clearToken();
  window.location.href = '/login';
}
