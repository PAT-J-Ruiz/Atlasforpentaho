/**
 * storage.js — IndexedDB wrapper for PKA
 * Provides async put/get/getAll/query/clear/count operations.
 */

'use strict';

const PKAStorage = (() => {

  let _db = null;

  // ─── Open / Initialise DB ──────────────────────────────────────
  let _opening = null;
  // Atlas opens the DB from several places at startup; share one request.
  function open() {
    if (_db) return Promise.resolve(_db);
    if (!_opening) _opening = _open().finally(() => { _opening = null; });
    return _opening;
  }
  async function _open() {
    if (_db) return _db;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(PKA_CONFIG.DB_NAME, PKA_CONFIG.DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.currentTarget.transaction;

        // executions
        if (!db.objectStoreNames.contains('executions')) {
          const es = db.createObjectStore('executions', { keyPath: 'executionId' });
          es.createIndex('status', 'status', { unique: false });
          es.createIndex('startTime', 'startTime', { unique: false });
          es.createIndex('rootJob', 'rootJob', { unique: false });
        } else if (e.oldVersion < 2) {
          const es = tx.objectStore('executions');
          if (!es.indexNames.contains('rootJob')) {
            es.createIndex('rootJob', 'rootJob', { unique: false });
          }
        }

        // blocks — one row per deduplicated log block, indexed by execution
        // so a single execution's log can be read without scanning all blocks.
        if (!db.objectStoreNames.contains('blocks')) {
          const bs = db.createObjectStore('blocks', { keyPath: 'blockId' });
          bs.createIndex('executionId', 'executionId', { unique: false });
          bs.createIndex('startLineNo', 'startLineNo', { unique: false });
        }

        // jobs
        if (!db.objectStoreNames.contains('jobs')) {
          const js = db.createObjectStore('jobs', { keyPath: 'id', autoIncrement: true });
          js.createIndex('name', 'name', { unique: false });
          js.createIndex('executionId', 'executionId', { unique: false });
          js.createIndex('status', 'status', { unique: false });
          js.createIndex('thread', 'thread', { unique: false });
        }

        // transformations
        if (!db.objectStoreNames.contains('transformations')) {
          const ts = db.createObjectStore('transformations', { keyPath: 'id', autoIncrement: true });
          ts.createIndex('name', 'name', { unique: false });
          ts.createIndex('executionId', 'executionId', { unique: false });
          ts.createIndex('jobId', 'jobId', { unique: false });
          ts.createIndex('status', 'status', { unique: false });
        }

        // variables
        if (!db.objectStoreNames.contains('variables')) {
          const vs = db.createObjectStore('variables', { keyPath: 'id', autoIncrement: true });
          vs.createIndex('name', 'name', { unique: false });
          vs.createIndex('executionId', 'executionId', { unique: false });
          vs.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // errors
        if (!db.objectStoreNames.contains('errors')) {
          const errs = db.createObjectStore('errors', { keyPath: 'id', autoIncrement: true });
          errs.createIndex('severity', 'severity', { unique: false });
          errs.createIndex('executionId', 'executionId', { unique: false });
          errs.createIndex('thread', 'thread', { unique: false });
          errs.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // metrics
        if (!db.objectStoreNames.contains('metrics')) {
          const ms = db.createObjectStore('metrics', { keyPath: 'id', autoIncrement: true });
          ms.createIndex('transformationId', 'transformationId', { unique: false });
          ms.createIndex('executionId', 'executionId', { unique: false });
        }

        // dependencies
        if (!db.objectStoreNames.contains('dependencies')) {
          const ds = db.createObjectStore('dependencies', { keyPath: 'id', autoIncrement: true });
          ds.createIndex('type', 'type', { unique: false });
          ds.createIndex('value', 'value', { unique: false });
        }

        // meta (file hashes, ingest timestamps, etc.)
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      req.onsuccess = (e) => {
        _db = e.target.result;
        resolve(_db);
      };

      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ─── Generic transaction helpers ──────────────────────────────
  function _tx(storeName, mode = 'readonly') {
    return _db.transaction(storeName, mode).objectStore(storeName);
  }

  function _req(idbReq) {
    return new Promise((res, rej) => {
      idbReq.onsuccess = e => res(e.target.result);
      idbReq.onerror  = e => rej(e.target.error);
    });
  }

  // ─── Bulk put (most efficient for large ingests) ───────────────
  /**
   * @param {function} [onProgress] — called periodically as (written, total)
   *   for large stores, so the caller can report save progress instead of
   *   the UI appearing to hang while thousands of records are written.
   */
  async function bulkPut(storeName, records, onProgress) {
    if (!records || records.length === 0) return;
    await open();
    return new Promise((resolve, reject) => {
      const tx    = _db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let i = 0;
      let lastReported = 0;
      const putNext = () => {
        if (i >= records.length) return;
        const req = store.put(records[i++]);
        req.onsuccess = () => {
          if (onProgress && (i - lastReported >= 2000 || i === records.length)) {
            lastReported = i;
            onProgress(i, records.length);
          }
          putNext();
        };
        req.onerror   = e => reject(e.target.error);
      };
      putNext();
      tx.oncomplete = () => resolve(records.length);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function put(storeName, record) {
    await open();
    return _req(_tx(storeName, 'readwrite').put(record));
  }

  async function get(storeName, key) {
    await open();
    return _req(_tx(storeName, 'readonly').get(key));
  }

  async function getAll(storeName) {
    await open();
    return _req(_tx(storeName, 'readonly').getAll());
  }

  async function getAllByIndex(storeName, indexName, value) {
    await open();
    return _req(_tx(storeName, 'readonly').index(indexName).getAll(value));
  }

  async function getBlocksByExecution(executionId) {
    const blocks = await getAllByIndex('blocks', 'executionId', executionId);
    blocks.sort((a, b) => a.startLineNo - b.startLineNo);
    return blocks;
  }

  /**
   * Full-content search: scans every block (via cursor, without loading the
   * whole store into memory) for `term` in its message, identifier or
   * continuation text, and returns the Set of executionIds that contain at
   * least one match anywhere in their log — not just in the job name/thread.
   */
  async function searchBlockExecutions(term) {
    await open();
    const lower = term.toLowerCase();
    return new Promise((resolve, reject) => {
      const matches = new Set();
      const store = _db.transaction('blocks', 'readonly').objectStore('blocks');
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) { resolve(matches); return; }
        const b = cursor.value;
        if (b.executionId && !matches.has(b.executionId)) {
          const hit = (b.message && b.message.toLowerCase().includes(lower))
            || (b.identifier && b.identifier.toLowerCase().includes(lower))
            || (b.continuationRaw || []).some(c => c.toLowerCase().includes(lower));
          if (hit) matches.add(b.executionId);
        }
        cursor.continue();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function count(storeName) {
    await open();
    return _req(_tx(storeName, 'readonly').count());
  }

  async function clear(storeName) {
    await open();
    return _req(_tx(storeName, 'readwrite').clear());
  }

  /** @param {function} [onProgress] — called as (done, total, storeName) after each store is cleared */
  async function clearAll(onProgress) {
    await open();
    const stores = Object.values(PKA_CONFIG.STORES);
    for (let i = 0; i < stores.length; i++) {
      await clear(stores[i]);
      if (onProgress) onProgress(i + 1, stores.length, stores[i]);
    }
  }

  // ─── Range query ───────────────────────────────────────────────
  async function queryByIndex(storeName, indexName, lower, upper) {
    await open();
    const range = IDBKeyRange.bound(lower, upper);
    return _req(_tx(storeName, 'readonly').index(indexName).getAll(range));
  }

  // ─── Meta helpers ──────────────────────────────────────────────
  async function setMeta(key, value) {
    return put('meta', { key, value, updatedAt: Date.now() });
  }

  async function getMeta(key) {
    const rec = await get('meta', key);
    return rec ? rec.value : null;
  }

  return {
    open, put, bulkPut, get, getAll, getAllByIndex, getBlocksByExecution,
    searchBlockExecutions,
    count, clear, clearAll, queryByIndex, setMeta, getMeta,
  };

})();

if (typeof window !== 'undefined') window.PKAStorage = PKAStorage;
if (typeof self   !== 'undefined' && typeof window === 'undefined') self.PKAStorage = PKAStorage;
