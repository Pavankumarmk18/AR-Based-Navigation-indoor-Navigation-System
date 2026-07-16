(() => {
  const els = {
    floorSelect: document.getElementById('floorSelect'),
    btnAddFloor: document.getElementById('btnAddFloor'),
    newFloorName: document.getElementById('newFloorName'),
    newFloorImage: document.getElementById('newFloorImage'),
    btnDeleteFloor: document.getElementById('btnDeleteFloor'),
    btnLoadSample: document.getElementById('btnLoadSample'),
    calibCard: document.getElementById('calibCard'),
    btnCalibScale: document.getElementById('btnCalibScale'),
    calibMeters: document.getElementById('calibMeters'),
    btnSaveScale: document.getElementById('btnSaveScale'),
    scaleReadout: document.getElementById('scaleReadout'),
    northManual: document.getElementById('northManual'),
    btnCaptureNorth: document.getElementById('btnCaptureNorth'),
    northReadout: document.getElementById('northReadout'),
    editorArea: document.getElementById('editorArea'),
    canvas: document.getElementById('floorCanvas'),
    canvasWrap: document.querySelector('.canvas-wrap'),
    nodeCount: document.getElementById('nodeCount'),
    edgeCount: document.getElementById('edgeCount'),
    qrSheet: document.getElementById('qrSheet'),
    qrTemp: document.getElementById('qrTemp'),
    btnPrintQR: document.getElementById('btnPrintQR'),
    btnExport: document.getElementById('btnExport'),
    importFile: document.getElementById('importFile'),
  };

  const ctx = els.canvas.getContext('2d');
  let currentFloor = null;
  let floorImage = null;
  let nodes = [];
  let edges = [];
  let mode = 'node';
  let edgeFirstNode = null;
  let calibPicking = false;
  let calibPoints = [];
  let dragNode = null;
  let dragMoved = false;

  const TYPE_COLOR = { room: '#2F6FED', junction: '#4A5163', entrance: '#21A179', stairs: '#FFB800', lift: '#FFB800' };

  // ---------------- Floor list ----------------
  async function refreshFloorList(selectId) {
    const floors = await WPDB.Floors.all();
    els.floorSelect.innerHTML = floors.length
      ? floors.map(f => `<option value="${f.id}">${f.name}</option>`).join('')
      : '<option value="">— none yet —</option>';
    if (selectId) els.floorSelect.value = selectId;
    if (els.floorSelect.value) await loadFloor(els.floorSelect.value);
    else { currentFloor = null; els.editorArea.style.display = 'none'; els.calibCard.style.display = 'none'; }
  }

  async function loadFloor(id) {
    currentFloor = await WPDB.Floors.get(id);
    if (!currentFloor) return;
    els.calibCard.style.display = 'block';
    els.editorArea.style.display = 'block';
    els.northManual.value = currentFloor.northOffsetDeg || 0;
    els.scaleReadout.textContent = currentFloor.pxPerMeter
      ? `Scale set: ${currentFloor.pxPerMeter.toFixed(1)} px = 1 metre`
      : 'No scale set — edge distances will default to 1 px = 1 unit.';
    els.northReadout.textContent = `North offset: ${Math.round(currentFloor.northOffsetDeg || 0)}° (image-up + offset = compass North)`;

    floorImage = new Image();
    floorImage.onload = async () => {
      els.canvas.width = currentFloor.widthPx || floorImage.naturalWidth;
      els.canvas.height = currentFloor.heightPx || floorImage.naturalHeight;
      nodes = await WPDB.Nodes.byFloor(currentFloor.id);
      edges = await WPDB.Edges.byFloor(currentFloor.id);
      render();
      renderQrSheet();
    };
    floorImage.src = currentFloor.imageData;
  }

  els.floorSelect.addEventListener('change', () => refreshFloorList(els.floorSelect.value));

  els.btnAddFloor.addEventListener('click', async () => {
    const name = els.newFloorName.value.trim();
    const file = els.newFloorImage.files[0];
    if (!name || !file) { alert('Give the floor a name and pick an image.'); return; }
    const dataUrl = await fileToDataUrl(file);
    const dims = await imageDims(dataUrl);
    const floor = await WPDB.Floors.create({ name, imageData: dataUrl, widthPx: dims.w, heightPx: dims.h });
    els.newFloorName.value = ''; els.newFloorImage.value = '';
    await refreshFloorList(floor.id);
  });

  els.btnDeleteFloor.addEventListener('click', async () => {
    if (!currentFloor) return;
    if (!confirm(`Delete "${currentFloor.name}" and every pin on it? This can't be undone.`)) return;
    await WPDB.Floors.remove(currentFloor.id);
    await refreshFloorList();
  });

  els.btnLoadSample.addEventListener('click', async () => {
    await WPDB.loadSample();
    await refreshFloorList('floor_sample');
  });

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function imageDims(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = src;
    });
  }

  // ---------------- Rendering ----------------
  function render() {
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    if (floorImage) ctx.drawImage(floorImage, 0, 0, els.canvas.width, els.canvas.height);

    ctx.lineWidth = Math.max(2, els.canvas.width * 0.0025);
    ctx.strokeStyle = '#2F6FED';
    edges.forEach(e => {
      const a = nodes.find(n => n.id === e.aId), b = nodes.find(n => n.id === e.bId);
      if (!a || !b) return;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });

    if (calibPoints.length) {
      ctx.fillStyle = '#E24C4C';
      calibPoints.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.fill(); });
      if (calibPoints.length === 2) {
        ctx.strokeStyle = '#E24C4C'; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(calibPoints[0].x, calibPoints[0].y); ctx.lineTo(calibPoints[1].x, calibPoints[1].y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    const r = Math.max(8, els.canvas.width * 0.011);
    nodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = TYPE_COLOR[n.type] || '#4A5163';
      ctx.fill();
      if (n.id === edgeFirstNode) { ctx.lineWidth = 3; ctx.strokeStyle = '#FFB800'; ctx.stroke(); }
      else { ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); }

      ctx.font = `600 ${Math.max(12, r * 1.3)}px Inter, sans-serif`;
      ctx.fillStyle = '#0E1420';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y - r - 6);
    });

    els.nodeCount.textContent = nodes.length + ' nodes';
    els.edgeCount.textContent = edges.length + ' edges';
  }

  // ---------------- Coordinate mapping ----------------
  function canvasPointFromEvent(evt) {
    const rect = els.canvas.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    const scaleX = els.canvas.width / rect.width;
    const scaleY = els.canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY, clientX, clientY, rect };
  }
  function findNodeNear(pt) {
    const hitR = Math.max(14, els.canvas.width * 0.016);
    let best = null, bestD = hitR;
    nodes.forEach(n => {
      const d = Math.hypot(n.x - pt.x, n.y - pt.y);
      if (d < bestD) { bestD = d; best = n; }
    });
    return best;
  }

  // ---------------- Mode toolbar ----------------
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode;
      edgeFirstNode = null;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('is-active', b === btn));
      render();
    });
  });

  // ---------------- Node popover ----------------
  function openPopover(node, screenX, screenY) {
    closePopover();
    const wrapRect = els.canvasWrap.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.id = 'nodePopover';
    pop.style.cssText = `position:absolute; left:${screenX - wrapRect.left + 12}px; top:${screenY - wrapRect.top}px;
      background:#fff; border:1px solid var(--mist); border-radius:10px; padding:12px; width:220px;
      box-shadow:0 12px 30px rgba(14,20,32,.18); z-index:10;`;
    pop.innerHTML = `
      <label style="margin-top:0;">Label</label>
      <input type="text" id="popLabel" value="${node.label ? node.label.replace(/"/g, '&quot;') : ''}" placeholder="e.g. Room 204">
      <label>Type</label>
      <select id="popType">
        ${['room', 'junction', 'entrance', 'stairs', 'lift'].map(t => `<option value="${t}" ${node.type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="btn btn-primary btn-sm" id="popSave" style="flex:1;">Save</button>
        ${node.id ? '<button class="btn btn-danger btn-sm" id="popDelete">Delete</button>' : ''}
      </div>
      <button class="btn btn-ghost btn-sm" id="popCancel" style="width:100%; margin-top:8px;">Cancel</button>
    `;
    els.canvasWrap.appendChild(pop);

    document.getElementById('popSave').addEventListener('click', async () => {
      const label = document.getElementById('popLabel').value.trim() || 'Untitled';
      const type = document.getElementById('popType').value;
      if (node.id) {
        node.label = label; node.type = type;
        await WPDB.Nodes.update(node);
      } else {
        const created = await WPDB.Nodes.create({ floorId: currentFloor.id, x: node.x, y: node.y, label, type });
        nodes.push(created);
      }
      closePopover(); render();
    });
    const del = document.getElementById('popDelete');
    if (del) del.addEventListener('click', async () => {
      await WPDB.Nodes.remove(node.id);
      nodes = nodes.filter(n => n.id !== node.id);
      edges = edges.filter(e => e.aId !== node.id && e.bId !== node.id);
      closePopover(); render();
    });
    document.getElementById('popCancel').addEventListener('click', () => { closePopover(); render(); });
  }
  function closePopover() { const p = document.getElementById('nodePopover'); if (p) p.remove(); }

  // ---------------- Canvas interaction ----------------
  els.canvas.addEventListener('mousedown', (e) => {
    const pt = canvasPointFromEvent(e);
    if (calibPicking) {
      calibPoints.push(pt);
      if (calibPoints.length > 2) calibPoints = [pt];
      render();
      return;
    }
    if (mode === 'select') {
      const hit = findNodeNear(pt);
      if (hit) { dragNode = hit; dragMoved = false; }
      return;
    }
  });

  els.canvas.addEventListener('mousemove', (e) => {
    if (!dragNode) return;
    const pt = canvasPointFromEvent(e);
    dragNode.x = pt.x; dragNode.y = pt.y; dragMoved = true;
    render();
  });

  window.addEventListener('mouseup', async () => {
    if (dragNode) {
      if (dragMoved) {
        await WPDB.Nodes.update(dragNode);
        await recomputeEdgesForNode(dragNode.id);
      }
      dragNode = null;
    }
  });

  els.canvas.addEventListener('click', async (e) => {
    if (calibPicking || (dragNode !== null)) return;
    const pt = canvasPointFromEvent(e);

    if (mode === 'node') {
      const hit = findNodeNear(pt);
      if (hit) { openPopover(hit, e.clientX, e.clientY); return; }
      openPopover({ x: pt.x, y: pt.y, label: '', type: 'room' }, e.clientX, e.clientY);
      return;
    }

    if (mode === 'edge') {
      const hit = findNodeNear(pt);
      if (!hit) return;
      if (!edgeFirstNode) { edgeFirstNode = hit.id; render(); return; }
      if (edgeFirstNode === hit.id) { edgeFirstNode = null; render(); return; }
      const a = nodes.find(n => n.id === edgeFirstNode);
      const dist = WPPath.pixelDistance(a, hit) / (currentFloor.pxPerMeter || 1);
      const edge = await WPDB.Edges.create({ floorId: currentFloor.id, aId: edgeFirstNode, bId: hit.id, distanceM: dist });
      edges.push(edge);
      edgeFirstNode = null;
      render();
      return;
    }

    if (mode === 'select') {
      if (dragMoved) { dragMoved = false; return; }
      const hit = findNodeNear(pt);
      if (hit) openPopover(hit, e.clientX, e.clientY);
    }
  });

  async function recomputeEdgesForNode(nodeId) {
    const touched = edges.filter(e => e.aId === nodeId || e.bId === nodeId);
    for (const e of touched) {
      const a = nodes.find(n => n.id === e.aId), b = nodes.find(n => n.id === e.bId);
      if (!a || !b) continue;
      e.distanceM = WPPath.pixelDistance(a, b) / (currentFloor.pxPerMeter || 1);
      await WPDB.Edges.create(e); // put() upserts by id
    }
  }

  // ---------------- Calibration: scale ----------------
  els.btnCalibScale.addEventListener('click', () => {
    calibPicking = true; calibPoints = [];
    els.btnCalibScale.textContent = 'Click two points on the map…';
  });
  els.btnSaveScale.addEventListener('click', async () => {
    const meters = parseFloat(els.calibMeters.value);
    if (calibPoints.length < 2 || !meters || meters <= 0) {
      alert('Pick two points on the map and enter the real distance between them in metres.');
      return;
    }
    const pxDist = WPPath.pixelDistance(calibPoints[0], calibPoints[1]);
    currentFloor.pxPerMeter = pxDist / meters;
    await WPDB.Floors.update(currentFloor);
    els.scaleReadout.textContent = `Scale set: ${currentFloor.pxPerMeter.toFixed(1)} px = 1 metre`;
    calibPicking = false; calibPoints = [];
    els.btnCalibScale.textContent = 'Pick 2 points';
    // refresh all edge distances on this floor with the new scale
    edges = await WPDB.Edges.byFloor(currentFloor.id);
    for (const e of edges) {
      const a = nodes.find(n => n.id === e.aId), b = nodes.find(n => n.id === e.bId);
      if (!a || !b) continue;
      e.distanceM = WPPath.pixelDistance(a, b) / currentFloor.pxPerMeter;
      await WPDB.Edges.create(e);
    }
    render();
  });

  // ---------------- Calibration: north ----------------
  els.northManual.addEventListener('change', async () => {
    if (!currentFloor) return;
    currentFloor.northOffsetDeg = ((parseFloat(els.northManual.value) || 0) % 360 + 360) % 360;
    await WPDB.Floors.update(currentFloor);
    els.northReadout.textContent = `North offset: ${Math.round(currentFloor.northOffsetDeg)}° (image-up + offset = compass North)`;
  });

  els.btnCaptureNorth.addEventListener('click', async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { const res = await DeviceOrientationEvent.requestPermission(); if (res !== 'granted') { alert('Compass permission denied.'); return; } }
      catch (e) { alert('Could not request compass permission: ' + e.message); return; }
    }
    els.btnCaptureNorth.textContent = 'Hold phone flat, facing map-up…';
    const handler = async (evt) => {
      let heading = null;
      if (typeof evt.webkitCompassHeading === 'number') heading = evt.webkitCompassHeading;
      else if (evt.absolute && evt.alpha != null) heading = (360 - evt.alpha) % 360;
      if (heading == null) return;
      window.removeEventListener('deviceorientation', handler);
      window.removeEventListener('deviceorientationabsolute', handler);
      currentFloor.northOffsetDeg = heading;
      await WPDB.Floors.update(currentFloor);
      els.northManual.value = Math.round(heading);
      els.northReadout.textContent = `North offset: ${Math.round(heading)}° (captured from device compass)`;
      els.btnCaptureNorth.textContent = 'Capture from phone compass';
    };
    window.addEventListener('deviceorientationabsolute', handler);
    window.addEventListener('deviceorientation', handler);
  });

  // ---------------- QR sheet ----------------
  async function renderQrSheet() {
    els.qrSheet.innerHTML = '';
    for (const n of nodes) {
      const payload = JSON.stringify({ v: 1, floorId: n.floorId, nodeId: n.id });
      els.qrTemp.innerHTML = '';
      // eslint-disable-next-line no-undef
      new QRCode(els.qrTemp, { text: payload, width: 128, height: 128, correctLevel: QRCode.CorrectLevel.M });
      await new Promise(r => setTimeout(r, 30)); // qrcodejs renders async on some browsers
      const src = els.qrTemp.querySelector('canvas')?.toDataURL() || els.qrTemp.querySelector('img')?.src;
      const tile = document.createElement('div');
      tile.className = 'qr-tile';
      tile.innerHTML = `<img src="${src}" width="110" height="110" alt="QR for ${n.label}">
        <div class="label">${n.label}</div>`;
      els.qrSheet.appendChild(tile);
    }
  }
  els.btnPrintQR.addEventListener('click', () => window.print());

  // ---------------- Export / Import ----------------
  els.btnExport.addEventListener('click', async () => {
    const data = await WPDB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'waypoint-dataset.json';
    a.click();
  });
  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      await WPDB.importAll(json, { replace: false });
      alert('Dataset imported.');
      await refreshFloorList();
    } catch (e) {
      alert('Could not import that file: ' + e.message);
    }
    els.importFile.value = '';
  });

  // ---------------- init ----------------
  refreshFloorList();
})();
