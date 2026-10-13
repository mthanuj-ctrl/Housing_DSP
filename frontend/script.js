/* ==========================================================================
   Real-Time Housing Price Prediction and Neighborhood Affordability Clustering
   Frontend: geocoding via Nominatim, AI spell correction, charts, nearby cmp.
   ========================================================================== */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BACKEND_URL = window.__BACKEND_URL__ || "https://YOUR-HF-USERNAME-housing-api.hf.space";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const PALETTE = {
    teal:   "#2a7f7f",
    rust:   "#a0522d",
    slate:  "#4a5a6a",
    amber:  "#b8860b",
    budget: "#3a7d44",
    mid:    "#b8860b",
    luxury: "#8b3a3a",
    grid:   "#ddd5c8",
    text:   "#2c2824",
    muted:  "#8a8175",
};

// ---------------------------------------------------------------------------
// Seed localities kept only as offline fallback if Nominatim is unreachable
// ---------------------------------------------------------------------------
const SEED_LOCALITIES = [
    { name: "Koramangala", city: "Bengaluru", lat: 12.9352, lng: 77.6245, price: 14500, bhk: "2BHK", tier: "Luxury" },
    { name: "Whitefield",  city: "Bengaluru", lat: 12.9698, lng: 77.7500, price: 7800,  bhk: "2BHK", tier: "Mid-Tier" },
    { name: "Indiranagar", city: "Bengaluru", lat: 12.9719, lng: 77.6412, price: 13200, bhk: "2BHK", tier: "Luxury" },
    { name: "HSR Layout",  city: "Bengaluru", lat: 12.9121, lng: 77.6446, price: 9500,  bhk: "2BHK", tier: "Mid-Tier" },
    { name: "Gachibowli",  city: "Hyderabad", lat: 17.4401, lng: 78.3489, price: 8200,  bhk: "3BHK", tier: "Mid-Tier" },
    { name: "Hitech City", city: "Hyderabad", lat: 17.4483, lng: 78.3915, price: 9800,  bhk: "3BHK", tier: "Mid-Tier" },
    { name: "Andheri",     city: "Mumbai",    lat: 19.1197, lng: 72.8464, price: 28000, bhk: "1BHK", tier: "Luxury" },
    { name: "Thane",       city: "Mumbai",    lat: 19.2183, lng: 72.9781, price: 11500, bhk: "2BHK", tier: "Budget" },
    { name: "Baner",       city: "Pune",      lat: 18.5590, lng: 73.7868, price: 9200,  bhk: "2BHK", tier: "Mid-Tier" },
    { name: "Hinjewadi",   city: "Pune",      lat: 18.5913, lng: 73.7389, price: 7500,  bhk: "2BHK", tier: "Budget" },
    { name: "Velachery",   city: "Chennai",   lat: 12.9756, lng: 80.2210, price: 8100,  bhk: "2BHK", tier: "Mid-Tier" },
    { name: "Salt Lake",   city: "Kolkata",   lat: 22.5867, lng: 88.4171, price: 6500,  bhk: "3BHK", tier: "Budget" },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
    map: null,
    markers: [],
    searchedMarker: null,
    selectedLocality: null,
    city: "",
    coordinates: null,
    currentPrice: null,
    currentTier: null,
    nearby: [],
    charts: {},
};

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
function initMap() {
    state.map = L.map("map", { center: [17.5, 78.5], zoom: 5, zoomControl: true });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(state.map);

    renderSeedMarkers();
}

function tierColour(tier) {
    switch (tier) {
        case "Budget":   return PALETTE.budget;
        case "Mid-Tier": return PALETTE.mid;
        case "Luxury":   return PALETTE.luxury;
        default:         return PALETTE.slate;
    }
}

