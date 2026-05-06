import {
  FetchError,
  createAcl,
  createAclFromFallbackAcl,
  createContainerAt,
  getPublicAccess,
  getSolidDataset,
  getSolidDatasetWithAcl,
  getResourceAcl,
  hasAccessibleAcl,
  hasFallbackAcl,
  hasResourceAcl,
  isPodOwner,
  saveAclFor,
  setAgentDefaultAccess,
  setAgentResourceAccess,
  setPublicDefaultAccess,
  setPublicResourceAccess,
} from '@inrupt/solid-client';

const PUBLIC_ACCESS = { read: true, append: true, write: true };
const OWNER_ACCESS = { read: true, append: true, write: true, control: true };

export function normalizePodUrl(podUrl) {
  return (podUrl || '').replace(/\/$/, '');
}

export function setupStorageKey(podUrl) {
  return `solid-ticker:pod-public-write:${normalizePodUrl(podUrl)}`;
}

export function isSetupMarkedDone(podUrl) {
  try {
    return localStorage.getItem(setupStorageKey(podUrl)) === '1';
  } catch {
    return false;
  }
}

export function markSetupDone(podUrl) {
  try {
    localStorage.setItem(setupStorageKey(podUrl), '1');
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * True if the Pod advertises the user as owner, or (fallback) WebID and Pod share the same origin.
 */
export async function canRunPodSetup(webId, podUrl, fetchFn) {
  if (!webId || !podUrl) return false;
  const root = `${normalizePodUrl(podUrl)}/`;
  let dataset;
  try {
    dataset = await getSolidDataset(root, { fetch: fetchFn });
  } catch (e) {
    if (e instanceof FetchError && e.statusCode === 404) return false;
    throw e;
  }
  const ownerCheck = isPodOwner(webId, dataset);
  if (ownerCheck === true) return true;
  if (ownerCheck === false) return false;
  try {
    return new URL(webId).origin === new URL(podUrl).origin;
  } catch {
    return false;
  }
}

async function ensureContainer(containerUrl, fetchFn) {
  try {
    await getSolidDataset(containerUrl, { fetch: fetchFn });
    return;
  } catch (err) {
    if (!(err instanceof FetchError) || err.statusCode !== 404) throw err;
  }

  try {
    await createContainerAt(containerUrl, { fetch: fetchFn });
  } catch (err2) {
    if (err2 instanceof FetchError && (err2.statusCode === 409 || err2.statusCode === 412)) {
      await getSolidDataset(containerUrl, { fetch: fetchFn });
      return;
    }
    throw err2;
  }
}

function prepareAclDataset(resourceWithAcl, ownerWebId) {
  if (hasResourceAcl(resourceWithAcl)) {
    return getResourceAcl(resourceWithAcl);
  }
  if (hasFallbackAcl(resourceWithAcl)) {
    return createAclFromFallbackAcl(resourceWithAcl);
  }
  let acl = createAcl(resourceWithAcl);
  acl = setAgentResourceAccess(acl, ownerWebId, OWNER_ACCESS);
  acl = setAgentDefaultAccess(acl, ownerWebId, OWNER_ACCESS);
  return acl;
}

/**
 * Creates /ticker/messages/ if needed and sets public read/append/write (foaf:Agent) on that container
 * so anyone can post ticker messages and the backend can read them without credentials.
 */
export async function setupPodPublicWrite({ podUrl, ownerWebId, fetchFn }) {
  const base = normalizePodUrl(podUrl);
  if (!base) throw new Error('POD_URL ist nicht konfiguriert.');

  const tickerUrl = `${base}/ticker/`;
  const messagesUrl = `${base}/ticker/messages/`;

  await ensureContainer(tickerUrl, fetchFn);
  await ensureContainer(messagesUrl, fetchFn);

  const resourceWithAcl = await getSolidDatasetWithAcl(messagesUrl, { fetch: fetchFn });

  if (!hasAccessibleAcl(resourceWithAcl)) {
    throw new Error(
      'Keine bearbeitbare ACL für diesen Container. Hast du Control-Rechte auf dem Pod?',
    );
  }

  let aclDataset = prepareAclDataset(resourceWithAcl, ownerWebId);
  aclDataset = setPublicResourceAccess(aclDataset, PUBLIC_ACCESS);
  aclDataset = setPublicDefaultAccess(aclDataset, PUBLIC_ACCESS);

  await saveAclFor(resourceWithAcl, aclDataset, { fetch: fetchFn });
}

/** Whether anonymous clients could read new files and append to the messages container (owner view). */
export async function messagesArePublicReady(podUrl, fetchFn) {
  const messagesUrl = `${normalizePodUrl(podUrl)}/ticker/messages/`;
  try {
    const ds = await getSolidDatasetWithAcl(messagesUrl, { fetch: fetchFn });
    const access = getPublicAccess(ds);
    if (!access) return false;
    return Boolean(access.read && (access.write || access.append));
  } catch {
    return false;
  }
}
