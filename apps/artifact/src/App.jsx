import { useState, useCallback } from "react";
import { search, MAX_LLM_CALLS_PER_SEARCH } from "@registry-engine/qualify";

// v3 socket UI: one screen, five verbs. All heavy lifting happens in the
// engine; this component just streams its events into view.

const PLANE_COLORS = {
  existence: "bg-blue-50 text-blue-700",
  category: "bg-green-50 text-green-700",
  contact: "bg-purple-50 text-purple-700",
};

export default function App() {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | searching | done
  const [mapResult, setMapResult] = useState(null);
  const [routed, setRouted] = useState([]);
  const [fetchLog, setFetchLog] = useState([]);
  const [leads, setLeads] = useState([]);
  const [llmCalls, setLlmCalls] = useState(0);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null); // lead entity id

  const run = useCallback(async () => {
    if (!query.trim() || phase === "searching") return;
    setPhase("searching");
    setMapResult(null); setRouted([]); setFetchLog([]); setLeads([]); setError(null); setOpen(null); setLlmCalls(0);
    try {
      const out = await search(query.trim(), {
        onEvent: e => {
          if (e.type === "map") setMapResult(e.map);
          else if (e.type === "routed") setRouted(e.sources);
          else if (e.type === "fetched") setFetchLog(prev => [...prev, `${e.sourceId}: ${e.count} records`]);
          else if (e.type === "source_error") setFetchLog(prev => [...prev, `${e.sourceId}: error — ${e.message}`]);
          else if (e.type === "done") setLeads(e.leads);
        },
      });
      setLlmCalls(out.llmCalls);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setPhase("done");
  }, [query, phase]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">Registry Engine</h1>
          <span className="text-xs text-gray-400">gov registries in · ranked leads out</span>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <input
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && run()}
            placeholder='e.g. "yukon gold potato supplier near me" or "jewelers in Denver"'
          />
          <button
            className="w-full py-2.5 rounded bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
            onClick={run}
            disabled={!query.trim() || phase === "searching"}
          >
            {phase === "searching" ? "Searching…" : "Search"}
          </button>
        </div>

        {mapResult && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-gray-500 text-xs">understood as</span>
              {mapResult.intent.categories.map(c => (
                <span key={c} className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-xs">{c}</span>
              ))}
              <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">
                {mapResult.intent.geo.cities.length > 0 ? mapResult.intent.geo.cities.join(", ") : mapResult.intent.geo.region}
              </span>
              <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">
                {mapResult.intent.direction === "buy" ? "buying from leads" : "selling to leads"}
              </span>
              <span className="text-xs text-gray-400 ml-auto">
                {llmCalls}/{MAX_LLM_CALLS_PER_SEARCH} LLM calls{mapResult.usedLlm ? "" : " (map: 0 — static table)"}
              </span>
            </div>
            {routed.length > 0 && (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-gray-500 text-xs">routed to</span>
                {routed.map(s => (
                  <span key={s.id} className={`px-2 py-0.5 rounded text-xs ${PLANE_COLORS[s.plane] ?? "bg-gray-100"}`}>
                    {s.id} · {s.plane}
                  </span>
                ))}
                <span className="text-xs text-gray-400">{fetchLog.join(" · ")}</span>
              </div>
            )}
            {mapResult.caveats.length > 0 && (
              <ul className="text-xs text-amber-700 bg-amber-50 rounded p-2 space-y-1">
                {mapResult.caveats.map((c, i) => <li key={i}>⚠ {c}</li>)}
              </ul>
            )}
          </div>
        )}

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}

        {(leads.length > 0 || phase === "done") && (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {leads.length === 0 && phase === "done" && !error && (
              <div className="p-4 text-sm text-gray-500">No leads. Try a broader query.</div>
            )}
            {leads.map(lead => {
              const e = lead.entity;
              const isOpen = open === e.id;
              return (
                <div key={e.id} className="p-3">
                  <div className="flex items-center gap-3 cursor-pointer" onClick={() => setOpen(isOpen ? null : e.id)}>
                    <span className={`w-10 text-center text-xs font-semibold rounded px-1 py-0.5 ${
                      lead.score >= 60 ? "bg-green-100 text-green-700"
                        : lead.score >= 30 ? "bg-yellow-100 text-yellow-700"
                        : "bg-gray-100 text-gray-500"}`}>
                      {lead.score}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{e.name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {[e.address.city, e.status].filter(Boolean).join(" · ")}
                        {e.names.length > 0 ? ` · aka ${e.names[0]}` : ""}
                      </div>
                    </div>
                    {e.source_ids.map(s => (
                      <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{s}</span>
                    ))}
                    {e.contacts.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">contact</span>}
                  </div>
                  {isOpen && (
                    <div className="mt-3 ml-13 pl-1 space-y-2 text-sm">
                      <p className="text-gray-700">{lead.brief}</p>
                      {e.contacts.length > 0 && (
                        <div className="text-xs text-gray-600">Contacts: {e.contacts.join(" · ")}</div>
                      )}
                      <ul className="text-xs text-gray-400 space-y-0.5">
                        {e.evidence.map((ev, i) => (
                          <li key={i}>[{ev.source}] {ev.field}: {ev.value}{ev.note ? ` — ${ev.note}` : ""}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
