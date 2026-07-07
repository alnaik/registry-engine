import { T } from "../theme.js";
import { useState } from "react";

export function ProfileEditor({ profile, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: profile?.name ?? "",
    direction: profile?.direction ?? "find_customers",
    description: profile?.description ?? "",
    mustHave: (profile?.mustHave ?? []).join(", "),
    niceToHave: (profile?.niceToHave ?? []).join(", "),
    exclude: (profile?.exclude ?? []).join(", "),
  });

  function split(str) { return str.split(",").map(s => s.trim()).filter(Boolean); }

  function handleSave() {
    onSave({
      id: profile?.id ?? `custom-${Date.now()}`,
      name: form.name,
      direction: form.direction,
      description: form.description,
      mustHave: split(form.mustHave),
      niceToHave: split(form.niceToHave),
      exclude: split(form.exclude),
      feedback: profile?.feedback ?? { approvedTraits: [], rejectedTraits: [] },
      version: String((parseInt(profile?.version ?? "0", 10) + 1)),
    });
  }

  return (
    <div className={T.card}>
      <div className={`${T.heading.md} mb-4`}>Edit Profile</div>
      <div className="space-y-3">
        <div>
          <label className={T.label}>Name</label>
          <input className={T.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className={T.label}>Direction</label>
          <select className={T.input} value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}>
            <option value="find_customers">Find Customers (seller mode)</option>
            <option value="find_suppliers">Find Suppliers (buyer mode)</option>
          </select>
        </div>
        <div>
          <label className={T.label}>Description (plain English)</label>
          <textarea className={`${T.input} h-20 resize-none`} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div>
          <label className={T.label}>Must have (comma-separated keywords)</label>
          <input className={T.input} value={form.mustHave} onChange={e => setForm(f => ({ ...f, mustHave: e.target.value }))} />
        </div>
        <div>
          <label className={T.label}>Nice to have</label>
          <input className={T.input} value={form.niceToHave} onChange={e => setForm(f => ({ ...f, niceToHave: e.target.value }))} />
        </div>
        <div>
          <label className={T.label}>Exclude</label>
          <input className={T.input} value={form.exclude} onChange={e => setForm(f => ({ ...f, exclude: e.target.value }))} />
        </div>
        <div className="flex gap-2 pt-2">
          <button className={T.btn.primary} onClick={handleSave}>Save</button>
          {onCancel && <button className={T.btn.secondary} onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}
