// Varden — merging a device's library with the copy saved for the signed-in account.
//
// Local-first still holds: the browser is where cards and chats are read from, and
// every page works with no account and no network. Signing in only adds a second
// copy, so a card written on a laptop turns up on a phone.
//
// Records are merged per id with the newest `updatedAt` winning, and a delete leaves
// a tombstone ("grave") so the other device cannot push the record straight back.
// Graves expire: carrying an old tombstone forever is not worth the bytes.

export const SYNC_STORES = ['characters', 'chats', 'personas', 'memories'];

// Ninety days is far longer than a device is likely to stay offline, and short
// enough that the tombstone map cannot grow without bound.
export const GRAVE_TTL = 1000 * 60 * 60 * 24 * 90;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function recordStamp(record) {
  if (!isPlainObject(record)) return 0;
  const value = Number(record.updatedAt || record.createdAt || 0);
  return Number.isFinite(value) ? value : 0;
}

export function emptyLibrary() {
  return { characters: [], chats: [], personas: [], memories: [], graves: {}, savedAt: 0 };
}

// Anything may arrive from IndexedDB, an old payload or a hand-edited row, so both
// sides are put into the same shape before they are compared.
export function normalizeLibrary(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const library = emptyLibrary();
  for (const store of SYNC_STORES) {
    library[store] = Array.isArray(source[store])
      ? source[store].filter((record) => isPlainObject(record) && record.id)
      : [];
  }
  // Every store gets its own map even when the payload had none, so callers can
  // always talk about `graves[store]` without a guard.
  for (const store of SYNC_STORES) {
    const graves = {};
    const sourceGraves = isPlainObject(source.graves) ? source.graves[store] : null;
    if (isPlainObject(sourceGraves)) {
      for (const [id, ts] of Object.entries(sourceGraves)) {
        const value = Number(ts);
        if (id && Number.isFinite(value) && value > 0) graves[id] = value;
      }
    }
    library.graves[store] = graves;
  }
  library.savedAt = Number(source.savedAt) || 0;
  return library;
}

function recordSignature(records) {
  return JSON.stringify(
    records
      .map((record) => [record.id, recordStamp(record)])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  );
}

function graveSignature(graves) {
  return JSON.stringify(Object.entries(graves).sort());
}

function sameRecords(left, right) {
  return recordSignature(left) === recordSignature(right);
}

function mergeGraves(local, remote, now) {
  const graves = {};
  for (const source of [remote, local]) {
    for (const [id, ts] of Object.entries(source || {})) {
      if (now - ts > GRAVE_TTL) continue;
      if (ts > (graves[id] || 0)) graves[id] = ts;
    }
  }
  return graves;
}

function mergeStore(localRecords, remoteRecords, graves) {
  const byId = new Map();
  for (const record of [...remoteRecords, ...localRecords]) {
    const current = byId.get(record.id);
    // Ties go to the local copy: it is the one the person is looking at.
    if (!current || recordStamp(record) >= recordStamp(current)) byId.set(record.id, record);
  }
  return [...byId.values()]
    .filter((record) => (graves[record.id] || 0) < recordStamp(record))
    .sort((a, b) => recordStamp(b) - recordStamp(a));
}

// Merge, then say which side needs writing. Callers apply the merged library
// locally, push it to the account, or both.
export function mergeLibraries(localRaw, remoteRaw, now = Date.now()) {
  const local = normalizeLibrary(localRaw);
  const remote = normalizeLibrary(remoteRaw);
  const merged = emptyLibrary();
  merged.savedAt = Math.max(local.savedAt, remote.savedAt, now);

  for (const store of SYNC_STORES) {
    const graves = mergeGraves(local.graves[store], remote.graves[store], now);
    merged.graves[store] = graves;
    merged[store] = mergeStore(local[store], remote[store], graves);
  }

  const localChanged =
    SYNC_STORES.some((store) => !sameRecords(merged[store], local[store])) ||
    SYNC_STORES.some((store) => graveSignature(merged.graves[store]) !== graveSignature(local.graves[store]));

  const remoteChanged =
    SYNC_STORES.some((store) => !sameRecords(merged[store], remote[store])) ||
    SYNC_STORES.some((store) => graveSignature(merged.graves[store]) !== graveSignature(remote.graves[store]));

  return { merged, localChanged, remoteChanged };
}
