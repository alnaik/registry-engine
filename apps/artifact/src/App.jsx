import { useState, useCallback, useRef } from "react";
import { ColoradoRegistrySource, MemoryCache, fetchVitality, fetchGaps } from "@registry-engine/registry-core";
import { ArtifactBackend, TokenBudgeter, runPrefilter, runClassify, qualifyLead, assembleDossier, draftOutreach, applyFeedback, validateProfile } from "@registry-engine/qualify";
import { WindowStorageCache } from "./storage.js";
import { T } from "./theme.js";
import { SearchSetup } from "./components/SearchSetup.jsx";
import { FunnelProgress } from "./components/FunnelProgress.jsx";
import { ResultsTable } from "./components/ResultsTable.jsx";
import { DossierDrawer } from "./components/DossierDrawer.jsx";
import { ProfileEditor } from "./components/ProfileEditor.jsx";
import { VitalityView } from "./components/VitalityView.jsx";
import { GapView } from "./components/GapView.jsx";
import { DigestModal } from "./components/DigestModal.jsx";

import diamondProfile from "../../../packages/qualify/src/profiles/starters/diamond-prospect.json";
import supplierProfile from "../../../packages/qualify/src/profiles/starters/supplier-search.json";
import eventProfile from "../../../packages/qualify/src/profiles/starters/event-vendor.json";

const STARTER_PROFILES = [diamondProfile, supplierProfile, eventProfile].map(p => validateProfile(p));
const CLASSIFY_BUDGET = 15000;
const QUALIFY_BUDGET_PER_LEAD = 8000;

