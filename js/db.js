/* ===================================================================
   db.js — tiny promise-based IndexedDB wrapper.
   Everything the app knows about a campus (floors, nodes, edges)
   lives here, in the browser, on-device. No server required.

   Schema
   ------
   floors: { id, name, imageData (dataURL or relative path),
             widthPx, heightPx, pxPerMeter, northOffsetDeg, createdAt }
   nodes:  { id, floorId, x, y, label, type }   // type: room|junction|entrance|stairs|lift
   edges:  { id, floorId, aId, bId, distanceM }
=================================================================== */

const WPDB = (() => {
  const DB_NAME = 'waypoint-ar-db';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('floors')) {
          db.createObjectStore('floors', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('nodes')) {
          const s = db.createObjectStore('nodes', { keyPath: 'id' });
          s.createIndex('floorId', 'floorId', { unique: false });
        }
        if (!db.objectStoreNames.contains('edges')) {
          const s = db.createObjectStore('edges', { keyPath: 'id' });
          s.createIndex('floorId', 'floorId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return open().then(db => db.transaction(storeName, mode).objectStore(storeName));
  }

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getAll(storeName, indexName, key) {
    return tx(storeName, 'readonly').then(store => {
      const source = indexName ? store.index(indexName) : store;
      const req = key !== undefined ? source.getAll(key) : source.getAll();
      return reqToPromise(req);
    });
  }

  function put(storeName, value) {
    return tx(storeName, 'readwrite').then(store => reqToPromise(store.put(value)));
  }

  function del(storeName, id) {
    return tx(storeName, 'readwrite').then(store => reqToPromise(store.delete(id)));
  }

  // ---------- Floors ----------
  const Floors = {
    all: () => getAll('floors'),
    get: (id) => tx('floors', 'readonly').then(s => reqToPromise(s.get(id))),
    create: (data) => {
      const floor = Object.assign({
        id: uid('floor'),
        pxPerMeter: null,
        northOffsetDeg: 0,
        createdAt: Date.now()
      }, data);
      return put('floors', floor).then(() => floor);
    },
    update: (floor) => put('floors', floor),
    remove: async (id) => {
      const nodes = await Nodes.byFloor(id);
      for (const n of nodes) await Nodes.remove(n.id);
      return del('floors', id);
    }
  };

  // ---------- Nodes ----------
  const Nodes = {
    byFloor: (floorId) => getAll('nodes', 'floorId', floorId),
    create: (data) => {
      const node = Object.assign({ id: uid('node'), type: 'room' }, data);
      return put('nodes', node).then(() => node);
    },
    update: (node) => put('nodes', node),
    remove: async (id) => {
      const edges = await getAll('edges');
      const dead = edges.filter(e => e.aId === id || e.bId === id);
      for (const e of dead) await del('edges', e.id);
      return del('nodes', id);
    },
    get: (id) => tx('nodes', 'readonly').then(s => reqToPromise(s.get(id)))
  };

  // ---------- Edges ----------
  const Edges = {
    byFloor: (floorId) => getAll('edges', 'floorId', floorId),
    create: (data) => {
      const edge = Object.assign({ id: uid('edge') }, data);
      return put('edges', edge).then(() => edge);
    },
    remove: (id) => del('edges', id)
  };

  // ---------- Export / Import (this is the "dataset file") ----------
  async function exportAll() {
    const [floors, nodes, edges] = await Promise.all([
      getAll('floors'), getAll('nodes'), getAll('edges')
    ]);
    return {
      meta: { app: 'waypoint-ar', version: 1, exportedAt: new Date().toISOString() },
      floors, nodes, edges
    };
  }

  async function importAll(json, { replace = false } = {}) {
    if (!json || !Array.isArray(json.floors)) throw new Error('Invalid dataset file');
    if (replace) {
      const [floors, nodes, edges] = await Promise.all([getAll('floors'), getAll('nodes'), getAll('edges')]);
      for (const f of floors) await del('floors', f.id);
      for (const n of nodes) await del('nodes', n.id);
      for (const e of edges) await del('edges', e.id);
    }
    for (const f of json.floors) await put('floors', f);
    for (const n of json.nodes || []) await put('nodes', n);
    for (const e of json.edges || []) await put('edges', e);
    return true;
  }

  async function loadSample() {
    const res = await fetch('sample-data/sample-graph.json');
    const json = await res.json();
    await importAll(json, { replace: false });
    return json;
  }

  return { Floors, Nodes, Edges, exportAll, importAll, loadSample, uid };
})();
