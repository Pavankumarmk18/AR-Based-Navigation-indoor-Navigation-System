/* ===================================================================
   cloud.js — optional cloud sync for the Waypoint dataset.

   js/db.js stores the dataset in IndexedDB, which is local to one
   browser on one device — that's the "no good database" problem.
   This file adds a thin sync layer on top: it pushes/pulls the exact
   same JSON shape WPDB.exportAll()/importAll() already use, to a
   Firebase Firestore document keyed by a short "Building Code" you
   share between devices (Admin's laptop, a phone running Navigate,
   a teammate's machine, etc).

   Setup: paste your Firebase config into FIREBASE_CONFIG below.
   See SETUP.md for the one-time (~10 min) Firebase console steps.
   Until you do, every call here rejects with a clear message and
   the rest of the app keeps working exactly as before on local
   IndexedDB alone — cloud sync is fully optional.
=================================================================== */

const WPCloud = (() => {
  // ---- PASTE YOUR FIREBASE CONFIG HERE (see SETUP.md) ----
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCVTXyMN6VaJNfJXS2ImKXbj9Pff-GTySw",
    authDomain: "ar-based-indoor-navigation.firebaseapp.com",
    projectId: "ar-based-indoor-navigation",
    storageBucket: "ar-based-indoor-navigation.firebasestorage.app",
    messagingSenderId: "337611458433",
    appId: "1:337611458433:web:68f3374704f46295974a80",
  };

  let db = null;

  function configured() {
    return !!FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'PASTE_ME';
  }

  function ensure() {
    if (!configured()) {
      throw new Error('Cloud sync isn\'t set up yet — paste your Firebase config into js/cloud.js (see SETUP.md).');
    }
    if (!db) {
      // eslint-disable-next-line no-undef
      const app = firebase.apps.length ? firebase.apps[0] : firebase.initializeApp(FIREBASE_CONFIG);
      // eslint-disable-next-line no-undef
      db = firebase.firestore(app);
    }
    return db;
  }

  function genCode(len = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
    let code = '';
    for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function norm(code) {
    return String(code || '').toUpperCase().trim();
  }

  /**
   * Save a dataset to the cloud.
   * @param {object} dataset - output of WPDB.exportAll()
   * @param {string} [existingCode] - reuse/overwrite this code instead of minting a new one
   * @returns {Promise<string>} the building code
   */
  async function push(dataset, existingCode) {
    const database = ensure();
    const code = norm(existingCode) || genCode();
    await database.collection('buildings').doc(code).set({
      dataset,
      // eslint-disable-next-line no-undef
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return code;
  }

  /**
   * Fetch a dataset by building code.
   * @param {string} code
   * @returns {Promise<object|null>}
   */
  async function pull(code) {
    const database = ensure();
    const snap = await database.collection('buildings').doc(norm(code)).get();
    return snap.exists ? snap.data().dataset : null;
  }

  /**
   * Live-subscribe to a building code. Fires immediately, then again
   * whenever the admin pushes new changes.
   * @returns {() => void} unsubscribe function
   */
  function watch(code, cb) {
    const database = ensure();
    return database.collection('buildings').doc(norm(code)).onSnapshot((snap) => {
      if (snap.exists) cb(snap.data().dataset);
    });
  }

  return { push, pull, watch, configured };
})();