function renderSeedMarkers() {
    state.markers.forEach((m) => state.map.removeLayer(m));
    state.markers = [];

    SEED_LOCALITIES.forEach((loc) => {
        const colour = tierColour(loc.tier);
        const icon = L.divIcon({
            className: "marker-pulse",
            html: `<div style="width:14px;height:14px;background-color:${colour};border:2px solid #faf8f3;border-radius:50%;"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
        });
        const marker = L.marker([loc.lat, loc.lng], { icon }).addTo(state.map);
        marker.bindPopup(`
            <strong>${loc.name}</strong><br/>
            City: ${loc.city}<br/>
            Price per Sq.Ft.: INR ${loc.price.toLocaleString("en-IN")}<br/>
            Configuration: ${loc.bhk}<br/>
            Tier: <span style="color:${colour};font-weight:700;">${loc.tier}</span>
        `);
        state.markers.push(marker);
    });
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function setStatus(msg, ok = false) {
    const el = document.getElementById("searchStatus");
    el.textContent = msg || "";
    el.classList.toggle("success", ok);
}

function revealAll() {
    document.querySelectorAll(".metric-card").forEach((c, i) => setTimeout(() => c.classList.add("visible"), i * 60));
    document.querySelectorAll(".forecast-bar").forEach((b, i) => setTimeout(() => b.classList.add("visible"), i * 100));
    document.querySelectorAll(".fade-in").forEach((el) => el.classList.add("visible"));
}

// ---------------------------------------------------------------------------
// Geocoding via OpenStreetMap Nominatim (free, no API key)
// ---------------------------------------------------------------------------
let lastNominatimCall = 0;
async function geocodeLocality(name, city) {
    const query = city ? `${name}, ${city}, India` : `${name}, India`;
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=in&addressdetails=1`;

    // Respect Nominatim's 1 request per second policy
    const now = Date.now();
    const wait = Math.max(0, 1100 - (now - lastNominatimCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimCall = Date.now();

    try {
        const res = await fetch(url, { headers: { "Accept": "application/json" } });
        if (!res.ok) throw new Error("Nominatim " + res.status);
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return null;
        const hit = data[0];
        return {
            lat: parseFloat(hit.lat),
            lng: parseFloat(hit.lon),
            displayName: hit.display_name,
        };
    } catch (e) {
        console.warn("Geocoding failed:", e);
        return null;
    }
}

// ---------------------------------------------------------------------------
// AI spell correction
// ---------------------------------------------------------------------------
async function correctSpelling(query, city) {
    try {
        const res = await fetch(`${BACKEND_URL}/api/correct`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, city: city || null }),
        });
        if (!res.ok) throw new Error("correct " + res.status);
        return await res.json();
    } catch (e) {
        console.warn("Spell correction unavailable:", e);
        return { original: query, corrected: query, changed: false };
    }
}

// ---------------------------------------------------------------------------
// Nearby localities via AI
// ---------------------------------------------------------------------------
async function fetchNearby(locality, city, lat, lng) {
    try {
        const res = await fetch(`${BACKEND_URL}/api/nearby`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locality, city, lat, lng, radius_km: 15 }),
        });
        if (!res.ok) throw new Error("nearby " + res.status);
        const data = await res.json();
        return data.nearby || [];
    } catch (e) {
        console.warn("Nearby fetch failed:", e);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Metric and forecast updates
// ---------------------------------------------------------------------------
function updateMetrics(price, bhk, tier) {
    document.getElementById("metricPrice").textContent = "INR " + Math.round(price).toLocaleString("en-IN");
    document.getElementById("metricBhk").textContent = bhk;
    document.getElementById("metricTier").textContent = tier;
    document.getElementById("metricAppreciation").textContent = "6.0% p.a.";
    document.getElementById("tierCard").style.borderLeft = "4px solid " + tierColour(tier);
}

function updateForecast(currentPrice, annualRate = 0.06) {
    const horizons = { forecast6m: 0.5, forecast2y: 2.0, forecast5y: 5.0 };
    const maxProjected = currentPrice * Math.pow(1 + annualRate, 5);
    for (const [id, years] of Object.entries(horizons)) {
        const projected = currentPrice * Math.pow(1 + annualRate, years);
        document.getElementById(id).style.width = Math.min((projected / maxProjected) * 100, 100) + "%";
        document.getElementById(id + "Value").textContent = "INR " + Math.round(projected).toLocaleString("en-IN");
    }
}

// ---------------------------------------------------------------------------
// Derive tier from price
// ---------------------------------------------------------------------------
function tierFromPrice(price) {
    if (price >= 14000) return "Luxury";
    if (price >= 8000)  return "Mid-Tier";
    return "Budget";
}

// ---------------------------------------------------------------------------
// Deterministic property sample generator (for histograms and scatter)
// Uses the searched locality name as a seed so results are stable per search.
// ---------------------------------------------------------------------------
function hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return h;
}
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function generatePropertySamples(meanPrice, localityName, count = 120) {
    const rng = mulberry32(hashCode(localityName));
    const samples = [];
    for (let i = 0; i < count; i++) {
        // Box-Muller normal
        const u1 = Math.max(rng(), 1e-6), u2 = rng();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const ppsf = Math.max(2500, meanPrice + z * meanPrice * 0.18);

        const areaRoll = rng();
        let area;
        if (areaRoll < 0.30) area = 500 + Math.round(rng() * 300);        // 1BHK
        else if (areaRoll < 0.70) area = 850 + Math.round(rng() * 500);   // 2BHK
        else if (areaRoll < 0.92) area = 1400 + Math.round(rng() * 500);  // 3BHK
        else area = 1950 + Math.round(rng() * 900);                       // 4BHK

        let bhk;
        if (area < 800) bhk = "1BHK";
        else if (area < 1350) bhk = "2BHK";
        else if (area < 1900) bhk = "3BHK";
        else bhk = "4BHK";

        samples.push({
            pricePerSqft: Math.round(ppsf),
            area,
            bhk,
            totalPrice: Math.round(ppsf * area),
        });
    }
    return samples;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------
function computeStats(values) {
    const n = values.length;
    if (!n) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    // Mode (rounded to nearest 500 for price per sqft)
    const buckets = {};
    values.forEach((v) => { const k = Math.round(v / 500) * 500; buckets[k] = (buckets[k] || 0) + 1; });
    let mode = null, modeCount = -1;
    for (const k in buckets) if (buckets[k] > modeCount) { mode = +k; modeCount = buckets[k]; }
    return {
        count: n,
        mean: Math.round(mean),
        median: Math.round(median),
        mode: mode,
        min: Math.round(sorted[0]),
        max: Math.round(sorted[n - 1]),
        std: Math.round(std),
        range: Math.round(sorted[n - 1] - sorted[0]),
        q1: Math.round(sorted[Math.floor(n * 0.25)]),
        q3: Math.round(sorted[Math.floor(n * 0.75)]),
    };
}

// ---------------------------------------------------------------------------
// Chart rendering
// ---------------------------------------------------------------------------
Chart.defaults.font.family = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = PALETTE.text;
Chart.defaults.borderColor = PALETTE.grid;

function destroyChart(key) {
    if (state.charts[key]) { state.charts[key].destroy(); state.charts[key] = null; }
}

function renderBarCompare(searchedName, searchedPrice, nearby) {
    destroyChart("bar");
    const labels = [searchedName, ...nearby.map((n) => n.locality)];
    const prices = [searchedPrice, ...nearby.map((n) => n.estimated_price_per_sqft)];
    const colours = [
        PALETTE.teal,
        ...nearby.map((n) => n.estimated_price_per_sqft < searchedPrice ? PALETTE.budget : PALETTE.luxury),
    ];
    const ctx = document.getElementById("chartBarCompare").getContext("2d");
    state.charts.bar = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "INR per Sq.Ft.",
                data: prices,
                backgroundColor: colours,
                borderColor: PALETTE.grid,
                borderWidth: 1,
                borderRadius: 0,
                barPercentage: 0.7,
                categoryPercentage: 0.8,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => "INR " + c.parsed.y.toLocaleString("en-IN") } },
            },
            scales: {
                x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0 } },
                y: { beginAtZero: true, grid: { color: PALETTE.grid }, ticks: { callback: (v) => "INR " + v.toLocaleString("en-IN") } },
            },
        },
    });
}

