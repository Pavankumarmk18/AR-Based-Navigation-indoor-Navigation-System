(() => {
  const els = {
    emptyState: document.getElementById('emptyState'),
    planner: document.getElementById('planner'),
    floorSelect: document.getElementById('floorSelect'),
    startSelect: document.getElementById('startSelect'),
    destSelect: document.getElementById('destSelect'),
    btnFindRoute: document.getElementById('btnFindRoute'),
    btnScanStart: document.getElementById('btnScanStart'),
    routeCard: document.getElementById('routeCard'),
    routeTitle: document.getElementById('routeTitle'),
    routeMeta: document.getElementById('routeMeta'),
    mapCanvas: document.getElementById('mapCanvas'),
    stepsList: document.getElementById('stepsList'),
    btnStartAR: document.getElementById('btnStartAR'),
    qrModal: document.getElementById('qrModal'),
    qrVideo: document.getElementById('qrVideo'),
    qrCanvas: document.getElementById('qrCanvas'),
    btnCancelScan: document.getElementById('btnCancelScan'),
  };

  let floors = [], currentFloor = null, floorImage = null, nodes = [], edges = [];
  let lastResult = null; // { pathNodes, steps, distanceM }

  async function init() {
    floors = await WPDB.Floors.all();
    if (!floors.length) { els.emptyState.style.display = 'block'; return; }
    els.planner.style.display = 'block';
    els.floorSelect.innerHTML = floors.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
    await loadFloor(floors[0].id);
  }

  async function loadFloor(id) {
    currentFloor = floors.find(f => f.id === id) || await WPDB.Floors.get(id);
    nodes = await WPDB.Nodes.byFloor(currentFloor.id);
    edges = await WPDB.Edges.byFloor(currentFloor.id);
    const opts = nodes.slice().sort((a, b) => a.label.localeCompare(b.label))
      .map(n => `<option value="${n.id}">${n.label}</option>`).join('');
    els.startSelect.innerHTML = opts;
    els.destSelect.innerHTML = opts;
    if (nodes.length > 1) els.destSelect.selectedIndex = 1;
    floorImage = new Image();
    floorImage.src = currentFloor.imageData;
    els.routeCard.style.display = 'none';
  }
  els.floorSelect.addEventListener('change', () => loadFloor(els.floorSelect.value));

  els.btnFindRoute.addEventListener('click', () => {
    const startId = els.startSelect.value, destId = els.destSelect.value;
    if (!startId || !destId) return;
    if (startId === destId) { alert('Pick two different points.'); return; }
    const result = WPPath.dijkstra(nodes, edges, startId, destId);
    if (!result) { alert('No walkable path between those two points — check your corridor connections in Admin.'); return; }
    const pathNodes = result.path.map(id => Object.assign({ __pxPerMeter: currentFloor.pxPerMeter || 1 }, nodes.find(n => n.id === id)));
    const steps = WPPath.buildSteps(pathNodes, currentFloor.northOffsetDeg || 0);
    lastResult = { pathNodes, steps, distanceM: result.distanceM };
    renderRoute();
  });

  function renderRoute() {
    const { pathNodes, steps, distanceM } = lastResult;
    els.routeCard.style.display = 'block';
    els.routeTitle.textContent = `${pathNodes[0].label} → ${pathNodes[pathNodes.length - 1].label}`;
    const minutes = Math.max(1, Math.round(distanceM / 1.2 / 60));
    els.routeMeta.textContent = `${distanceM.toFixed(0)} m · ~${minutes} min walk`;

    drawMap(pathNodes);

    els.stepsList.innerHTML = steps.map((s, i) => `
      <div class="list-row">
        <span>${i + 1}. ${s.instruction}</span>
        <span class="mono muted">${s.distM.toFixed(0)} m</span>
      </div>`).join('') + `
      <div class="list-row"><span>🏁 Arrive at ${pathNodes[pathNodes.length - 1].label}</span><span></span></div>`;
  }

  function drawMap(pathNodes) {
    const canvas = els.mapCanvas;
    const draw = () => {
      canvas.width = currentFloor.widthPx; canvas.height = currentFloor.heightPx;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (floorImage.complete) ctx.drawImage(floorImage, 0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = 'rgba(74,81,99,.25)'; ctx.lineWidth = Math.max(1, canvas.width * 0.0015);
      edges.forEach(e => {
        const a = nodes.find(n => n.id === e.aId), b = nodes.find(n => n.id === e.bId);
        if (!a || !b) return;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });

      ctx.strokeStyle = '#FFB800'; ctx.lineWidth = Math.max(3, canvas.width * 0.005); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      pathNodes.forEach((n, i) => i === 0 ? ctx.moveTo(n.x, n.y) : ctx.lineTo(n.x, n.y));
      ctx.stroke();

      const r = Math.max(9, canvas.width * 0.012);
      pathNodes.forEach((n, i) => {
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#21A179' : (i === pathNodes.length - 1 ? '#E24C4C' : '#0E1420');
        ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      });
    };
    if (floorImage.complete) draw(); else floorImage.onload = draw;
  }

  els.btnStartAR.addEventListener('click', () => {
    if (!lastResult) return;
    sessionStorage.setItem('wp_route', JSON.stringify({
      floorId: currentFloor.id,
      northOffsetDeg: currentFloor.northOffsetDeg || 0,
      pxPerMeter: currentFloor.pxPerMeter || 1,
      pathNodes: lastResult.pathNodes,
      steps: lastResult.steps,
      distanceM: lastResult.distanceM
    }));
    location.href = 'ar.html';
  });

  // ---------------- QR scan to set start ----------------
  let scanStream = null, scanRAF = null;
  els.btnScanStart.addEventListener('click', async () => {
    els.qrModal.style.display = 'flex';
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      els.qrVideo.srcObject = scanStream;
      await els.qrVideo.play();
      scanLoop();
    } catch (e) {
      alert('Camera access failed: ' + e.message);
      closeScan();
    }
  });
  els.btnCancelScan.addEventListener('click', closeScan);

  function scanLoop() {
    const v = els.qrVideo, c = els.qrCanvas;
    if (v.readyState === v.HAVE_ENOUGH_DATA) {
      c.width = v.videoWidth; c.height = v.videoHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      // eslint-disable-next-line no-undef
      const code = jsQR(img.data, img.width, img.height);
      if (code) {
        try {
          const payload = JSON.parse(code.data);
          if (payload && payload.nodeId) { onScanned(payload); return; }
        } catch (e) { /* not our QR format, keep scanning */ }
      }
    }
    scanRAF = requestAnimationFrame(scanLoop);
  }

  async function onScanned(payload) {
    closeScan();
    if (payload.floorId !== currentFloor.id) {
      els.floorSelect.value = payload.floorId;
      await loadFloor(payload.floorId);
    }
    const opt = [...els.startSelect.options].find(o => o.value === payload.nodeId);
    if (opt) els.startSelect.value = payload.nodeId;
  }

  function closeScan() {
    els.qrModal.style.display = 'none';
    if (scanRAF) cancelAnimationFrame(scanRAF);
    if (scanStream) scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }

  init();
})();
