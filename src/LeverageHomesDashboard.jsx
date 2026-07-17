import React, { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";

/* ============================================================================
 * Speed to Lead — self-contained module (config + logic + UI)
 * ----------------------------------------------------------------------------
 * Team metric (pool leads, first-come-first-serve — never attributed to a rep).
 * Elapsed = claim time minus start time (plain wall-clock subtraction, seconds).
 *   start = Created Date for New Leads; Edit Date for the other four scenarios.
 * Three buckets, routed by the START timestamp's day + time-of-day:
 *   • primary    = weekday, started 10am–7pm   (the accountable number)
 *   • outwindow  = weekday, started before 10am / after 7pm
 *   • weekend    = started Sat/Sun (any time)   — weekend wins over time-of-day
 * Priority (per row): ICP is authoritative; source is only a tiebreaker.
 *   ICP >= 4 -> High ; ICP 1–3 -> Low ; ICP absent/0 -> premium source -> High else Low.
 *   premium source = Website / Pay Per Lead / Direct Mail.
 * Headline = AVERAGE (business asked for it; median kept as a secondary stat).
 * Period filter anchors on the start timestamp.
 * ========================================================================== */
const STL_WORKBOOK_ID = "1h8z638faYNIRPm7jwsTqvfEAdYLejsK5O4Irszc18Tk";
const STL_PREMIUM = /website|pay per lead|direct mail/i;
const STL_SCENARIOS = ["New Leads", "Revived Leads", "Cadence Replied", "Revived Opps", "Cadence Opps"];

// Parse "M/D/YYYY h:mm AM/PM" (Coefficient default) keeping time-of-day; also ISO + serials.
function parseDateTime(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
  const s = String(v).trim(); if (!s) return null;
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    let h = m[4] != null ? +m[4] : 0; const min = m[5] != null ? +m[5] : 0; const sec = m[6] != null ? +m[6] : 0;
    if (m[7]) { const ap = m[7].toUpperCase(); if (ap === "PM" && h < 12) h += 12; if (ap === "AM" && h === 12) h = 0; }
    return new Date(y, +m[1] - 1, +m[2], h, min, sec);
  }
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  const d = new Date(s); return isNaN(d) ? null : d;
}
function stlScenario(tab) { const m = String(tab || "").match(/\(([^)]+)\)/); const p = m ? m[1].trim() : ""; return STL_SCENARIOS.find((s) => s.toLowerCase() === p.toLowerCase()) || p || "Other"; }
function stlPriority(icpRaw, source) {
  const icp = Number(icpRaw);
  if (!isNaN(icp) && icp >= 4) return "High";
  if (!isNaN(icp) && icp >= 1 && icp <= 3) return "Low";
  return STL_PREMIUM.test(String(source || "")) ? "High" : "Low"; // icp absent/0 -> source decides
}
function stlStartRaw(row, scenario) { return /new leads/i.test(scenario) ? (row.createdDate ?? row.editDate) : row.editDate; }
function stlBucket(startDate) {
  const d = parseDateTime(startDate); if (!d) return null;
  const day = d.getDay(); if (day === 0 || day === 6) return "weekend"; // weekend wins first
  const h = d.getHours(); return (h >= 10 && h < 19) ? "primary" : "outwindow"; // 10am–7pm
}
const mean = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0);
// Adaptive duration format: 42s / 3m 20s / 1h 14m
function fmtDur(sec) {
  if (sec == null || isNaN(sec)) return "—";
  sec = Math.round(sec);
  if (sec < 60) return sec + "s";
  if (sec < 3600) { const m = Math.floor(sec / 60), s = sec % 60; return s ? `${m}m ${s}s` : `${m}m`; }
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`;
}

/* ============================================================================
 * DATASET — add this entry to the DATASETS object.
 * One dataset unions all five "Speed to Lead X YTD (...)" tabs; the tab name
 * carries the scenario (routed via stlScenario). Same header signature across
 * tabs, so tabInclude + tabField is the reliable key. dateField:null — the
 * period filter is applied inside the view against the per-row start timestamp,
 * because the start column differs by scenario (Created vs Edit date).
 * ========================================================================== */
const SPEED_TO_LEAD_DATASET = {
  speed_to_lead: {
    workbook: "speed_to_lead",
    require: ["Speed to Lead Claimed Date & Time", "Lead Source"], exclude: [],
    tabInclude: /Speed to Lead X YTD/i, tabField: "__tab",
    schema: {
      id: ["Lead ID", "Opportunity ID"], name: ["Company", "Opportunity Name"],
      claimed: "Speed to Lead Claimed Date & Time", editDate: "Edit Date", createdDate: "Created Date",
      icp: ["Total Tier 1 ICP", "Total ICP Score"], source: "Lead Source",
      newValue: "New Value", tab: "__tab",
    },
    dedupe: null, dateField: null, repField: null, // team metric — no rep attribution
  },
};

/* ============================================================================
 * Speed to Lead view — big blended hero (>=2x) + two smaller context heroes.
 * Buckets by start-time: primary (wkdy 10–7) / outwindow (wkdy off-hrs) / weekend.
 * Each hero: AVG headline, median secondary, and breakouts by scenario / priority
 * / channel. Uses the file's shared T theme, Panel, and num()/fmt helpers.
 * ========================================================================== */
function stlRows(store, range) {
  // normalize + tag scenario, priority, bucket, elapsed; apply period filter on start.
  const out = [];
  (store.speed_to_lead || []).forEach((r) => {
    const scenario = stlScenario(r.tab);
    const startRaw = stlStartRaw(r, scenario);
    const start = parseDateTime(startRaw), claim = parseDateTime(r.claimed);
    if (!start || !claim) return;
    const elapsed = (claim - start) / 1000; // seconds
    if (elapsed < 0 || elapsed > 30 * 86400) return; // drop negatives + absurd outliers (>30d)
    if (range && (start < range.start || start > range.end)) return; // period filter on START
    out.push({ scenario, priority: stlPriority(r.icp, r.source), bucket: stlBucket(startRaw),
      source: String(r.source || "").trim() || "(unset)", elapsed });
  });
  return out;
}
function stlAgg(rows) { // pooled avg + median across the given rows
  const v = rows.map((r) => r.elapsed).filter((n) => n >= 0);
  return { n: v.length, avg: v.length ? mean(v) : null, med: v.length ? median(v) : null };
}
function StlHero({ title, caption, rows, big }) {
  const a = stlAgg(rows);
  const groupAvg = (key, order) => {
    const m = {}; rows.forEach((r) => { const k = r[key]; if (!k) return; (m[k] = m[k] || []).push(r.elapsed); });
    let items = Object.entries(m).map(([label, arr]) => ({ label, value: mean(arr), n: arr.length }));
    if (order) items = items.sort((x, y) => order.indexOf(x.label) - order.indexOf(y.label));
    else items = items.sort((x, y) => x.value - y.value);
    return items;
  };
  const max = (items) => Math.max(1, ...items.map((i) => i.value));
  const Row = ({ label, value, n, mx }) => (
    <div className="flex items-center gap-3">
      <div className="text-[12px] shrink-0" style={{ width: big ? 150 : 120, color: T.sub }}>{label} <span style={{ color: T.faint }}>({n})</span></div>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${Math.round((value / mx) * 100)}%`, height: "100%", background: T.accent }} /></div>
      <div className="text-[12px] text-right shrink-0" style={{ width: 78, fontVariantNumeric: "tabular-nums", color: T.ink }}>{fmtDur(value)}</div>
    </div>);
  const scen = groupAvg("scenario", STL_SCENARIOS), prio = groupAvg("priority", ["High", "Low"]), chan = groupAvg("source");
  return (
    <div className="rounded-xl p-5 flex flex-col gap-3" style={{ background: T.card, border: `1px solid ${T.border}` }}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium" style={{ color: T.sub }}>{title}</span>
        <span className="text-[8px] font-bold px-1 py-0.5 rounded tracking-wider" style={{ color: T.accent, background: T.accentSoft }}>LIVE</span>
      </div>
      <div className="font-bold leading-none tracking-tight" style={{ fontSize: big ? 64 : 34, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{fmtDur(a.avg)}</div>
      <div className="text-[11px]" style={{ color: T.faint }}>{caption}</div>
      <div className="text-[11px]" style={{ color: T.faint }}>avg · median {fmtDur(a.med)} · {a.n.toLocaleString()} leads</div>
      {big && a.n > 0 && (<div className="flex flex-col gap-4 pt-3 mt-1" style={{ borderTop: `1px solid ${T.border}` }}>
        <div><div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: T.faint }}>By scenario</div><div className="flex flex-col gap-2">{scen.map((i) => <Row key={i.label} {...i} mx={max(scen)} />)}</div></div>
        <div><div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: T.faint }}>By priority</div><div className="flex flex-col gap-2">{prio.map((i) => <Row key={i.label} {...i} mx={max(prio)} />)}</div></div>
        <div><div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: T.faint }}>By channel</div><div className="flex flex-col gap-2">{chan.map((i) => <Row key={i.label} {...i} mx={max(chan)} />)}</div></div>
      </div>)}
    </div>);
}
function SpeedToLeadView({ store, range }) {
  const rows = useMemo(() => stlRows(store, range), [store, range]);
  const b = (name) => rows.filter((r) => r.bucket === name);
  return (
    <div className="flex flex-col gap-5">
      <StlHero big title="Speed to Lead" caption="Avg time from lead in → claimed · leads received weekdays 10am–7pm (the accountable window)" rows={b("primary")} />
      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <StlHero title="Out of Window" caption="Leads received weekdays outside 10am–7pm — context, not scored" rows={b("outwindow")} />
        <StlHero title="Weekend" caption="Leads received Saturday & Sunday — context, not scored" rows={b("weekend")} />
      </div>
    </div>);
}
