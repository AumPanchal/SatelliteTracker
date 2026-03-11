import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as satellite from "satellite.js";

// ── Category definitions ───────────────────────────────────
// Each satellite name is matched against these in order.
// First match wins. Colors chosen to look great together on a dark globe.
const CATEGORIES = [
  { key: "starlink",   label: "Starlink",         color: [0.25, 0.75, 1.0],   match: (n) => n.includes("STARLINK") },
  { key: "oneweb",     label: "OneWeb",            color: [1.0,  0.4,  0.9],   match: (n) => n.includes("ONEWEB") },
  { key: "gps",        label: "GPS",               color: [0.0,  1.0,  0.4],   match: (n) => n.includes("GPS") || n.includes("NAVSTAR") },
  { key: "glonass",    label: "GLONASS",           color: [0.4,  1.0,  0.0],   match: (n) => n.includes("GLONASS") },
  { key: "galileo",    label: "Galileo",           color: [0.0,  0.8,  1.0],   match: (n) => n.includes("GALILEO") },
  { key: "beidou",     label: "BeiDou",            color: [1.0,  0.8,  0.0],   match: (n) => n.includes("BEIDOU") || n.includes("COMPASS") },
  { key: "weather",    label: "Weather",           color: [0.0,  0.6,  1.0],   match: (n) => n.includes("NOAA") || n.includes("GOES") || n.includes("METEOSAT") || n.includes("METEOR") || n.includes("HIMAWARI") || n.includes("FY-") },
  { key: "iss",        label: "Space Stations",    color: [1.0,  1.0,  1.0],   match: (n) => n.includes("ISS") || n.includes("TIANGONG") || n.includes("CSS") || n.includes("MIR") },
  { key: "iridium",    label: "Iridium",           color: [0.6,  0.3,  1.0],   match: (n) => n.includes("IRIDIUM") },
  { key: "debris",     label: "Debris",            color: [0.6,  0.2,  0.1],   match: (n) => n.includes("DEB") || n.includes("R/B") || n.includes("ROCKET") || n.includes("BOOSTER") },
  { key: "military",   label: "Military",          color: [1.0,  0.3,  0.3],   match: (n) => n.includes("USA ") || n.includes("NROL") || n.includes("OPS ") || n.includes("DMSP") || n.includes("DSP ") },
  { key: "science",    label: "Science",           color: [0.8,  0.0,  1.0],   match: (n) => n.includes("HUBBLE") || n.includes("HST") || n.includes("CHANDRA") || n.includes("FERMI") || n.includes("SWIFT") || n.includes("TERRA") || n.includes("AQUA") || n.includes("LANDSAT") },
  { key: "other",      label: "Other",             color: [0.4,  0.4,  0.5],   match: () => true },
];

function classifySat(name) {
  const n = name.toUpperCase();
  for (const cat of CATEGORIES) {
    if (cat.match(n)) return cat.key;
  }
  return "other";
}

function createCircleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, 2 * Math.PI);
  ctx.fillStyle = "white";
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

