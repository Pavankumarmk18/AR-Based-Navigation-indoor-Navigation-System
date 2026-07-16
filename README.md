<<<<<<< HEAD
# Waypoint — AR Indoor Navigation System

A browser-based major project: upload a floor plan, build a walkable graph of a building,
and guide someone to any room using a compass-driven AR arrow overlaid on their phone's
live camera feed. No app store install, no GPS, no beacons, no backend server required.

---

## 1. How it actually works (read this before your viva)

Indoor spaces don't have GPS, and true markerless AR (the kind ARCore/ARKit do on native
apps — SLAM, visual-inertial odometry) needs device APIs that browsers don't reliably
expose. So this project uses a different, well-established technique instead:

1. **A pre-mapped graph.** You (the admin) upload a floor plan image and place a *node*
   for every room/junction/stairway, then draw *edges* between nodes that are directly
   walkable (corridors). This graph is the "dataset."
2. **Dijkstra's algorithm** computes the shortest walkable path between any two nodes.
3. **QR checkpoints.** Each node gets a printable QR code. Stuck near the matching
   doorway in the real building, scanning one tells the app *exactly* which node the
   walker is at right now — this is what replaces GPS indoors.
4. **The compass arrow.** Between checkpoints, the phone's magnetometer (compass) reports
   which way the phone is facing. The app already knows the compass bearing from the
   current node to the next node (from the floor-plan geometry + a one-time "which way is
   north" calibration). The AR arrow is simply rotated by
   `target bearing − device heading`, so it visually points at the next checkpoint no
   matter which way the walker is facing — this is the "open the camera and the arrow
   shows the direction" behaviour.

This is a deliberate, defensible engineering trade-off, not a shortcut: it's the same
core idea used by several published low-cost indoor-AR-wayfinding systems. Section 7 lists
what you'd add (BLE beacons, native SLAM) if you wanted finer-grained continuous tracking.

---

## 2. Project structure

```
ar-nav/
├── index.html          Landing page
├── admin.html + js/admin.js     Dataset builder (floor upload, nodes, edges, QR, export)
├── navigate.html + js/navigate.js  Route planner (pick start/destination, see the route)
├── ar.html + js/ar.js   AR camera view (compass arrow, checkpoint scanning, rerouting)
├── js/db.js             IndexedDB storage layer (this is your "database")
├── js/pathfinding.js    Dijkstra + compass bearing math (shared, unit-testable)
├── css/style.css        Shared design system
└── sample-data/         A small bundled demo building so the app isn't empty on first run
```

**No backend.** All data (floor images, nodes, edges, calibration) lives in the browser's
IndexedDB. Use **Admin → Export dataset** to save it as a single portable `.json` file —
that file *is* your dataset, and doubles as your project submission artifact.

---

## 3. Running it

Camera and compass access require a "secure context" — `https://`, or `http://localhost`.
Plain `file://` will not work in most browsers.

**Quickest (laptop, for building the dataset):**
```bash
cd ar-nav
python3 -m http.server 8080
# open http://localhost:8080
```
or, with Node installed:
```bash
npx serve .
```

**On your phone (to actually test the AR view):** `localhost` won't be reachable from your
phone, so you need HTTPS on a real address. Easiest free options:
- Deploy the folder to **GitHub Pages** or **Netlify/Vercel** (drag-and-drop the folder in
  Netlify's dashboard — takes under a minute, gives you HTTPS automatically).
- Or tunnel your laptop's local server with a tool like `ngrok`.

Once deployed, open the HTTPS link on your phone, allow camera + motion/orientation
permissions when prompted, and you're navigating.

---

## 4. Building your own college dataset (step by step)

You said you haven't collected data yet — here's the field workflow:

1. **Get a floor plan image.** A scanned/photographed copy of your department's floor
   plan works. No plan available? Walk the building with a phone compass and sketch one
   roughly to scale in any drawing tool — accuracy of node *connections* matters far more
   than pixel-perfect architecture.
2. **Upload it in Admin**, name the floor (e.g. "CS Block — 1st Floor").
3. **Calibrate scale.** Pick two points on the image that you know the real-world
   distance between (e.g. two ends of a corridor you've measured), click **Pick 2 points**,
   enter the metres, save. This lets edge distances and walking-time estimates be real.
4. **Calibrate north.** Stand at a point in the real corridor that corresponds to
   "straight up" on your floor-plan image, hold the phone flat, and tap **Capture from
   phone compass**. (Desktop has no compass — you can type the degree value manually if
   you know it, or leave it at 0 and only calibrate later from a phone.)
5. **Place nodes.** Walk the building (or work from the plan) and drop a pin for every
   room, staircase, lift, entrance, and every corridor junction. Junctions matter — they're
   what makes the corridor graph routable, not just the rooms.
6. **Connect nodes.** Switch to Connect mode and link every pair of nodes that are
   *directly* walkable with no obstruction in between (usually: consecutive junctions
   along a corridor, and each room to its nearest junction).
7. **Print the QR sheet** and stick one code near each real doorway/junction it represents.
   Laminate them if this is a permanent installation.
8. **Export the dataset** regularly as a backup, and to hand off to teammates.

---

## 5. Data model (what's inside the exported JSON)

```jsonc
{
  "floors": [{ "id", "name", "imageData", "widthPx", "heightPx", "pxPerMeter", "northOffsetDeg" }],
  "nodes":  [{ "id", "floorId", "x", "y", "label", "type" }],  // type: room|junction|entrance|stairs|lift
  "edges":  [{ "id", "floorId", "aId", "bId", "distanceM" }]
}
```

`x`/`y` are pixel coordinates on the floor-plan image. `pxPerMeter` and `northOffsetDeg`
are the two calibration numbers described above.

---

## 6. Suggested viva talking points

- **Why QR + compass instead of Wi-Fi/BLE trilateration?** No extra hardware to buy or
  install; works with any smartphone; easy to demo anywhere. Trade-off: position is only
  exact right at a checkpoint, not continuously — worth stating plainly, examiners respect
  an honestly-scoped trade-off far more than an overstated claim.
- **Why not full SLAM/WebXR?** Browser SLAM support is inconsistent across devices; a
  native ARCore/ARKit app could do this but would require Android Studio/Xcode builds and
  device-specific testing outside this project's scope. Named explicitly as future work.
- **Why Dijkstra and not A*?** Campus-scale graphs are small (tens to low hundreds of
  nodes), so Dijkstra's simplicity and guaranteed-shortest-path property are enough; A*
  would only meaningfully help on much larger graphs, mentioned as an optimisation.
- **Live demo tip:** print 3–4 QR checkpoints, walk the actual route in the room, and let
  the examiner watch the arrow swing as you turn — it's the most convincing five seconds
  of the whole demo.

---

## 7. Limitations & future scope

- Position is only ground-truthed at checkpoints; between them the app assumes you're
  walking toward the next node (no dead-reckoning/step-counting is enabled by default).
- Multi-floor transitions (stairs/lifts) are modelled as ordinary nodes; the UI doesn't
  yet auto-switch the active floor when you walk through one — a good "future work" line.
- **Possible extensions:** BLE beacon trilateration for continuous positioning; a native
  ARCore/ARKit build for true markerless world-tracking; step-counter dead-reckoning
  between checkpoints; accessibility-aware routing (avoid stairs); automatic room/label
  detection from floor-plan images using a small ML model.

---

## 8. Libraries used

- [jsQR](https://github.com/cozmo/jsQR) — QR decoding from camera frames (MIT licence)
- [qrcodejs](https://github.com/davidshimjs/qrcodejs) — QR generation for the printable
  checkpoint sheet (MIT licence)
- Google Fonts: Barlow Condensed, Inter, IBM Plex Mono

Both libraries are loaded from a public CDN in the HTML files — no build step, no
`npm install` needed to run the app itself.
=======
# AR-Based-Navigation-indoor-Navigation-System
we do indoor Navigation
>>>>>>> 8575bebc10396bdaf16b47c0b1a15ad7f2714a4c
