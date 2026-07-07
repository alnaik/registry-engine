import { T } from "../theme.js";

export function VitalityView({ rows }) {
  if (!rows || rows.length === 0) {
    return <div className="text-center py-8 text-gray-400">Run a search to see vitality data</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="pb-2 pr-4">Zip</th><th className="pb-2 pr-4">Keyword</th>
            <th className="pb-2 pr-4">Formed 90d</th><th className="pb-2 pr-4">Dissolved 90d</th>
            <th className="pb-2 pr-4">Formed 365d</th><th className="pb-2">Dissolved 365d</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-2 pr-4 font-mono">{r.zipCode}</td>
              <td className="py-2 pr-4">{r.keyword}</td>
              <td className="py-2 pr-4 text-green-700">{r.formations90d}</td>
              <td className="py-2 pr-4 text-red-600">{r.dissolutions90d}</td>
              <td className="py-2 pr-4 text-green-700">{r.formations365d}</td>
              <td className="py-2 text-red-600">{r.dissolutions365d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
