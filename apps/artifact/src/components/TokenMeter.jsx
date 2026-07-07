import { T } from "../theme.js";

export function TokenMeter({ input, output, budgetInput }) {
  const pct = budgetInput > 0 ? Math.min(100, Math.round((input / budgetInput) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <span>Tokens in: {input.toLocaleString()}</span>
      <span>out: {output.toLocaleString()}</span>
      {budgetInput > 0 && (
        <div className="flex items-center gap-1">
          <div className="w-24 h-1.5 bg-gray-200 rounded">
            <div className={`h-1.5 rounded ${pct > 80 ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
          </div>
          <span>{pct}%</span>
        </div>
      )}
    </div>
  );
}