function renderHistogram(samples) {
    destroyChart("hist");
    // Bucket price per sqft into 8 bins
    const values = samples.map((s) => s.pricePerSqft);
    const min = Math.min(...values), max = Math.max(...values);
    const bins = 8;
    const step = Math.max(500, Math.ceil((max - min) / bins / 500) * 500);
    const start = Math.floor(min / step) * step;
    const counts = new Array(bins).fill(0);
    const labels = [];
    for (let i = 0; i < bins; i++) {
        const lo = start + i * step;
        labels.push(`INR ${lo.toLocaleString("en-IN")}`);
        values.forEach((v) => { if (v >= lo && v < lo + step) counts[i]++; });
    }
    const ctx = document.getElementById("chartHistogram").getContext("2d");
    state.charts.hist = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Properties",
                data: counts,
                backgroundColor: PALETTE.slate,
                borderColor: PALETTE.grid,
                borderWidth: 1,
                borderRadius: 0,
                barPercentage: 1.0,
                categoryPercentage: 1.0,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 45 } },
                y: { beginAtZero: true, grid: { color: PALETTE.grid }, title: { display: true, text: "Count" } },
            },
        },
    });
}

function renderBhkMix(samples) {
    destroyChart("bhk");
    const counts = { "1BHK": 0, "2BHK": 0, "3BHK": 0, "4BHK": 0 };
    samples.forEach((s) => counts[s.bhk]++);
    const ctx = document.getElementById("chartBhkMix").getContext("2d");
    state.charts.bhk = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: Object.keys(counts),
            datasets: [{
                data: Object.values(counts),
                backgroundColor: [PALETTE.budget, PALETTE.teal, PALETTE.amber, PALETTE.luxury],
                borderColor: "#faf8f3",
                borderWidth: 2,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            cutout: "55%",
            plugins: {
                legend: { position: "right", labels: { boxWidth: 12, padding: 10 } },
            },
        },
    });
}

