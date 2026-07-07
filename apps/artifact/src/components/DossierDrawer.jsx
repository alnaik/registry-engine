import { T } from "../theme.js";

export function DossierDrawer({ lead, dossier, onClose, onDraftOutreach, drafting }) {
  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-2xl flex flex-col z-50">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className={T.heading.md}>{lead.entity.name}</div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">X</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <pre className="whitespace-pre-wrap font-mono text-xs text-gray-700 bg-gray-50 rounded p-3 mb-4">
          {dossier.brief}
        </pre>
        {dossier.outreachDraft && (
          <div className={T.card + " mb-4"}>
            <div className={`${T.heading.sm} mb-2`}>Outreach opener</div>
            <p className="text-sm text-gray-700">{dossier.outreachDraft}</p>
          </div>
        )}
        {!dossier.outreachDraft && (
          <button className={T.btn.secondary} onClick={onDraftOutreach} disabled={drafting}>
            {drafting ? "Drafting..." : "Draft opener"}
          </button>
        )}
      </div>
    </div>
  );
}
