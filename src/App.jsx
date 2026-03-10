import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as satellite from "satellite.js";

export default function App() {
  const mountRef = useRef(null);
  const [satCount, setSatCount] = useState(0);
  const [utcTime, setUtcTime] = useState("");

  useEffect(() => {

    // empty stage where we gonna put earth, stars, satellites, etc
    const scene = new THREE.Scene();

    // camera looking at scene
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 2.5);

    // renderer which is drawing the scene
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);

    // controls to allow user to rotate and zoom the camera around the scene with mouse
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.3;
    controls.maxDistance = 10;

    // makes 8000 random points in the background of the screen
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 8000;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
      starPositions[i] = (Math.random() - 0.5) * 2000;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3 });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // wrapping an earth texture around the sphere to make the globe
    const earthGeometry = new THREE.SphereGeometry(1, 64, 64);
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load(
      "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
    );
    const earthMaterial = new THREE.MeshPhongMaterial({ map: earthTexture });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    scene.add(earth);

    // slightly larger sphere which is transparent and tinted blue to give illusion of atmosphere
    const atmosGeometry = new THREE.SphereGeometry(1.02, 64, 64);
    const atmosMaterial = new THREE.MeshPhongMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.08,
      side: THREE.FrontSide,
    });
    const atmosphere = new THREE.Mesh(atmosGeometry, atmosMaterial);
    scene.add(atmosphere);

    // soft light that illuminates everything so no shadows
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    // single point light to simulate the sun
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(5, 3, 5);
    scene.add(sunLight);

    // fetch live TLE data from CelesTrak and plot satellites on the globe
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

      // update the satellite count in the UI
      setSatCount(data.length);

      // parse each TLE once and store the result so we dont re-parse every second
      const satrecs = [];
      data.forEach((sat) => {
        try {
          const satrec = satellite.twoline2satrec(sat.TLE_LINE1, sat.TLE_LINE2);
          satrecs.push(satrec);
        } catch (e) {
          satrecs.push(null);
        }
      });

      // create the points buffer once — we reuse this every update
      const satGeometry = new THREE.BufferGeometry();
      const positions = new Float32Array(satrecs.length * 3);
      satGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

      const satMaterial = new THREE.PointsMaterial({
        color: 0x00ff88,
        size: 0.005,
        sizeAttenuation: true,
      });

      const satelliteMesh = new THREE.Points(satGeometry, satMaterial);
      satelliteMesh.renderOrder = 999;
      scene.add(satelliteMesh);

      // compute where every satellite is right now and update the buffer
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
        // tell Three.js the buffer changed so it redraws the dots
        satGeometry.attributes.position.needsUpdate = true;
      };

      // run immediately then every second
      updatePositions();
      updateInterval = setInterval(updatePositions, 1000);
    };

    plotSatellites();

    // live UTC clock updated every second
    const clockInterval = setInterval(() => {
      setUtcTime(new Date().toUTCString().slice(17, 25));
    }, 1000);

    // track mouse dragging to pause auto-rotation
    let isDragging = false;
    mountRef.current.addEventListener("mousedown", () => isDragging = true);
    mountRef.current.addEventListener("mouseup", () => isDragging = false);

    // animating the globe to rotate slowly and render the scene on each frame
    let animationId;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      // real Earth rotation speed — one full rotation every 24 hours
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

    // handles window resizing
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    // cleanup
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
    </div>
  );
}