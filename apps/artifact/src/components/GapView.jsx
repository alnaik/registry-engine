import { T } from "../theme.js";

export function GapView({ rows }) {
  if (!rows || rows.length === 0) {
    return <div className="text-center py-8 text-gray-400">Run a search to see gap data</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="pb-2 pr-4">Zip</th><th className="pb-2 pr-4">Keyword</th>
            <th className="pb-2 pr-4">Entities</th><th className="pb-2 pr-4">Population</th>
            <th className="pb-2">Density (per 1k)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-2 pr-4 font-mono">{r.zipCode}</td>
              <td className="py-2 pr-4">{r.keyword}</td>
              <td className="py-2 pr-4">{r.entityCount}</td>
              <td className="py-2 pr-4">{r.population > 0 ? r.population.toLocaleString() : "—"}</td>
              <td className="py-2">{r.density.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
