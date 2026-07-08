import { useState, useEffect, useRef, useCallback } from "react";
import { ColoradoRegistrySource, resolveAddress } from "@registry-engine/registry-core";
import { ArtifactBackend, TokenBudgeter, runSearch, assembleBrief, draftOutreach } from "@registry-engine/qualify";
import { WindowStorageCache } from "./storage.js";

const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = LEAFLET_CSS;
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = LEAFLET_JS;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error("leaflet failed to load"));
    document.body.appendChild(s);
  });
}

export default function App() {
  const [city, setCity] = useState("Denver");
  const [center, setCenter] = useState(null);          // {lat, lng}
  const [radiusKm, setRadiusKm] = useState(8);
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("idle");          // idle | locating | searching | done
  const [leads, setLeads] = useState([]);
  const [candidates, setCandidates] = useState(0);
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);      // {lead, brief}
  const [opener, setOpener] = useState(null);          // null | "loading" | text
  const [mapOk, setMapOk] = useState(true);

  const mapRef = useRef(null);
  const circleRef = useRef(null);
  const cacheRef = useRef(new WindowStorageCache());
  const budgeterRef = useRef(null);

  const locate = useCallback(async () => {
    if (!city.trim()) return;
    setPhase("locating");
    setError(null);
    const coords = await resolveAddress(`${city.trim()}, CO`);
    setPhase("idle");
    if (!coords) { setError(`Could not find "${city}" — try another city name.`); return; }
    setCenter(coords);
  }, [city]);

  // Map lifecycle: create once a center exists, keep circle in sync.
  useEffect(() => {
    if (!center || !mapOk) return;
    let cancelled = false;
    loadLeaflet().then(L => {
      if (cancelled) return;
      if (!mapRef.current) {
        const map = L.map("geofence-map").setView([center.lat, center.lng], 11);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
        }).addTo(map);
        const circle = L.circle([center.lat, center.lng], { radius: radiusKm * 1000, color: "#2563eb" }).addTo(map);
        map.on("click", e => {
          circle.setLatLng(e.latlng);
          setCenter({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
        mapRef.current = map;
        circleRef.current = circle;
      } else {
        mapRef.current.setView([center.lat, center.lng]);
        circleRef.current.setLatLng([center.lat, center.lng]);
      }
    }).catch(() => setMapOk(false));
    return () => { cancelled = true; };
  }, [center, mapOk]);

  useEffect(() => {
    if (circleRef.current) circleRef.current.setRadius(radiusKm * 1000);
  }, [radiusKm]);

  const upsertLead = useCallback(lead => {
    const copy = { ...lead };
    setLeads(prev => {
      const i = prev.findIndex(l => l.entity.id === copy.entity.id);
      const next = i >= 0 ? prev.map((l, j) => (j === i ? copy : l)) : [...prev, copy];
      return next.slice().sort((a, b) =>
        (b.verified ? b.score : -1) - (a.verified ? a.score : -1));
    });
  }, []);

  const search = useCallback(async () => {
    if (!center || !query.trim()) return;
    setPhase("searching");
    setLeads([]);
    setCandidates(0);
    setSelected(null);
    setError(null);
    const budgeter = new TokenBudgeter(new ArtifactBackend(), { maxInputTokensPerRun: 150000 });
    budgeterRef.current = budgeter;
    try {
      await runSearch({
        query: query.trim(),
        source: new ColoradoRegistrySource(),
        location: { mode: "radius", lat: center.lat, lng: center.lng, radiusMeters: radiusKm * 1000 },
        budgeter,
        cache: cacheRef.current,
        autoVerify: 10,
        onEvent: e => {
          if (e.type === "candidates") setCandidates(e.count);
          else if (e.type === "lead" || e.type === "update") upsertLead(e.lead);
          else if (e.type === "budget") setTokens({ input: e.input, output: e.output });
          else if (e.type === "error") setError(e.message);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setPhase("done");
  }, [center, query, radiusKm, upsertLead]);

  const open = useCallback(lead => {
    setOpener(null);
    setSelected({ lead, brief: assembleBrief(lead) });
  }, []);

  const drawOpener = useCallback(async () => {
    if (!selected || !budgeterRef.current) return;
    setOpener("loading");
    try {
      setOpener(await draftOutreach(selected.lead, budgeterRef.current));
    } catch (err) {
      setOpener(`Could not draft: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [selected]);

  const searching = phase === "searching";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <h1 className="text-xl font-semibold">Registry Engine</h1>

        {/* Location */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="flex gap-2">
            <input
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
              value={city}
              onChange={e => setCity(e.target.value)}
              onKeyDown={e => e.key === "Enter" && locate()}
              placeholder="City in Colorado"
            />
            <button
              className="px-4 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
              onClick={locate}
              disabled={phase === "locating"}
            >
              {phase === "locating" ? "Locating…" : "Set location"}
            </button>
          </div>

          {center && mapOk && <div id="geofence-map" className="h-64 rounded border border-gray-200" />}
          {center && !mapOk && (
            <div className="text-sm text-gray-600 bg-gray-100 rounded p-3">
              Map unavailable in this environment — using {city} center ({center.lat.toFixed(3)}, {center.lng.toFixed(3)}) with the radius below.
            </div>
          )}
          {center && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-gray-600 whitespace-nowrap">Radius: {radiusKm} km</span>
              <input type="range" min="1" max="40" value={radiusKm}
                onChange={e => setRadiusKm(parseInt(e.target.value, 10))} className="flex-1" />
            </div>
          )}
          {center && mapOk && <div className="text-xs text-gray-400">Click the map to move the search circle.</div>}
        </div>

        {/* Query */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !searching && search()}
            placeholder='What are you looking for? e.g. "jewelers that use princess cut diamonds"'
          />
          <button
            className="w-full py-2.5 rounded bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
            onClick={search}
            disabled={!center || !query.trim() || searching}
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}

        {/* Results */}
        {(searching || leads.length > 0 || phase === "done") && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span>{candidates} registry matches · {leads.length} leads{searching ? " · searching…" : ""}</span>
              {tokens && <span>{tokens.input.toLocaleString()} in / {tokens.output.toLocaleString()} out tokens</span>}
            </div>
            {leads.length === 0 && phase === "done" && (
              <div className="text-sm text-gray-500">No matches. Try a broader query or larger radius.</div>
            )}
            <ul className="divide-y divide-gray-100">
              {leads.map(lead => (
                <li key={lead.entity.id}
                  className="py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-50 px-1 rounded"
                  onClick={() => open(lead)}>
                  <span className={`w-12 text-center text-xs font-semibold rounded px-1 py-0.5 ${
                    !lead.verified ? "bg-gray-100 text-gray-500"
                      : lead.score >= 70 ? "bg-green-100 text-green-700"
                      : lead.score >= 40 ? "bg-yellow-100 text-yellow-700"
                      : "bg-gray-200 text-gray-600"}`}>
                    {lead.verified ? `${lead.score}` : "…"}
                  </span>
                  <span className="flex-1 text-sm">{lead.entity.name}</span>
                  <span className="text-xs text-gray-500">{lead.entity.city}</span>
                  {lead.verified && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${lead.webPresence === "found" ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"}`}>
                      {lead.webPresence === "found" ? "web" : "no web"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Brief panel */}
      {selected && (
        <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <span className="font-medium text-sm">{selected.lead.entity.name}</span>
            <button className="text-gray-400 hover:text-gray-600" onClick={() => setSelected(null)}>✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <pre className="text-xs whitespace-pre-wrap font-mono text-gray-700">{selected.brief.text}</pre>
            <div>
              <button
                className="px-3 py-1.5 rounded border border-gray-300 text-sm disabled:opacity-50"
                onClick={drawOpener}
                disabled={opener === "loading" || !budgeterRef.current}
              >
                {opener === "loading" ? "Drafting…" : "Draft opener"}
              </button>
              {opener && opener !== "loading" && (
                <p className="mt-2 text-sm text-gray-700 bg-gray-50 rounded p-3">{opener}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
