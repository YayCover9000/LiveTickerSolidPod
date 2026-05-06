import {
  createSolidDataset,
  createThing,
  setStringNoLocale,
  setUrl,
  addUrl,
  setThing,
  saveSolidDatasetAt,
} from '@inrupt/solid-client';

const SCHEMA = {
  text: 'https://schema.org/text',
  author: 'https://schema.org/author',
  dateCreated: 'https://schema.org/dateCreated',
  mentions: 'https://schema.org/mentions',
};

/**
 * Write a single message as a Turtle file to the Pod.
 *
 * @param {object} opts
 * @param {string}   opts.podUrl      Base URL of the Pod (no trailing slash)
 * @param {string}   opts.text        Message body
 * @param {string}   opts.authorWebId WebID of the sender
 * @param {string[]} opts.mentions    Array of WebIDs mentioned in the message
 * @param {Function} opts.fetchFn     Authenticated fetch from the Solid session
 */
export async function saveMessage({ podUrl, text, authorWebId, mentions, fetchFn }) {
  const timestamp = Date.now();
  const msgUrl = `${podUrl}/ticker/messages/${timestamp}.ttl`;

  let dataset = createSolidDataset();
  let thing = createThing({ url: `${msgUrl}#msg` });

  thing = setStringNoLocale(thing, SCHEMA.text, text);
  thing = setUrl(thing, SCHEMA.author, authorWebId);
  thing = setStringNoLocale(thing, SCHEMA.dateCreated, new Date().toISOString());

  for (const webId of mentions) {
    thing = addUrl(thing, SCHEMA.mentions, webId);
  }

  dataset = setThing(dataset, thing);
  await saveSolidDatasetAt(msgUrl, dataset, { fetch: fetchFn });
}
