import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as satellite from "satellite.js";

// draws a white circle on a canvas and returns it as a Three.js texture
// this makes satellite dots render as circles instead of squares
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
    // real milky way image mapped to the inside of a giant sphere
    const textureLoader = new THREE.TextureLoader();
    const spaceTexture = textureLoader.load("/joe_mama.jpg");
    const spaceGeometry = new THREE.SphereGeometry(500, 32, 32);
    const spaceMaterial = new THREE.MeshBasicMaterial({
      map: spaceTexture,
      side: THREE.BackSide,
      opacity: 0.1,
      transparent: true,
    });
    const spaceSphere = new THREE.Mesh(spaceGeometry, spaceMaterial);
    scene.add(spaceSphere);

    // ── Earth ─────────────────────────────────────────────────
    // natural earth style texture with country borders and clear land/water
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
    const atmosMaterial = new THREE.MeshPhongMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.08,
      side: THREE.FrontSide,
    });
    const atmosphere = new THREE.Mesh(atmosGeometry, atmosMaterial);
    scene.add(atmosphere);

    // ── Lighting ──────────────────────────────────────────────
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(5, 3, 5);
    scene.add(sunLight);

    // ── Satellites ────────────────────────────────────────────
    let updateInterval;
    const plotSatellites = async () => {
      const response = await fetch(
        "https://corsproxy.io/?url=https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
      );
      const text = await response.text();
      const lines = text.trim().split("\n");
      const data = [];
      for (let i = 0; i < lines.length; i += 3) {
        data.push({
          name: lines[i].trim(),
          TLE_LINE1: lines[i + 1].trim(),
          TLE_LINE2: lines[i + 2].trim(),
        });
      }

      setSatCount(data.length);

      const satrecs = [];
      const satNames = [];
      data.forEach((sat) => {
        satNames.push(sat.name);
        try {
          satrecs.push(satellite.twoline2satrec(sat.TLE_LINE1, sat.TLE_LINE2));
        } catch (e) {
          satrecs.push(null);
        }
      });

      const satGeometry = new THREE.BufferGeometry();
      const positions = new Float32Array(satrecs.length * 3);
      satGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

      // use our circle canvas texture so dots are round not square
      const satMaterial = new THREE.PointsMaterial({
        color: 0x00ff88,
        size: 0.005,
        sizeAttenuation: true,
        map: createCircleTexture(),
        transparent: true,
        alphaTest: 0.5, // cuts off the corners so only the circle shows
      });

      satelliteMesh = new THREE.Points(satGeometry, satMaterial);
      satelliteMesh.renderOrder = 999;
      scene.add(satelliteMesh);

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
            const lat = gd.latitude;
            const lon = gd.longitude;
            const alt = gd.height;
            const radius = 1 + alt / 6371;
            positions[i * 3]     = radius * Math.cos(lat) * Math.cos(lon);
            positions[i * 3 + 1] = radius * Math.sin(lat);
            positions[i * 3 + 2] = radius * Math.cos(lat) * Math.sin(lon);
          } catch (e) {}
        });
        satGeometry.attributes.position.needsUpdate = true;
      };

      updatePositions();
      updateInterval = setInterval(updatePositions, 1000);

      // raycaster detects which satellite the user clicked on
      // it lives inside plotSatellites so it has access to satrecs and satNames
      const raycaster = new THREE.Raycaster();
      raycaster.params.Points.threshold = 0.02;
      const mouse = new THREE.Vector2();

      const handleClick = (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        if (!satelliteMesh) return;
        const intersects = raycaster.intersectObject(satelliteMesh);
        if (intersects.length > 0) {
          const idx = intersects[0].index;
          const satrec = satrecs[idx];
          if (!satrec) return;
          const now = new Date();
          const pv = satellite.propagate(satrec, now);
          const gmst = satellite.gstime(now);
          const gd = satellite.eciToGeodetic(pv.position, gmst);
          const vel = pv.velocity;
          const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
          setSelectedSat({
            name: satNames[idx],
            altitude: (gd.height).toFixed(1),
            lat: (satellite.degreesLat(gd.latitude)).toFixed(2),
            lon: (satellite.degreesLong(gd.longitude)).toFixed(2),
            speed: speed.toFixed(2),
          });
        }
      };

      mountRef.current.addEventListener("click", handleClick);
    };

    let satelliteMesh;
    plotSatellites();

    // ── Clock ─────────────────────────────────────────────────
    const clockInterval = setInterval(() => {
      setUtcTime(new Date().toUTCString().slice(17, 25));
    }, 1000);

    // ── Mouse drag tracking ───────────────────────────────────
    let isDragging = false;
    mountRef.current.addEventListener("mousedown", () => isDragging = true);
    mountRef.current.addEventListener("mouseup", () => isDragging = false);

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
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ── Resize handler ────────────────────────────────────────
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    // ── Cleanup ───────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animationId);
      clearInterval(updateInterval);
      mountRef.current?.removeEventListener("click", handleClick);
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
      <div style={{
        position: "absolute",
        top: "20px",
        left: "20px",
        color: "#00ff88",
        fontFamily: "monospace",
        fontSize: "13px",
        background: "rgba(0,0,0,0.6)",
        padding: "16px",
        borderRadius: "8px",
        border: "1px solid #00ff8844",
        lineHeight: "2",
      }}>
        <div style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "8px" }}>🛰 SATELLITE TRACKER</div>
        <div>OBJECTS IN ORBIT: <span style={{ color: "#ffffff" }}>{satCount.toLocaleString()}</span></div>
        <div>UTC TIME: <span style={{ color: "#ffffff" }}>{utcTime}</span></div>
        <div>DATA SOURCE: <span style={{ color: "#ffffff" }}>CELESTRAK</span></div>
        <div>STATUS: <span style={{ color: "#00ff88" }}>● LIVE</span></div>
      </div>

      {/* satellite info panel — appears at bottom left when a satellite is clicked */}
      {selectedSat && (
        <div style={{
          position: "absolute",
          bottom: "20px",
          left: "20px",
          color: "#00ff88",
          fontFamily: "monospace",
          fontSize: "13px",
          background: "rgba(0,0,0,0.7)",
          padding: "16px",
          borderRadius: "8px",
          border: "1px solid #00ff8844",
          lineHeight: "2",
          minWidth: "220px",
        }}>
          <div style={{ fontSize: "15px", fontWeight: "bold", marginBottom: "8px", color: "#ffffff" }}>
            {selectedSat.name}
          </div>
          <div>ALTITUDE: <span style={{ color: "#ffffff" }}>{selectedSat.altitude} km</span></div>
          <div>LATITUDE: <span style={{ color: "#ffffff" }}>{selectedSat.lat}°</span></div>
          <div>LONGITUDE: <span style={{ color: "#ffffff" }}>{selectedSat.lon}°</span></div>
          <div>SPEED: <span style={{ color: "#ffffff" }}>{selectedSat.speed} km/s</span></div>
          <div
            style={{ marginTop: "8px", fontSize: "11px", color: "#666", cursor: "pointer" }}
            onClick={() => setSelectedSat(null)}
            onMouseEnter={e => e.target.style.color = "#ff4444"}
            onMouseLeave={e => e.target.style.color = "#666"}
          >
            ✕ close
          </div>
        </div>
      )}
    </div>
  );
}