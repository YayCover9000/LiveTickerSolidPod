import {
  login,
  logout,
  getDefaultSession,
  handleIncomingRedirect,
} from '@inrupt/solid-client-authn-browser';

/**
 * Call once on page load. Restores previous session and handles
 * the OIDC redirect callback if returning from the provider.
 */
export async function initAuth() {
  await handleIncomingRedirect({ restorePreviousSession: true });
  return getDefaultSession();
}

/**
 * Redirect the user to their OIDC provider to log in.
 * @param {string} oidcIssuer  e.g. "https://solidcommunity.net"
 */
export async function solidLogin(oidcIssuer) {
  await login({
    oidcIssuer,
    redirectUrl: window.location.href,
    clientName: 'Solid Ticker',
  });
}

export async function solidLogout() {
  await logout({ logoutType: 'app' });
}

export function getSession() {
  return getDefaultSession();
}