export default function App() {
  const [screen, setScreen] = useState("setup");
  const [profiles, setProfiles] = useState(STARTER_PROFILES);
  const [selectedProfile, setSelectedProfile] = useState(STARTER_PROFILES[0]);
  const [editingProfile, setEditingProfile] = useState(null);
  const [leads, setLeads] = useState([]);
  const [funnelCounts, setFunnelCounts] = useState({});
  const [currentStage, setCurrentStage] = useState("");
  const [tokenTotals, setTokenTotals] = useState({ input: 0, output: 0 });
  const [selectedDossier, setSelectedDossier] = useState(null);
  const [draftingOutreach, setDraftingOutreach] = useState(false);
  const [feedbackMap, setFeedbackMap] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [activeTab, setActiveTab] = useState("results");
  const [vitalityRows, setVitalityRows] = useState([]);
  const [gapRows, setGapRows] = useState([]);
  const [showDigest, setShowDigest] = useState(false);
  const [error, setError] = useState(null);

  const cacheRef = useRef(new WindowStorageCache());
  const abortRef = useRef(false);

  const handleRun = useCallback(async (locationQuery, filters) => {
    if (!selectedProfile) return;
    setScreen("running");
    setLeads([]);
    setFunnelCounts({});
    setTokenTotals({ input: 0, output: 0 });
    setError(null);
    abortRef.current = false;

    try {
      const source = new ColoradoRegistrySource();
      const backend = new ArtifactBackend();
      const budgeter = new TokenBudgeter(backend, { maxInputTokensPerRun: CLASSIFY_BUDGET });

      // Collect all entities from registry
      setCurrentStage("discover");
      const entities = [];
      for await (const entity of source.fetchEntities(locationQuery, filters)) {
        if (abortRef.current) break;
        entities.push(entity);
        setFunnelCounts(c => ({ ...c, discover: entities.length }));
      }

      if (abortRef.current) return;

      // Build signals map
      const signalsByEntityId = new Map();
      if (entities.length > 0) {
        const entityIds = entities.map(e => e.id);
        const signals = await source.fetchSignals(entityIds, 90);
        for (const s of signals) {
          const arr = signalsByEntityId.get(s.entityId) ?? [];
          arr.push(s);
          signalsByEntityId.set(s.entityId, arr);
        }
      }

      // Prefilter
      setCurrentStage("prefilter");
      const { included, ambiguous } = await runPrefilter(entities, selectedProfile, budgeter);
      const toClassify = [...included, ...ambiguous];
      setFunnelCounts(c => ({ ...c, prefilter: toClassify.length }));
      setTokenTotals({ ...budgeter.totals });

      if (abortRef.current) return;

      // Classify
      setCurrentStage("classify");
      const verdicts = await runClassify(toClassify, selectedProfile, budgeter);
      const yEntities = toClassify.filter(e => verdicts.get(e.id) === "Y");
      setFunnelCounts(c => ({ ...c, classify: yEntities.length }));
      setTokenTotals({ ...budgeter.totals });

      // Create pending leads (not yet qualified)
      const pendingLeads = yEntities.map(e => ({
        entity: e,
        score: 0,
        rationale: "Not yet qualified — select and click Qualify",
        webPresence: "none",
        contact: null,
        sells: "",
        buys: "",
        signals: signalsByEntityId.get(e.id) ?? [],
        profileId: selectedProfile.id,
      }));
      setLeads(pendingLeads);
      setScreen("results");

      // Fetch vitality + gaps in background
      const zips = [...new Set(entities.map(e => e.zipCode))].slice(0, 5);
      if (zips.length > 0) {
        fetchVitality(zips, selectedProfile.mustHave.slice(0, 2))
          .then(rows => setVitalityRows(rows))
          .catch(() => {});
        fetchGaps(zips, selectedProfile.mustHave.slice(0, 2))
          .then(rows => setGapRows(rows))
          .catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setScreen("results");
    }
  }, [selectedProfile]);

  const handleQualify = useCallback(async (entityIds) => {
    if (!selectedProfile) return;
    const backend = new ArtifactBackend();
    const budgeter = new TokenBudgeter(backend, { maxInputTokensPerRun: QUALIFY_BUDGET_PER_LEAD * entityIds.length });
    const source = new ColoradoRegistrySource();

    const entitiesToQualify = leads
      .filter(l => entityIds.includes(l.entity.id))
      .map(l => l.entity);

    const signalsByEntityId = new Map();
    if (entitiesToQualify.length > 0) {
      const signals = await source.fetchSignals(entitiesToQualify.map(e => e.id), 90);
      for (const s of signals) {
        const arr = signalsByEntityId.get(s.entityId) ?? [];
        arr.push(s);
        signalsByEntityId.set(s.entityId, arr);
      }
    }

    for (const entity of entitiesToQualify) {
      try {
        const signals = signalsByEntityId.get(entity.id) ?? [];
        const lead = await qualifyLead(entity, selectedProfile, signals, budgeter);
        setLeads(ls => ls.map(l => l.entity.id === entity.id ? lead : l));
        setTokenTotals(t => ({ input: t.input + budgeter.totals.input, output: t.output + budgeter.totals.output }));
      } catch (err) {
        // Mark as error but keep row
        setLeads(ls => ls.map(l => l.entity.id === entity.id ? { ...l, rationale: "Qualify failed: " + String(err) } : l));
      }
    }
  }, [leads, selectedProfile]);

  const handleSelectLead = useCallback((lead) => {
    setSelectedDossier({ lead, dossier: assembleDossier(lead) });
  }, []);

  const handleDraftOutreach = useCallback(async () => {
    if (!selectedDossier) return;
    setDraftingOutreach(true);
    try {
      const backend = new ArtifactBackend();
      const budgeter = new TokenBudgeter(backend, {});
      const draft = await draftOutreach(selectedDossier.lead, budgeter);
      setSelectedDossier(d => d ? { ...d, dossier: { ...d.dossier, outreachDraft: draft } } : null);
    } finally {
      setDraftingOutreach(false);
    }
  }, [selectedDossier]);

  const handleFeedback = useCallback((lead, verdict) => {
    setFeedbackMap(m => ({ ...m, [lead.entity.id]: verdict }));
    if (selectedProfile) {
      const updated = applyFeedback(selectedProfile, {
        entityId: lead.entity.id,
        entityName: lead.entity.name,
        verdict,
        rationale: lead.rationale || lead.entity.name,
      });
      setSelectedProfile(updated);
      setProfiles(ps => ps.map(p => p.id === updated.id ? updated : p));
    }
  }, [selectedProfile]);

  const handleSaveProfile = useCallback((profile) => {
    setProfiles(ps => {
      const exists = ps.find(p => p.id === profile.id);
      return exists ? ps.map(p => p.id === profile.id ? profile : p) : [...ps, profile];
    });
    setSelectedProfile(profile);
    setEditingProfile(null);
  }, []);

  const handleToggleSelect = useCallback((id) => {
    setSelectedIds(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  return (
    <div className={T.page}>
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Registry Engine</h1>
          <p className="text-xs text-gray-400">Colorado business registry discovery</p>
        </div>
        <div className="flex items-center gap-3">
          {screen === "results" && (
            <>
              <button className={T.btn.ghost} onClick={() => setShowDigest(true)}>Digest</button>
              <button className={T.btn.secondary} onClick={() => { setScreen("setup"); setEditingProfile(null); }}>New search</button>
            </>
          )}
        </div>
      </header>

      <main className="p-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
        )}

        {screen === "setup" && editingProfile === null && (
          <SearchSetup
            profiles={profiles}
            selectedProfile={selectedProfile}
            onSelectProfile={setSelectedProfile}
            onEditProfile={p => setEditingProfile(p ?? "new")}
            onRun={handleRun}
            running={false}
          />
        )}

        {editingProfile !== null && (
          <div className="max-w-2xl mx-auto">
            <ProfileEditor
              profile={editingProfile === "new" ? null : editingProfile}
              onSave={handleSaveProfile}
              onCancel={() => setEditingProfile(null)}
            />
          </div>
        )}

        {screen === "running" && (
          <div className="max-w-2xl mx-auto">
            <FunnelProgress
              counts={funnelCounts}
              currentStage={currentStage}
              tokenInput={tokenTotals.input}
              tokenOutput={tokenTotals.output}
              budgetInput={CLASSIFY_BUDGET}
            />
          </div>
        )}

        {screen === "results" && editingProfile === null && (
          <div>
            <div className="flex items-center gap-4 mb-4">
              {["results", "vitality", "gaps"].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium rounded-md capitalize ${activeTab === tab ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                  {tab}
                </button>
              ))}
              <div className="ml-auto text-xs text-gray-400">
                {tokenTotals.input > 0 && `${tokenTotals.input.toLocaleString()} tokens in`}
              </div>
            </div>

            {activeTab === "results" && (
              <div className={T.card}>
                <ResultsTable
                  leads={leads}
                  classifyMap={new Map()}
                  onSelectLead={handleSelectLead}
                  onQualify={handleQualify}
                  onFeedback={handleFeedback}
                  feedbackMap={feedbackMap}
                  selectedIds={selectedIds}
                  onToggleSelect={handleToggleSelect}
                />
              </div>
            )}
            {activeTab === "vitality" && <div className={T.card}><VitalityView rows={vitalityRows} /></div>}
            {activeTab === "gaps" && <div className={T.card}><GapView rows={gapRows} /></div>}
          </div>
        )}
      </main>

      {selectedDossier && (
        <DossierDrawer
          lead={selectedDossier.lead}
          dossier={selectedDossier.dossier}
          onClose={() => setSelectedDossier(null)}
          onDraftOutreach={handleDraftOutreach}
          drafting={draftingOutreach}
        />
      )}

      {showDigest && <DigestModal leads={leads} onClose={() => setShowDigest(false)} />}
    </div>
  );
}
