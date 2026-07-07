import { T } from "../theme.js";

export function DigestModal({ onClose, leads }) {
  const newLeads = leads.filter(l => l.signals.some(s => s.type === "NEW_FILING"));
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <div className={T.heading.md}>Digest</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">X</button>
        </div>
        <div className="p-4">
          <p className="text-sm text-gray-600 mb-4">
            {newLeads.length} new filings in this search.
            <span className="block mt-1 text-xs text-gray-400">
              Note: scheduled email digests require a hosted backend (Phase 2 product). The CLI already supports digest generation.
            </span>
          </p>
          {newLeads.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {newLeads.map(l => (
                <div key={l.entity.id} className="text-sm border-b border-gray-100 pb-2">
                  <span className="font-medium">{l.entity.name}</span>
                  <span className="text-gray-400 ml-2">{l.entity.city} · {l.entity.formDate.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t flex justify-end">
          <button className={T.btn.secondary} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
