// js/database.js — 3-phase dataset loader (server → localStorage → hardcoded fallback)
async function loadProjectDataset() {
  // Phase 1: fetch from GitHub Pages / server
  try {
    const response = await fetch('dataset.json');
    if (response.ok) {
      const data = await response.json();
      console.log("Loaded directly from live server dataset.json");
      return data;
    }
  } catch (e) {
    console.warn("Server fetch blocked or failed. Switching to local fallbacks...");
  }

  // Phase 2: localStorage (saved by Admin export)
  const localData = localStorage.getItem('nav_dataset');
  if (localData) {
    console.log("Loaded from local browser storage updates");
    return JSON.parse(localData);
  }

  // Phase 3: hardcoded js/dataset.js fallback
  if (window.MAP_DATASET) {
    console.log("Loaded via hardcoded js/dataset.js fallback allocation");
    return window.MAP_DATASET;
  }

  console.error("Critical error: No dataset could be found anywhere.");
  return null;
}

async function syncDatasetToDB() {
  const floors = await WPDB.Floors.all();
  if (floors.length > 0) return;
  const data = await loadProjectDataset();
  if (data) {
    await WPDB.importAll(data, { replace: false });
    console.log("Dataset imported into IndexedDB.");
  }
}