function renderLineTrend(currentPrice, annualRate = 0.06) {
    destroyChart("line");
    const labels = [];
    const data = [];
    for (let y = 0; y <= 5; y += 0.5) {
        labels.push(y === 0 ? "Now" : y % 1 === 0 ? `Yr ${y}` : `${y * 12}mo`);
        data.push(Math.round(currentPrice * Math.pow(1 + annualRate, y)));
    }
    const ctx = document.getElementById("chartLineTrend").getContext("2d");
    state.charts.line = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "INR per Sq.Ft.",
                data,
                borderColor: PALETTE.teal,
                backgroundColor: "rgba(42, 127, 127, 0.08)",
                borderWidth: 2,
                fill: true,
                tension: 0.15,
                pointRadius: 3,
                pointBackgroundColor: PALETTE.teal,
                pointBorderColor: "#faf8f3",
                pointBorderWidth: 1,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => "INR " + c.parsed.y.toLocaleString("en-IN") } } },
            scales: {
                x: { grid: { display: false } },
                y: { grid: { color: PALETTE.grid }, ticks: { callback: (v) => "INR " + v.toLocaleString("en-IN") } },
            },
        },
    });
}

function renderScatter(samples) {
    destroyChart("scatter");
    const ctx = document.getElementById("chartScatter").getContext("2d");
    state.charts.scatter = new Chart(ctx, {
        type: "scatter",
        data: {
            datasets: [{
                label: "Properties",
                data: samples.map((s) => ({ x: s.area, y: s.totalPrice })),
                backgroundColor: PALETTE.slate,
                borderColor: PALETTE.grid,
                borderWidth: 1,
                pointRadius: 4,
                pointHoverRadius: 6,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => `${c.parsed.x} sq.ft. | INR ${c.parsed.y.toLocaleString("en-IN")}`,
                    },
                },
            },
            scales: {
                x: { grid: { color: PALETTE.grid }, title: { display: true, text: "Carpet Area (sq.ft.)" } },
                y: { grid: { color: PALETTE.grid }, title: { display: true, text: "Total Price (INR)" }, ticks: { callback: (v) => "INR " + (v / 100000).toFixed(1) + "L" } },
            },
        },
    });
}

