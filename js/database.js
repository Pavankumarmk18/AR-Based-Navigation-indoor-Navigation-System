// database.js — fetch master dataset.json from GitHub Pages (cross-device sync)
async function loadMasterDataset() {
  try {
    const response = await fetch('./dataset.json');
    if (!response.ok) throw new Error('Dataset file not found.');
    const graphData = await response.json();
    console.log('Dataset loaded successfully across devices:', graphData);
    return graphData;
  } catch (error) {
    console.error('Error syncing dataset:', error);
    return JSON.parse(localStorage.getItem('nav_dataset')) || null;
  }
}

// Auto-import dataset.json into IndexedDB if DB is empty
async function syncDatasetToDB() {
  const floors = await WPDB.Floors.all();
  if (floors.length > 0) return; // already has data
  const data = await loadMasterDataset();
  if (data) {
    await WPDB.importAll(data, { replace: false });
    console.log('dataset.json imported into IndexedDB.');
  }
}
