// A manager or admin filling a day someone else missed.
//
// A recruiter can only ever fill today, so once a day closes the only way it
// gets recorded is here. The entry belongs to the recruiter — their hours, their
// index — but it carries who actually typed it, and that is shown everywhere the
// entry appears rather than being buried in the document.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { friendlyError } from "../../lib/errors";
import { saveTimesheetEntry, JobHours } from "../../lib/timesheets";
import { EXPECTED_DAILY_HOURS } from "../../lib/timesheetStats";
import { listOpenJobs } from "../../lib/openJobs";
import JobHoursPicker from "./JobHoursPicker";
import Modal from "../Modal";

export default function FillOnBehalfModal({
  uid,
  name,
  date,
  onClose,
}: {
  uid: string;
  name: string;
  date: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [jobs, setJobs] = useState<JobHours[]>([]);
  const [workedOn, setWorkedOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openJobsQ = useQuery({ queryKey: ["openJobs"], queryFn: listOpenJobs, staleTime: 10 * 60_000 });

  const total = Math.round(jobs.reduce((s, j) => s + (Number(j.hours) || 0), 0) * 100) / 100;
  const incomplete = jobs.length > 0 && jobs.some((j) => !(Number(j.hours) > 0));
  const canSave = jobs.length > 0 && total > 0 && !incomplete;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await saveTimesheetEntry(date, total, workedOn, jobs, uid);
      await qc.invalidateQueries({ queryKey: ["teamTimesheets"] });
      await qc.invalidateQueries({ queryKey: ["myTimesheets"] });
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={`Fill ${date} for ${name}`} onClose={onClose}>
      <div className="alert info" style={{ fontSize: "0.85rem" }}>
        You are filling this day on {name}&#39;s behalf. The hours count as theirs, and the entry will
        show that you added it. An existing entry can&#39;t be overwritten this way.
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="field">
        <label>
          Hours <span className="muted" style={{ fontWeight: 400 }}>— {EXPECTED_DAILY_HOURS}h expected</span>
        </label>
        <input type="number" value={total || ""} placeholder="0" disabled readOnly />
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          Total from the requirements below.
        </span>
      </div>

      <JobHoursPicker
        jobs={jobs}
        options={openJobsQ.data ?? []}
        loading={openJobsQ.isLoading}
        error={openJobsQ.error ? friendlyError(openJobsQ.error) : null}
        onChange={setJobs}
        required
      />

      <div className="field">
        <label>Notes (optional)</label>
        <textarea
          rows={3}
          style={{ minHeight: 70 }}
          placeholder="What they worked on, or why this is being filled late."
          value={workedOn}
          onChange={(e) => setWorkedOn(e.target.value)}
        />
      </div>

      {incomplete && (
        <p style={{ fontSize: "0.82rem", color: "var(--danger)" }}>
          Enter hours for every requirement added, or remove the ones you haven&#39;t.
        </p>
      )}

      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button className="btn" onClick={submit} disabled={saving || !canSave}>
          {saving ? <span className="spinner" /> : `Save for ${name}`}
        </button>
      </div>
    </Modal>
  );
}