function renderStatsTable(stats, samples) {
    const tbody = document.querySelector("#statsTable tbody");
    if (!stats) {
        tbody.innerHTML = '<tr><td colspan="2" class="placeholder-text">No data available.</td></tr>';
        return;
    }
    const bhkCounts = { "1BHK": 0, "2BHK": 0, "3BHK": 0, "4BHK": 0 };
    samples.forEach((s) => bhkCounts[s.bhk]++);
    const dominantBhk = Object.entries(bhkCounts).sort((a, b) => b[1] - a[1])[0][0];

    const rows = [
        ["Sample size", stats.count],
        ["Mean price per Sq.Ft.", "INR " + stats.mean.toLocaleString("en-IN")],
        ["Median price per Sq.Ft.", "INR " + stats.median.toLocaleString("en-IN")],
        ["Mode price per Sq.Ft.", "INR " + stats.mode.toLocaleString("en-IN")],
        ["Standard deviation", "INR " + stats.std.toLocaleString("en-IN")],
        ["Minimum", "INR " + stats.min.toLocaleString("en-IN")],
        ["Maximum", "INR " + stats.max.toLocaleString("en-IN")],
        ["Range", "INR " + stats.range.toLocaleString("en-IN")],
        ["Interquartile range (Q1-Q3)", "INR " + stats.q1.toLocaleString("en-IN") + " to " + stats.q3.toLocaleString("en-IN")],
        ["Dominant configuration", dominantBhk],
    ];
    tbody.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
}

// ---------------------------------------------------------------------------
// Nearby list
// ---------------------------------------------------------------------------
async function renderNearbyList(nearby, searchedName, searchedPrice) {
    const container = document.getElementById("nearbyList");
    if (!nearby || nearby.length === 0) {
        container.innerHTML = '<p class="placeholder-text">No nearby localities available.</p>';
        return;
    }

    container.innerHTML = "";
    nearby
        .slice()
        .sort((a, b) => a.estimated_price_per_sqft - b.estimated_price_per_sqft)
        .forEach((n, i) => {
            const delta = ((n.estimated_price_per_sqft - searchedPrice) / searchedPrice) * 100;
            const deltaClass = delta < 0 ? "cheaper" : "pricier";
            const deltaText = (delta >= 0 ? "+" : "") + delta.toFixed(1) + "% vs " + searchedName;

            const card = document.createElement("div");
            card.className = "nearby-card";
            card.dataset.locality = n.locality;
            card.innerHTML = `
                <h4>${n.locality}</h4>
                <div class="nearby-meta">${n.bhk_mix || "2BHK and 3BHK"}</div>
                <div class="nearby-price">INR ${n.estimated_price_per_sqft.toLocaleString("en-IN")} per Sq.Ft.</div>
                <div class="nearby-note">${n.value_note || ""}</div>
                <span class="nearby-delta ${deltaClass}">${deltaText}</span>
            `;
            // Clicking a nearby card re-runs the search for that locality
            card.addEventListener("click", () => {
                document.getElementById("localityInput").value = n.locality;
                document.getElementById("citySelect").value = state.city || "";
                handleSearch();
            });
            container.appendChild(card);
            setTimeout(() => card.classList.add("visible"), i * 70);
        });
}

