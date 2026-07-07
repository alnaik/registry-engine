import { T } from "../theme.js";
import { useState } from "react";

function exportCsv(leads) {
  const headers = ["Name", "City", "Zip", "Score", "Web Presence", "Rationale", "Contact", "Formed"];
  const rows = leads.map(l => [
    csvCell(l.entity.name), csvCell(l.entity.city), csvCell(l.entity.zipCode),
    l.score, l.webPresence, csvCell(l.rationale), csvCell(l.contact ?? ""), l.entity.formDate.slice(0, 10),
  ]);
  const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "registry-leads.csv"; a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? "");
  // CSV injection protection: prefix formula-starting chars with '
  const safe = s.startsWith("=") || s.startsWith("+") || s.startsWith("-") || s.startsWith("@") ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function ResultsTable({ leads, classifyMap, onSelectLead, onQualify, onFeedback, feedbackMap, selectedIds, onToggleSelect }) {
  const [noWebOnly, setNoWebOnly] = useState(false);
  const [triggerFilter, setTriggerFilter] = useState("all");
  const [minScore, setMinScore] = useState(0);

  const filtered = leads.filter(l => {
    if (noWebOnly && l.webPresence !== "none") return false;
    if (triggerFilter !== "all" && !l.signals.some(s => s.type === triggerFilter)) return false;
    if (l.score < minScore) return false;
    return true;
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={noWebOnly} onChange={e => setNoWebOnly(e.target.checked)} className="rounded" />
          No web presence only
        </label>
        <select className="px-2 py-1 text-sm border border-gray-300 rounded" value={triggerFilter} onChange={e => setTriggerFilter(e.target.value)}>
          <option value="all">All triggers</option>
          <option value="NEW_FILING">New filings</option>
          <option value="STATUS_CHANGE">Status changes</option>
          <option value="NEW_TRADE_NAME">New trade names</option>
        </select>
        <div className="flex items-center gap-1.5 text-sm text-gray-700">
          <span>Min score:</span>
          <input type="range" min="0" max="100" value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="w-24" />
          <span>{minScore}</span>
        </div>
        <div className="ml-auto flex gap-2">
          {selectedIds.size > 0 && <button className={T.btn.primary} onClick={() => onQualify([...selectedIds])}>Qualify {selectedIds.size} selected</button>}
          {leads.length > 0 && <button className={T.btn.secondary} onClick={() => exportCsv(leads)}>Export CSV</button>}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No results match filters</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="pb-2 pr-3 w-8"></th>
                <th className="pb-2 pr-3 w-16">Score</th>
                <th className="pb-2 pr-3">Name</th>
                <th className="pb-2 pr-3">City</th>
                <th className="pb-2 pr-3">Triggers</th>
                <th className="pb-2 pr-3">Web</th>
                <th className="pb-2">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => (
                <ResultRow key={lead.entity.id} lead={lead}
                  selected={selectedIds.has(lead.entity.id)}
                  onToggle={() => onToggleSelect(lead.entity.id)}
                  onSelect={() => onSelectLead(lead)}
                  feedback={feedbackMap[lead.entity.id]}
                  onFeedback={v => onFeedback(lead, v)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultRow({ lead, selected, onToggle, onSelect, feedback, onFeedback }) {
  const scoreColor = lead.score >= 70 ? "text-green-700" : lead.score >= 40 ? "text-yellow-700" : "text-gray-500";
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="py-2 pr-3"><input type="checkbox" checked={selected} onChange={onToggle} className="rounded" /></td>
      <td className={`py-2 pr-3 font-semibold ${scoreColor}`}>{lead.score}</td>
      <td className="py-2 pr-3">
        <button className="text-left hover:text-blue-600 font-medium" onClick={onSelect}>{lead.entity.name}</button>
        {lead.entity.tradeNames.length > 0 && <div className="text-xs text-gray-400">DBA: {lead.entity.tradeNames[0].description}</div>}
      </td>
      <td className="py-2 pr-3 text-gray-600">{lead.entity.city}</td>
      <td className="py-2 pr-3">
        <div className="flex flex-wrap gap-1">
          {lead.signals.map((s, i) => (
            <span key={i} className={T.badge[s.type === "NEW_FILING" ? "green" : s.type === "STATUS_CHANGE" ? "red" : "blue"]}>
              {s.type === "NEW_FILING" ? "New" : s.type === "STATUS_CHANGE" ? "Status" : "Trade"}
            </span>
          ))}
        </div>
      </td>
      <td className="py-2 pr-3">
        <span className={T.badge[lead.webPresence === "found" ? "green" : "gray"]}>
          {lead.webPresence === "found" ? "Web" : "No web"}
        </span>
      </td>
      <td className="py-2">
        <div className="flex gap-1">
          <button onClick={() => onFeedback("approved")} className={`text-lg ${feedback === "approved" ? "opacity-100" : "opacity-30 hover:opacity-70"}`}>+1</button>
          <button onClick={() => onFeedback("rejected")} className={`text-lg ${feedback === "rejected" ? "opacity-100" : "opacity-30 hover:opacity-70"}`}>-1</button>
        </div>
      </td>
    </tr>
  );
}