export default function App() {
  const mountRef = useRef(null);
  const [satCount, setSatCount] = useState(0);
  const [utcTime, setUtcTime] = useState("");
  const [selectedSat, setSelectedSat] = useState(null);
  const satNamesArrRef = useRef([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const satrecsRef = useRef([]);
  const satNamesRef = useRef([]);

  // Which categories are currently visible — all on by default
  const [activeCategories, setActiveCategories] = useState(
    () => Object.fromEntries(CATEGORIES.map(c => [c.key, true]))
  );
  // Ref copy so the Three.js color-update function can read it without stale closures
  const activeCatsRef = useRef(activeCategories);
  const updateColorsFnRef = useRef(null);

  const highlightFnRef = useRef(null);
  const selectFnRef = useRef(null);

  // When activeCategories changes, sync the ref and repaint colors
  useEffect(() => {
    activeCatsRef.current = activeCategories;
    if (updateColorsFnRef.current) updateColorsFnRef.current();
  }, [activeCategories]);

  const toggleCategory = (key) => {
    setActiveCategories(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const allOn = Object.values(activeCategories).every(Boolean);
  const toggleAll = () => {
    const next = !allOn;
    setActiveCategories(Object.fromEntries(CATEGORIES.map(c => [c.key, next])));
  };

  useEffect(() => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 2.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.3;
    controls.maxDistance = 10;

    // ── Space background ─────────────────────────────────────
    const textureLoader = new THREE.TextureLoader();
    const spaceTexture = textureLoader.load("/joe_mama.jpg");
    const spaceGeometry = new THREE.SphereGeometry(500, 32, 32);
    const spaceMaterial = new THREE.MeshBasicMaterial({ map: spaceTexture, side: THREE.BackSide, opacity: 0.1, transparent: true });
    scene.add(new THREE.Mesh(spaceGeometry, spaceMaterial));

    // ── Earth ─────────────────────────────────────────────────
    const earthGeometry = new THREE.SphereGeometry(1, 64, 64);
    const earthTexture = textureLoader.load("/earth_base_image.jpg");
    const earthLightsTexture = textureLoader.load("/background_lights.png");
    const earthMaterial = new THREE.MeshPhongMaterial({
      map: earthTexture,
      emissiveMap: earthLightsTexture,
      emissive: new THREE.Color(0xfff1b3),
      emissiveIntensity: 7,
      transparent: true,
      opacity: 1,
    });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    scene.add(earth);

    // ── Atmosphere ────────────────────────────────────────────
    const atmosGeometry = new THREE.SphereGeometry(1.02, 64, 64);
    const atmosMaterial = new THREE.MeshPhongMaterial({ color: 0x4488ff, transparent: true, opacity: 0.08, side: THREE.FrontSide });
    const atmosphere = new THREE.Mesh(atmosGeometry, atmosMaterial);
    scene.add(atmosphere);

    // ── Lighting ──────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(5, 3, 5);
    scene.add(sunLight);

    // ── Highlight mesh ────────────────────────────────────────
    const hlGeo = new THREE.BufferGeometry();
    const hlPos = new Float32Array(3);
    hlGeo.setAttribute("position", new THREE.BufferAttribute(hlPos, 3));
    const hlMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.018, sizeAttenuation: true,
      map: createCircleTexture(), transparent: true, alphaTest: 0.5,
    });
    const hlMesh = new THREE.Points(hlGeo, hlMat);
    hlMesh.visible = false;
    hlMesh.renderOrder = 1000;
    scene.add(hlMesh);

    // ── Hover ring ────────────────────────────────────────────
    // A LineLoop circle (32 segments) drawn around whatever dot the cursor is over.
    // Built in the XY plane at radius 1 — we scale it per-frame to match zoom.
    const hoverRingPts = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      hoverRingPts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    const hoverRingGeo = new THREE.BufferGeometry().setFromPoints(hoverRingPts);
    const hoverRingMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const hoverRing = new THREE.LineLoop(hoverRingGeo, hoverRingMat);
    hoverRing.visible = false;
    hoverRing.renderOrder = 1001;
    scene.add(hoverRing);

    // ── Camera zoom ───────────────────────────────────────────
    let zoomTargetPos = null;
    let zoomTargetLook = null;
    const zoomToSat = (x, y, z) => {
      const satVec = new THREE.Vector3(x, y, z);
      const satDist = satVec.length(); // distance from Earth centre (in scene units)
      const dir = satVec.clone().normalize();
      // place camera 0.8 units behind the satellite along the same direction,
      // but never closer than 1.6 (low Earth) or further than satDist + 0.8
      const camDist = Math.max(1.6, satDist + 0.8);
      zoomTargetPos = dir.multiplyScalar(camDist);
      zoomTargetLook = new THREE.Vector3(0, 0, 0);
    };

    // ── Satellites ────────────────────────────────────────────
    let updateInterval;
    let satelliteMesh;

    const plotSatellites = async () => {
      const response = await fetch("/api/tle");
      const text = await response.text();
      const lines = text.trim().split("\n");
      const data = [];
      for (let i = 0; i < lines.length; i += 3) {
        if (lines[i] && lines[i+1] && lines[i+2]) {
          data.push({ name: lines[i].trim(), TLE_LINE1: lines[i+1].trim(), TLE_LINE2: lines[i+2].trim() });
        }
      }

      setSatCount(data.length);
      satNamesRef.current = data.map(s => s.name);
      satNamesArrRef.current = data.map(s => s.name);

      const satrecs = [];
      const satNames = [];
      const satCategories = []; // category key per satellite

      data.forEach((sat) => {
        satNames.push(sat.name);
        satCategories.push(classifySat(sat.name));
        try { satrecs.push(satellite.twoline2satrec(sat.TLE_LINE1, sat.TLE_LINE2)); }
        catch (e) { satrecs.push(null); }
      });
      satrecsRef.current = satrecs;

      // ── Per-vertex color buffer ────────────────────────────
      // Each satellite gets its category color. Hidden satellites get alpha=0
      // by setting color to [0,0,0] (with alphaTest this hides them).
      const satGeometry = new THREE.BufferGeometry();
      const positions = new Float32Array(satrecs.length * 3);
      const colors = new Float32Array(satrecs.length * 3);
      satGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      satGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      // Build a lookup: category key → [r,g,b]
      const catColorMap = Object.fromEntries(CATEGORIES.map(c => [c.key, c.color]));

      const updateColors = () => {
        const active = activeCatsRef.current;
        for (let i = 0; i < satrecs.length; i++) {
          const cat = satCategories[i];
          if (active[cat]) {
            const [r, g, b] = catColorMap[cat];
            colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
          } else {
            // Set to black — alphaTest on the material will discard these
            colors[i*3] = 0; colors[i*3+1] = 0; colors[i*3+2] = 0;
          }
        }
        satGeometry.attributes.color.needsUpdate = true;
      };

      updateColors();
      updateColorsFnRef.current = updateColors;

      const satMaterial = new THREE.PointsMaterial({
        size: 0.01,
        sizeAttenuation: true,
        map: createCircleTexture(),
        transparent: true,
        alphaTest: 0.1,
        vertexColors: true,
      });

      satelliteMesh = new THREE.Points(satGeometry, satMaterial);
      satelliteMesh.renderOrder = 999;
      scene.add(satelliteMesh);

      // ── Position update ────────────────────────────────────
      const updatePositions = () => {
        const now = new Date();
        const gmst = satellite.gstime(now);
        satrecs.forEach((satrec, i) => {
          if (!satrec) return;
          try {
            const pv = satellite.propagate(satrec, now);
            const pos = pv.position;
            if (!pos) return;
            const gd = satellite.eciToGeodetic(pos, gmst);
            const radius = 1 + gd.height / 6371;
            positions[i*3]   = radius * Math.cos(gd.latitude) * Math.cos(gd.longitude);
            positions[i*3+1] = radius * Math.sin(gd.latitude);
            positions[i*3+2] = radius * Math.cos(gd.latitude) * Math.sin(gd.longitude);
          } catch (e) {}
        });
        satGeometry.attributes.position.needsUpdate = true;

        if (hlMesh.visible && hlMesh.userData.idx != null) {
          const i = hlMesh.userData.idx;
          hlPos[0] = positions[i*3];
          hlPos[1] = positions[i*3+1];
          hlPos[2] = positions[i*3+2];
          hlGeo.attributes.position.needsUpdate = true;
        }
      };

      updatePositions();
      updateInterval = setInterval(updatePositions, 1000);

      // ── Highlight ──────────────────────────────────────────
      const highlightSat = (idx) => {
        if (idx === null) {
          hlMesh.visible = false;
          hlMesh.userData = {};
          return;
        }
        hlMesh.userData.idx = idx;
        hlPos[0] = positions[idx*3];
        hlPos[1] = positions[idx*3+1];
        hlPos[2] = positions[idx*3+2];
        hlGeo.attributes.position.needsUpdate = true;
        hlMesh.visible = true;
        zoomToSat(positions[idx*3], positions[idx*3+1], positions[idx*3+2]);
      };
      highlightFnRef.current = highlightSat;

      // ── Select (used by search) ────────────────────────────
      const selectSat = (idx) => {
        const satrec = satrecs[idx];
        if (!satrec) return;
        const now = new Date();
        const pv = satellite.propagate(satrec, now);
        if (!pv.position) return;
        const gmst = satellite.gstime(now);
        const gd = satellite.eciToGeodetic(pv.position, gmst);
        const vel = pv.velocity;
        const speed = Math.sqrt(vel.x**2 + vel.y**2 + vel.z**2);
        setSelectedSat({
          name: satNames[idx],
          altitude: gd.height.toFixed(1),
          lat: satellite.degreesLat(gd.latitude).toFixed(2),
          lon: satellite.degreesLong(gd.longitude).toFixed(2),
          speed: speed.toFixed(2),
          category: satCategories[idx],
        });
        highlightSat(idx);
      };
      selectFnRef.current = selectSat;

      // ── Visibility check ──────────────────────────────────
      // Returns true if the satellite position is on the camera-facing side
      // of the globe (dot product of sat direction and camera direction > 0)
      // AND not occluded by the Earth (ray from camera to sat doesn't hit the globe).
      const satOcclusionRaycaster = new THREE.Raycaster();
      const isSatVisible = (x, y, z) => {
        const satPos = new THREE.Vector3(x, y, z);
        const camPos = camera.position;
        // Vector from camera to satellite
        const toSat = satPos.clone().sub(camPos);
        const dist = toSat.length();
        satOcclusionRaycaster.set(camPos, toSat.normalize());
        // Check if the ray hits the Earth sphere before reaching the satellite
        const hits = satOcclusionRaycaster.intersectObject(earth);
        if (hits.length > 0 && hits[0].distance < dist - 0.01) return false;
        return true;
      };

      // ── Raycaster ─────────────────────────────────────────
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      const handleClick = (event) => {
        if (didDrag) return;
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        // Scale threshold with camera distance so dots are equally easy to
        // click whether zoomed in tight or pulled all the way out.
        const camDist = camera.position.length();
        raycaster.params.Points.threshold = 0.003 * camDist;
        if (!satelliteMesh) return;
        const intersects = raycaster.intersectObject(satelliteMesh);
        if (intersects.length > 0) {
          const idx = intersects[0].index;
          const px = positions[idx*3], py = positions[idx*3+1], pz = positions[idx*3+2];
          if (!isSatVisible(px, py, pz)) return;
          const satrec = satrecs[idx];
          if (!satrec) return;
          const now = new Date();
          const pv = satellite.propagate(satrec, now);
          const gmst = satellite.gstime(now);
          const gd = satellite.eciToGeodetic(pv.position, gmst);
          const vel = pv.velocity;
          const speed = Math.sqrt(vel.x**2 + vel.y**2 + vel.z**2);
          setSelectedSat({
            name: satNames[idx],
            altitude: gd.height.toFixed(1),
            lat: satellite.degreesLat(gd.latitude).toFixed(2),
            lon: satellite.degreesLong(gd.longitude).toFixed(2),
            speed: speed.toFixed(2),
            category: satCategories[idx],
          });
          highlightSat(idx);
        }
      };
      mountRef.current.addEventListener("click", handleClick);

      // ── Hover detection ────────────────────────────────────
      const hoverMouse = new THREE.Vector2();
      const hoverRaycaster = new THREE.Raycaster();

      const handleHover = (event) => {
        if (isDragging) { hoverRing.visible = false; return; }
        hoverMouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        hoverMouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        hoverRaycaster.setFromCamera(hoverMouse, camera);
        const camDist = camera.position.length();
        hoverRaycaster.params.Points.threshold = 0.003 * camDist;
        if (!satelliteMesh) return;
        const intersects = hoverRaycaster.intersectObject(satelliteMesh);
        if (intersects.length > 0) {
          const idx = intersects[0].index;
          const px = positions[idx*3], py = positions[idx*3+1], pz = positions[idx*3+2];
          if (!isSatVisible(px, py, pz)) {
            hoverRing.visible = false;
            mountRef.current.style.cursor = "default";
            return;
          }
          const cat = satCategories[idx];
          const catDef = CATEGORIES.find(c => c.key === cat);
          const [r, g, b] = catDef ? catDef.color : [0, 1, 0.53];
          hoverRingMat.color.setRGB(r, g, b);

          // Scale ring so it sits snugly around the dot regardless of zoom
          // dot size is 0.005 * camDist in world space, ring radius ~2.5x that
          const scale = camDist * 0.012;
          hoverRing.scale.set(scale, scale, scale);

          // Position the ring on the satellite dot and face the camera
          hoverRing.position.set(
            positions[idx * 3],
            positions[idx * 3 + 1],
            positions[idx * 3 + 2]
          );
          hoverRing.lookAt(camera.position);
          hoverRing.visible = true;
          mountRef.current.style.cursor = "pointer";
        } else {
          hoverRing.visible = false;
          mountRef.current.style.cursor = "default";
        }
      };
      mountRef.current.addEventListener("mousemove", handleHover);
    };

    plotSatellites();

    // ── Clock ─────────────────────────────────────────────────
    const clockInterval = setInterval(() => {
      setUtcTime(new Date().toUTCString().slice(17, 25));
    }, 1000);

    // ── Drag detection ────────────────────────────────────────
    let mouseDownX = 0, mouseDownY = 0, didDrag = false, isDragging = false;
    mountRef.current.addEventListener("mousedown", (e) => {
      mouseDownX = e.clientX; mouseDownY = e.clientY;
      didDrag = false; isDragging = true;
      zoomTargetPos = null; zoomTargetLook = null;
    });
    mountRef.current.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - mouseDownX, dy = e.clientY - mouseDownY;
      if (Math.sqrt(dx*dx + dy*dy) > 4) {
        didDrag = true;
        hoverRing.visible = false;
      }
    });
    mountRef.current.addEventListener("mouseup", () => { isDragging = false; });

    // ── Animation loop ────────────────────────────────────────
    let animationId;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const earthRotationSpeed = (2 * Math.PI) / (24 * 60 * 60);
      const delta = 1 / 60;
      if (!isDragging) {
        earth.rotation.y += earthRotationSpeed * delta;
        atmosphere.rotation.y += earthRotationSpeed * delta;
      }
      if (zoomTargetPos) {
        camera.position.lerp(zoomTargetPos, 0.05);
        controls.target.lerp(zoomTargetLook, 0.05);
        if (camera.position.distanceTo(zoomTargetPos) < 0.001) {
          camera.position.copy(zoomTargetPos);
          controls.target.copy(zoomTargetLook);
          zoomTargetPos = null; zoomTargetLook = null;
        }
      }
      if (hlMesh.visible) {
        const t = Date.now() / 400;
        hlMat.size = 0.018 + Math.sin(t) * 0.009;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ── Resize ────────────────────────────────────────────────
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      clearInterval(updateInterval);
      clearInterval(clockInterval);
      window.removeEventListener("resize", handleResize);
      controls.dispose();
      mountRef.current?.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#000008", position: "relative" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

      {/* ── Top-left info panel ── */}
      <div style={{
        position: "absolute", top: "20px", left: "20px",
        color: "#D224FF", fontFamily: "monospace", fontSize: "13px",
        background: "rgba(0,0,0,0.6)", padding: "16px",
        borderRadius: "8px", border: "1px solid #D224FF", lineHeight: "2",
      }}>
        <div style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "8px" }}>ॐ SATELLITE TRACKER </div>
        <div>OBJECTS IN ORBIT: <span style={{ color: "#fff" }}>{satCount.toLocaleString()}</span></div>
        <div>UTC TIME: <span style={{ color: "#fff" }}>{utcTime}</span></div>
        <div>DATA SOURCE: <span style={{ color: "#fff" }}>CELESTRAK</span></div>
        <div>STATUS: <span style={{ color: "#D224FF" }}>● LIVE</span></div>
      </div>

      {/* ── Category filter panel — bottom left ── */}
      <div style={{
        position: "absolute", bottom: "20px", left: "20px",
        fontFamily: "monospace", fontSize: "11px",
        background: "rgba(0,0,0,0.7)", padding: "14px",
        borderRadius: "8px", border: "1px solid #ffffff11",
        display: "flex", flexDirection: "column", gap: "6px",
        minWidth: "170px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div style={{ fontSize: "12px", color: "#888", letterSpacing: "0.08em" }}>FILTER</div>
          <div
            onClick={toggleAll}
            style={{
              fontSize: "10px", color: allOn ? "#ff4444" : "#D224FF",
              cursor: "pointer", border: `1px solid ${allOn ? "#ff444444" : "#D224FF"}`,
              padding: "2px 7px", borderRadius: "4px", letterSpacing: "0.05em",
            }}
          >{allOn ? "ALL OFF" : "ALL ON"}</div>
        </div>
        {CATEGORIES.map(cat => {
          const active = activeCategories[cat.key];
          const [r, g, b] = cat.color;
          const hex = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
          return (
            <div
              key={cat.key}
              onClick={() => toggleCategory(cat.key)}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                cursor: "pointer", opacity: active ? 1 : 0.35,
                transition: "opacity 0.2s",
              }}
            >
              <div style={{
                width: "10px", height: "10px", borderRadius: "50%",
                background: active ? hex : "#333",
                border: `1px solid ${hex}`,
                flexShrink: 0,
                transition: "background 0.2s",
              }} />
              <span style={{ color: active ? "#ddd" : "#555" }}>{cat.label}</span>
            </div>
          );
        })}
      </div>

      {/* ── Selected satellite info ── */}
      {selectedSat && (() => {
        const cat = CATEGORIES.find(c => c.key === selectedSat.category);
        const [r, g, b] = cat ? cat.color : [0, 1, 0.53];
        const hex = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
        return (
          <div style={{
            position: "absolute", bottom: "20px", left: "210px",
            color: hex, fontFamily: "monospace", fontSize: "13px",
            background: "rgba(0,0,0,0.7)", padding: "16px",
            borderRadius: "8px", border: `1px solid ${hex}44`,
            lineHeight: "2", minWidth: "220px",
          }}>
            <div style={{ fontSize: "15px", fontWeight: "bold", marginBottom: "4px", color: "#fff" }}>
              {selectedSat.name}
            </div>
            <div style={{ fontSize: "10px", color: hex, marginBottom: "8px", letterSpacing: "0.1em" }}>
              {cat?.label?.toUpperCase()}
            </div>
            <div>ALTITUDE: <span style={{ color: "#fff" }}>{selectedSat.altitude} km</span></div>
            <div>LATITUDE: <span style={{ color: "#fff" }}>{selectedSat.lat}°</span></div>
            <div>LONGITUDE: <span style={{ color: "#fff" }}>{selectedSat.lon}°</span></div>
            <div>SPEED: <span style={{ color: "#fff" }}>{selectedSat.speed} km/s</span></div>
            <div
              style={{ marginTop: "8px", fontSize: "11px", color: "#666", cursor: "pointer" }}
              onClick={() => { setSelectedSat(null); if (highlightFnRef.current) highlightFnRef.current(null); }}
              onMouseEnter={e => e.target.style.color = "#ff4444"}
              onMouseLeave={e => e.target.style.color = "#666"}
            >✕ close</div>
          </div>
        );
      })()}

      {/* ── Search ── */}
      <div style={{
        position: "absolute", top: "20px", right: "20px",
        fontFamily: "monospace", display: "flex", flexDirection: "column", alignItems: "flex-end",
      }}>
        <div
          onClick={() => setSearchOpen(o => !o)}
          style={{
            width: "40px", height: "40px", borderRadius: "8px",
            background: searchOpen ? "rgba(0,255,136,0.15)" : "rgba(0,0,0,0.6)",
            border: "1px solid #D224FF", display: "flex",
            alignItems: "center", justifyContent: "center",
            cursor: "pointer", fontSize: "18px", transition: "background 0.2s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(0,255,136,0.2)"}
          onMouseLeave={e => e.currentTarget.style.background = searchOpen ? "rgba(0,255,136,0.15)" : "rgba(0,0,0,0.6)"}
        ><img src="/search_icon.png" alt="search" style={{ width: "22px", height: "22px", objectFit: "contain" }} /></div>

        <div style={{
          overflow: "hidden",
          maxHeight: searchOpen ? "600px" : "0px",
          opacity: searchOpen ? 1 : 0,
          transition: "max-height 0.35s ease, opacity 0.25s ease",
          marginTop: searchOpen ? "8px" : "0px",
          width: "260px",
        }}>
          <div style={{
            background: "rgba(0,0,0,0.75)", border: "1px solid #00ff8822",
            borderRadius: "8px", padding: "16px", display: "flex",
            flexDirection: "column", maxHeight: "560px", boxSizing: "border-box",
          }}>
            <div style={{ fontSize: "13px", color: "#00ff88", fontWeight: "bold", marginBottom: "10px" }}>
              SEARCH SATELLITES
            </div>
            <input
              type="text"
              placeholder="e.g. ISS, STARLINK, GPS..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const match = satNamesRef.current.findIndex(n => n.toLowerCase().includes(searchQuery.toLowerCase()));
                  if (match !== -1 && selectFnRef.current) selectFnRef.current(match);
                }
              }}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1px solid #D224FF",
                borderRadius: "4px", color: "#fff", fontFamily: "monospace",
                fontSize: "12px", padding: "8px", outline: "none",
                width: "100%", boxSizing: "border-box", marginBottom: "10px",
              }}
            />
            <div style={{ overflowY: "auto", flex: 1, fontSize: "12px" }}>
              {searchQuery.length > 1 && satNamesArrRef.current
                .filter(name => name.toLowerCase().includes(searchQuery.toLowerCase()))
                .slice(0, 50)
                .map((name, i) => {
                  const cat = CATEGORIES.find(c => c.match(name.toUpperCase()));
                  const [r, g, b] = cat ? cat.color : [0.4, 0.4, 0.5];
                  const hex = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
                  return (
                    <div
                      key={i}
                      onClick={() => {
                        setSearchQuery(name);
                        const idx = satNamesRef.current.findIndex(n => n === name);
                        if (idx !== -1 && selectFnRef.current) selectFnRef.current(idx);
                      }}
                      style={{
                        padding: "8px 4px", borderBottom: "1px solid #ffffff11",
                        color: "#aaa", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: "8px",
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = "#fff"}
                      onMouseLeave={e => e.currentTarget.style.color = "#aaa"}
                    >
                      <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: hex, flexShrink: 0 }} />
                      {name}
                    </div>
                  );
                })
              }
              {searchQuery.length > 1 && satNamesArrRef.current.filter(n => n.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                <div style={{ color: "#666", fontSize: "11px" }}>No satellites found</div>
              )}
              {searchQuery.length <= 1 && (
                <div style={{ color: "#666", fontSize: "11px" }}>Type at least 2 characters to search</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