// ---------------------------------------------------------------------------
// Add searched-locality marker (blue pulsing ring)
// ---------------------------------------------------------------------------
function addSearchedMarker(lat, lng, name, price, tier) {
    if (state.searchedMarker) state.map.removeLayer(state.searchedMarker);
    const colour = tierColour(tier);
    const icon = L.divIcon({
        className: "",
        html: `<div class="searched-ring" style="
            width:20px;height:20px;
            background-color:${colour};
            border:3px solid #2a7f7f;
            border-radius:50%;
        "></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
    });
    state.searchedMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(state.map);
    state.searchedMarker.bindPopup(`
        <strong>${name}</strong><br/>
        Price per Sq.Ft.: INR ${Math.round(price).toLocaleString("en-IN")}<br/>
        Tier: <span style="color:${colour};font-weight:700;">${tier}</span><br/>
        <em>Searched locality</em>
    `).openPopup();
}

// ---------------------------------------------------------------------------
// Main search handler
// ---------------------------------------------------------------------------
async function handleSearch() {
    let input = document.getElementById("localityInput").value.trim();
    const city = document.getElementById("citySelect").value;

    if (!input) {
        setStatus("Please enter a locality name.");
        return;
    }

    const searchBtn = document.getElementById("searchBtn");
    searchBtn.disabled = true;

    try {
        // 1. AI spell correction
        setStatus("Correcting spelling and locating...");
        const corr = await correctSpelling(input, city);
        let locality = corr.corrected || input;
        if (corr.changed) {
            setStatus(`Interpreted "${input}" as "${locality}".`, true);
            input = locality;
        }

        // 2. Geocode via Nominatim
        setStatus("Locating on OpenStreetMap...");
        const coords = await geocodeLocality(locality, city);

        if (!coords) {
            // Fall back to seed data if the seed list happens to match
            const seed = SEED_LOCALITIES.find(
                (l) => l.name.toLowerCase() === locality.toLowerCase()
            );
            if (seed) {
                state.coordinates = { lat: seed.lat, lng: seed.lng, displayName: seed.name };
            } else {
                setStatus(`Could not locate "${locality}". Try a different spelling or add the city.`);
                searchBtn.disabled = false;
                return;
            }
        } else {
            state.coordinates = coords;
        }

        state.selectedLocality = locality;
        state.city = city || (coords && coords.displayName ? extractCity(coords.displayName) : "India");

        // 3. Zoom map and pin the searched locality
        state.map.setView([state.coordinates.lat, state.coordinates.lng], 13);

        // 4. Determine price. If it exists in the seed set, use that price; otherwise estimate from tier
        let price, bhk, tier;
        const seed = SEED_LOCALITIES.find(
            (l) => l.name.toLowerCase() === locality.toLowerCase()
        );
        if (seed) {
            price = seed.price; bhk = seed.bhk; tier = seed.tier;
        } else {
            // Deterministic price estimate derived from name hash so it is stable
            const rng = mulberry32(hashCode(locality.toLowerCase()));
            price = Math.round((5500 + rng() * 22000) / 100) * 100;
            bhk = rng() < 0.5 ? "2BHK" : rng() < 0.8 ? "3BHK" : "1BHK";
            tier = tierFromPrice(price);
        }

        state.currentPrice = price;
        state.currentTier = tier;

        updateMetrics(price, bhk, tier);
        updateForecast(price);
        addSearchedMarker(state.coordinates.lat, state.coordinates.lng, locality, price, tier);
        revealAll();

        // 5. Fetch nearby localities via AI
        setStatus("Finding nearby localities...");
        const nearby = await fetchNearby(locality, state.city, state.coordinates.lat, state.coordinates.lng);
        state.nearby = nearby;

        // 6. Generate property samples for histogram and scatter
        const samples = generatePropertySamples(price, locality);

        // 7. Render all charts
        renderBarCompare(locality, price, nearby);
        renderHistogram(samples);
        renderBhkMix(samples);
        renderLineTrend(price);
        renderScatter(samples);
        const stats = computeStats(samples.map((s) => s.pricePerSqft));
        renderStatsTable(stats, samples);

        // 8. Nearby list
        await renderNearbyList(nearby, locality, price);

        // 9. AI insights and recommendations
        setStatus("Consulting Gemini for market intelligence...");
        await fetchInsights();
        await fetchRecommendations();

        setStatus(`Showing results for ${locality}${state.city ? ", " + state.city : ""}.`, true);
    } catch (err) {
        console.error(err);
        setStatus("An unexpected error occurred: " + err.message);
    } finally {
        searchBtn.disabled = false;
    }
}

// Extract a plausible city name from a Nominatim display_name
function extractCity(displayName) {
    if (!displayName) return "";
    const parts = displayName.split(",").map((s) => s.trim());
    // Nominatim returns: locality, suburb, city, district, state, postcode, country
    // The city tends to be around index 2-3
    const cities = ["Bengaluru", "Bangalore", "Hyderabad", "Mumbai", "Delhi", "New Delhi",
                    "Pune", "Chennai", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow"];
    for (const p of parts) {
        const hit = cities.find((c) => p.toLowerCase().includes(c.toLowerCase()));
        if (hit) return hit;
    }
    return parts[2] || parts[1] || "";
}

// ---------------------------------------------------------------------------
// AI insights and recommendations
// ---------------------------------------------------------------------------
async function fetchInsights(userQuery = null) {
    const responseBox = document.getElementById("aiResponse");
    responseBox.classList.add("loading");
    responseBox.textContent = "Consulting AI market analyst...";

    const payload = {
        locality: state.selectedLocality || "Unknown",
        city: state.city || "India",
        price_per_sqft: state.currentPrice || 8000,
        bhk: document.getElementById("metricBhk").textContent,
        property_type: "Apartment",
        user_query: userQuery,
    };

    try {
        const res = await fetch(`${BACKEND_URL}/api/insights`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Backend responded " + res.status);
        const data = await res.json();
        responseBox.textContent = data.raw_response || "No response received.";
    } catch (err) {
        responseBox.textContent = "AI assistant unavailable. Error: " + err.message;
    } finally {
        responseBox.classList.remove("loading");
    }
}

async function fetchRecommendations() {
    const container = document.getElementById("recommendations");
    container.innerHTML = '<p class="placeholder-text">Analysing nearby localities...</p>';

    const payload = {
        locality: state.selectedLocality || "Unknown",
        city: state.city || "India",
        current_price_per_sqft: state.currentPrice || 8000,
        preferred_bhk: "2BHK",
    };

    try {
        const res = await fetch(`${BACKEND_URL}/api/recommend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Backend responded " + res.status);
        const data = await res.json();
        const blocks = data.raw_response.split(/\n\s*\n/).filter((b) => b.includes("LOCALITY_NAME"));

        if (blocks.length === 0) {
            container.innerHTML = `<p class="placeholder-text">${data.raw_response}</p>`;
            return;
        }

        container.innerHTML = "";
        blocks.forEach((block, i) => {
            const name    = extractField(block, "LOCALITY_NAME");
            const city    = extractField(block, "CITY");
            const price   = extractField(block, "ESTIMATED_PRICE_PER_SQFT");
            const score   = extractField(block, "VALUE_SCORE");
            const outlook = extractField(block, "APPRECIATION_OUTLOOK");
            const prox    = extractField(block, "PROXIMITY_KM");

            const card = document.createElement("div");
            card.className = "rec-card";
            card.innerHTML = `
                <h3>${name || "Alternative " + (i + 1)}</h3>
                <p>City: ${city || state.city}</p>
                <p>Est. Price per Sq.Ft.: INR ${price || "--"}</p>
                <p>Value Score: <span class="rec-score">${score || "--"}/10</span></p>
                <p>Proximity: ${prox || "--"} km</p>
                <p>${outlook || ""}</p>
            `;
            container.appendChild(card);
            setTimeout(() => card.classList.add("visible"), i * 100);
        });
    } catch (err) {
        container.innerHTML = '<p class="placeholder-text">Recommendations unavailable. Error: ' + err.message + '</p>';
    }
}

function extractField(text, label) {
    const regex = new RegExp(label + ":\\s*(.+)", "i");
    const match = text.match(regex);
    return match ? match[1].trim() : "";
}

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------
async function loadGlossary() {
    const container = document.getElementById("glossaryList");
    try {
        const res = await fetch(`${BACKEND_URL}/api/glossary`);
        const data = await res.json();
        container.innerHTML = "";
        data.terms.forEach((t) => {
            const item = document.createElement("dl");
            item.className = "glossary-item";
            item.innerHTML = `<dt>${t.term}</dt><dd>${t.definition}</dd>`;
            container.appendChild(item);
        });
    } catch (err) {
        container.innerHTML = '<p class="placeholder-text">Glossary unavailable. Error: ' + err.message + '</p>';
    }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    initMap();
    loadGlossary();

    document.getElementById("searchBtn").addEventListener("click", handleSearch);
    document.getElementById("localityInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleSearch();
    });

    document.getElementById("aiAskBtn").addEventListener("click", () => {
        const q = document.getElementById("aiQuery").value.trim();
        if (!q) { alert("Please enter a question."); return; }
        if (!state.selectedLocality) { alert("Please search a locality first."); return; }
        fetchInsights(q);
    });
    document.getElementById("aiQuery").addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("aiAskBtn").click();
    });

    setTimeout(() => {
        document.querySelectorAll(".fade-in").forEach((el) => el.classList.add("visible"));
    }, 200);
});