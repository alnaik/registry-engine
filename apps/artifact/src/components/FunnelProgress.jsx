import { T } from "../theme.js";

const STAGES = ["prefilter", "classify", "qualify", "done"];

export function FunnelProgress({ counts, currentStage, tokenInput, tokenOutput, budgetInput }) {
  return (
    <div className={T.card}>
      <div className={`${T.heading.md} mb-3`}>Processing</div>
      <div className="space-y-2">
        {STAGES.slice(0, 3).map(stage => {
          const count = counts[stage] ?? "—";
          const active = currentStage === stage;
          return (
            <div key={stage} className="flex items-center gap-3">
              <div className={`w-24 text-sm capitalize ${active ? "font-semibold text-blue-600" : "text-gray-500"}`}>{stage}</div>
              <div className="flex-1 h-2 bg-gray-100 rounded">
                {counts[stage] != null && <div className="h-2 bg-blue-400 rounded" style={{ width: `${Math.min(100, (counts[stage] / (counts["prefilter"] || 1)) * 100)}%` }} />}
              </div>
              <div className="w-16 text-right text-sm text-gray-600">{count}</div>
              {active && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />}
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100">
        <TokenMeterInline input={tokenInput} output={tokenOutput} budget={budgetInput} />
      </div>
    </div>
  );
}

function TokenMeterInline({ input, output, budget }) {
  const pct = budget > 0 ? Math.min(100, Math.round((input / budget) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <span>Tokens in: {input.toLocaleString()}</span>
      <span>out: {output.toLocaleString()}</span>
      {budget > 0 && <span className={pct > 80 ? "text-red-500 font-medium" : ""}>{pct}% of budget</span>}
    </div>
  );
}
