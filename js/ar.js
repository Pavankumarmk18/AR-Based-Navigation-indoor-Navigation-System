(() => {
  const els = {
    video: document.getElementById('arVideo'),
    permGate: document.getElementById('permGate'),
    btnEnable: document.getElementById('btnEnable'),
    permError: document.getElementById('permError'),
    hudDest: document.getElementById('hudDest'),
    hudDist: document.getElementById('hudDist'),
    hudProgress: document.getElementById('hudProgress'),
    arrowRotor: document.getElementById('arrowRotor'),
    hudTurnTxt: document.getElementById('hudTurnTxt'),
    hudTurnSub: document.getElementById('hudTurnSub'),
    toast: document.getElementById('toast'),
    btnExit: document.getElementById('btnExit'),
    btnAdvanceDemo: document.getElementById('btnAdvanceDemo'),
    btnScan: document.getElementById('btnScan'),
    arrivedScreen: document.getElementById('arrivedScreen'),
    arrivedLabel: document.getElementById('arrivedLabel'),
    qrModal: document.getElementById('qrModal'),
    qrVideo: document.getElementById('qrVideo'),
    qrCanvas: document.getElementById('qrCanvas'),
    btnCancelScan: document.getElementById('btnCancelScan'),
  };

  const route = JSON.parse(sessionStorage.getItem('wp_route') || 'null');
  if (!route) { location.href = 'navigate.html'; return; }

  let currentIndex = 0;        // index into route.pathNodes of the last confirmed position
  let compassHeading = 0;
  let compassReady = false;

  // ---------------- Permissions & camera ----------------
  els.btnEnable.addEventListener('click', async () => {
    els.permError.textContent = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      els.video.srcObject = stream;
      await els.video.play();
    } catch (e) {
      els.permError.textContent = 'Camera access failed: ' + e.message;
      return;
    }

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') { els.permError.textContent = 'Compass permission denied — arrow will stay fixed.'; }
      } catch (e) { els.permError.textContent = 'Compass permission error — arrow will stay fixed.'; }
    }
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);

    els.permGate.style.display = 'none';
    renderStep();
  });

  function onOrientation(evt) {
    let heading = null;
    if (typeof evt.webkitCompassHeading === 'number') heading = evt.webkitCompassHeading;
    else if (evt.alpha != null) heading = (360 - evt.alpha) % 360;
    if (heading == null) return;
    compassHeading = heading;
    compassReady = true;
    updateArrow();
  }

  // ---------------- HUD / step rendering ----------------
  function remainingDistance() {
    return route.steps.slice(currentIndex).reduce((sum, s) => sum + s.distM, 0);
  }

  function renderStep() {
    const total = route.pathNodes.length - 1;
    const destLabel = route.pathNodes[route.pathNodes.length - 1].label;
    els.hudDest.textContent = destLabel;
    els.hudDist.textContent = remainingDistance().toFixed(0) + ' m left';

    els.hudProgress.innerHTML = Array.from({ length: total }).map((_, i) =>
      `<i class="${i < currentIndex ? 'done' : ''}"></i>`).join('');

    if (currentIndex >= total) {
      showArrived(destLabel);
      return;
    }
    const step = route.steps[currentIndex];
    els.hudTurnTxt.textContent = step.instruction;
    els.hudTurnSub.textContent = `${step.distM.toFixed(0)} m to next checkpoint · ${step.to.label}`;
    updateArrow();
  }

  function updateArrow() {
    const total = route.pathNodes.length - 1;
    if (currentIndex >= total) return;
    const step = route.steps[currentIndex];
    const delta = compassReady ? WPPath.signedDelta(compassHeading, step.bearing) : 0;
    els.arrowRotor.style.transform = `rotate(${delta}deg)`;
  }

  function showArrived(label) {
    els.arrivedLabel.textContent = `You reached ${label}.`;
    els.arrivedScreen.style.display = 'flex';
  }

  function showToast(msg, good) {
    els.toast.textContent = msg;
    els.toast.className = 'toast show' + (good ? ' go' : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  // ---------------- Checkpoint advance / reroute ----------------
  async function handleScannedNode(nodeId) {
    const idxInRoute = route.pathNodes.findIndex(n => n.id === nodeId);

    if (idxInRoute !== -1 && idxInRoute >= currentIndex) {
      currentIndex = idxInRoute;
      showToast('Checkpoint confirmed ✓', true);
      renderStep();
      return;
    }

    // Scanned a node that isn't ahead on the current route — try to reroute from here.
    showToast('Recalculating route…', false);
    try {
      const nodes = await WPDB.Nodes.byFloor(route.floorId);
      const edges = await WPDB.Edges.byFloor(route.floorId);
      const destId = route.pathNodes[route.pathNodes.length - 1].id;
      const result = WPPath.dijkstra(nodes, edges, nodeId, destId);
      if (!result) { showToast("That checkpoint isn't connected to your destination.", false); return; }
      const pathNodes = result.path.map(id => Object.assign({ __pxPerMeter: route.pxPerMeter }, nodes.find(n => n.id === id)));
      route.pathNodes = pathNodes;
      route.steps = WPPath.buildSteps(pathNodes, route.northOffsetDeg);
      route.distanceM = result.distanceM;
      currentIndex = 0;
      sessionStorage.setItem('wp_route', JSON.stringify(route));
      showToast('Route updated', true);
      renderStep();
    } catch (e) {
      showToast('Could not reroute: ' + e.message, false);
    }
  }

  els.btnAdvanceDemo.addEventListener('click', () => {
    const total = route.pathNodes.length - 1;
    if (currentIndex < total) { currentIndex++; renderStep(); }
  });

  els.btnExit.addEventListener('click', () => { location.href = 'navigate.html'; });

  // ---------------- QR checkpoint scanning ----------------
  let scanStream = null, scanRAF = null;
  els.btnScan.addEventListener('click', async () => {
    els.qrModal.style.display = 'flex';
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      els.qrVideo.srcObject = scanStream;
      await els.qrVideo.play();
      scanLoop();
    } catch (e) {
      showToast('Camera error: ' + e.message, false);
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
          if (payload && payload.nodeId) {
            closeScan();
            handleScannedNode(payload.nodeId);
            return;
          }
        } catch (e) { /* not our format, keep scanning */ }
      }
    }
    scanRAF = requestAnimationFrame(scanLoop);
  }
  function closeScan() {
    els.qrModal.style.display = 'none';
    if (scanRAF) cancelAnimationFrame(scanRAF);
    if (scanStream) scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
})();
