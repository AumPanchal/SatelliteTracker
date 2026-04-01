// Simple in-memory cache to avoid hammering CelesTrak
let cache = { data: null, timestamp: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export default async function handler(req, res) {
  const now = Date.now();

  // Return cached data if it's still fresh
  if (cache.data && now - cache.timestamp < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(cache.data);
  }

  try {
    const response = await fetch(
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",
      {
        headers: {
          // CelesTrak requires a descriptive User-Agent
          "User-Agent": "SatelliteTracker/1.0 (https://github.com/AumPanchal/SatelliteTracker)",
          "Accept": "text/plain",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`CelesTrak responded with status ${response.status}`);
    }

    const data = await response.text();

    // Basic sanity check — TLE data should have thousands of lines
    const lineCount = data.trim().split("\n").length;
    if (lineCount < 100) {
      throw new Error(`Suspiciously small TLE response: ${lineCount} lines`);
    }

    // Update cache
    cache = { data, timestamp: now };

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(data);
  } catch (err) {
    console.error("TLE fetch failed:", err.message);

    // Serve stale cache rather than an error, if available
    if (cache.data) {
      console.warn("Serving stale TLE cache due to fetch error");
      return res.status(200).send(cache.data);
    }

    res.status(502).json({ error: "Failed to fetch TLE data", details: err.message });
  }
}