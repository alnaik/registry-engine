import { T } from "../theme.js";
import { useState } from "react";

export function SearchSetup({ profiles, selectedProfile, onSelectProfile, onEditProfile, onRun, running }) {
  const [locMode, setLocMode] = useState("zip");
  const [zipsInput, setZipsInput] = useState("80202, 80203, 80204");
  const [lat, setLat] = useState("39.7392");
  const [lng, setLng] = useState("-104.9903");
  const [radius, setRadius] = useState("8000");
  const [recentDays, setRecentDays] = useState("");

  function buildQuery() {
    if (locMode === "zip") {
      const zips = zipsInput.split(",").map(z => z.trim()).filter(Boolean);
      return { mode: "zip", zips };
    }
    return { mode: "radius", lat: parseFloat(lat), lng: parseFloat(lng), radiusMeters: parseFloat(radius) };
  }

  function handleRun() {
    const query = buildQuery();
    const filters = {};
    if (recentDays) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(recentDays, 10));
      filters.formDateAfter = d.toISOString();
    }
    onRun(query, filters);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className={T.card}>
        <div className={`${T.heading.md} mb-3`}>Profile</div>
        <div className="flex gap-2 flex-wrap">
          {profiles.map(p => (
            <button key={p.id} onClick={() => onSelectProfile(p)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${selectedProfile?.id === p.id ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"}`}>
              {p.name}
            </button>
          ))}
          <button className={T.btn.ghost} onClick={() => onEditProfile(null)}>+ New</button>
        </div>
        {selectedProfile && (
          <div className="mt-3 text-sm text-gray-600 flex items-start justify-between gap-2">
            <span className="italic">{selectedProfile.description}</span>
            <button className="text-blue-600 hover:underline text-xs shrink-0" onClick={() => onEditProfile(selectedProfile)}>Edit</button>
          </div>
        )}
      </div>

      <div className={T.card}>
        <div className={`${T.heading.md} mb-3`}>Location</div>
        <div className="flex gap-2 mb-3">
          {["zip", "radius"].map(m => (
            <button key={m} onClick={() => setLocMode(m)}
              className={`px-3 py-1 rounded text-sm border ${locMode === m ? "bg-blue-600 text-white border-blue-600" : "bg-white border-gray-300 text-gray-600"}`}>
              {m === "zip" ? "Zip list" : "Radius"}
            </button>
          ))}
        </div>
        {locMode === "zip" ? (
          <div>
            <label className={T.label}>Zip codes (comma-separated)</label>
            <input className={T.input} value={zipsInput} onChange={e => setZipsInput(e.target.value)} placeholder="80202, 80203" />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1"><label className={T.label}>Lat</label><input className={T.input} value={lat} onChange={e => setLat(e.target.value)} /></div>
              <div className="flex-1"><label className={T.label}>Lng</label><input className={T.input} value={lng} onChange={e => setLng(e.target.value)} /></div>
            </div>
            <div><label className={T.label}>Radius (meters)</label><input className={T.input} value={radius} onChange={e => setRadius(e.target.value)} /></div>
          </div>
        )}
      </div>

      <div className={T.card}>
        <div className={`${T.heading.md} mb-3`}>Filters</div>
        <div>
          <label className={T.label}>Formed in last N days (leave blank for all)</label>
          <input className={T.input} type="number" value={recentDays} onChange={e => setRecentDays(e.target.value)} placeholder="e.g. 90" />
        </div>
      </div>

      <button className={`${T.btn.primary} w-full py-3 text-base`} onClick={handleRun} disabled={running || !selectedProfile}>
        {running ? "Running..." : "Run Search"}
      </button>
    </div>
  );
}
