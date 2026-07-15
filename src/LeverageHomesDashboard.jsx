import React, { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/* ============================================================================
 * Leverage Homes — KPI Dashboard Framework (Phase 3: auto-tab-union model)
 * ----------------------------------------------------------------------------
 * Each workbook is split into many per-rep / per-report tabs (Coefficient does
 * this to sync under Salesforce volume limits). So a logical DATASET is not a
 * workbook — it's the UNION of every tab whose header row matches a signature.
 * New rep tab appears -> picked up automatically, zero code changes.
 *
 * Live path (public API key): metadata -> tab titles -> values:batchGet (one
 * call per workbook) -> auto-detect header row (skips the Coefficient banner)
 * -> assign each tab to a dataset by header signature -> union -> dedupe.
 *
 * TO GO LIVE: set API_KEY, share each workbook "Anyone with link -> Viewer",
 * enable Google Sheets API. No key = sample data so the UI always renders.
 * ========================================================================== */

const API_KEY =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SHEETS_API_KEY) ||
  (typeof window !== "undefined" && window.SHEETS_API_KEY) ||
  ""; // build-time env first (Vite inlines it); window fallback for artifact preview

const T = {
  canvas: "#F6F7F9", card: "#FFFFFF", border: "#E6E9ED", ink: "#0F1B2D",
  sub: "#5B6675", faint: "#8A94A3", accent: "#127A56", accentSoft: "#E7F2ED",
  good: "#127A56", warn: "#B45309", bad: "#BE123C", track: "#EEF1F4", warnSoft: "#FBF1E4",
  chart: ["#127A56", "#2E9E78", "#5FB89A", "#0F1B2D", "#4A5A6E", "#93CDB8", "#B45309"],
};
const FONT = { fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" };

/* ============================================================================
 * config/workbooks.js  — IDs mapped to their TRUE file titles (the project
 * spec's URL labels were scrambled: its "Context" URL is really Pipeline, and
 * its "Targets" URL is really Context).
 * ========================================================================== */
const WORKBOOKS = {
  opportunities: { id: "1UN-p8DcLKpWkqretcUL_SzmTpnDSOWkPqISbEYKduLg", title: "Homes Dashboard Pt 1 (Opportunities)" },
  pipeline:      { id: "1ui2pXxOFeAu58VYiYOgliF_yBCBq7m0H0Xy8JJnoALM", title: "Homes Dashboard PT1 (Pipeline)" },
  context:       { id: "1LUi9VfpX0T_1bgg40NPvt6ltxNX0ASPmwGiymbDmxa8", title: "Homes Dashboard Pt 1 (Context)" },
  activities:    { id: "1gfYW52duE4tmNr5b92F2HvanZroMlcaQZ01_5f4bgac", title: "Homes Dashboard Pt 1 (Activities)" },
  marketing:     { id: "1lkftyL4-_kX-hxHXQZ_ylwPlFQg2wYJBXXHE2bzN4wc", title: "Homes Dashboard PT1 (Marketing)" },
  tasks:         { id: "1Vs-IMKBDW3FilFSM8gQKo1NqSgUqh0aVPhFPb4wGOPE", title: "Homes Dashboard Pt 1 (Tasks)" },
};

/* ============================================================================
 * config/datasets.js  — the heart of the model. Each dataset scans one or more
 * workbooks and claims every tab whose header row contains `require` (and none
 * of `exclude`). schema maps normalized field -> source column. dedupe key
 * protects against overlapping tabs (several closed/pipeline views repeat rows).
 *
 * ✔ confirmed against live data   ⧗ pending confirmation (auto-discovers + is
 * reported by the schema doctor on first live load)
 * ========================================================================== */
const DATASETS = {
  opps_created: { // ✔
    workbook: "opportunities",
    require: ["Opportunity ID", "Opportunity Record Type"], exclude: ["Total Net Revenue", "Lead Status"],
    schema: { id: "Opportunity ID", name: "Opportunity Name", owner: "Opportunity Owner",
      recordType: "Opportunity Record Type", icp: "ISA ICP Total Score", createdBy: "Created By" },
    dedupe: (r) => r.id, dateField: "date",
    dateCandidates: ["Created Date", "Create Date", "Date Created", "Opportunity Created Date"], repField: "owner",
  },
  opps_closed: { // ✔  actuals — Total Net Revenue by Close Date
    workbook: "opportunities",
    require: ["Total Net Revenue", "Close Date"], exclude: [],
    schema: { owner: "Opportunity Owner", name: "Opportunity Name", revenue: "Total Net Revenue",
      acqManager: "Acquisition Manager", followUp: "Follow Up Specialist", closeDate: "Close Date" },
    dedupe: (r) => `${r.name}|${r.closeDate}`, dateField: "closeDate", repField: "owner",
  },
  pipeline: { // ✔  forecast — open-stage Total Forecasted Revenue by Close Date
    workbook: "pipeline",
    require: ["Stage", "Projected Net Revenue", "Total Forecasted Revenue"],
    exclude: ["Appointment Type", "Lead Source", "Acquisition Associate"],
    schema: { name: "Opportunity Name", stage: "Stage", projected: "Projected Net Revenue",
      forecast: "Total Forecasted Revenue", closeDate: "Close Date" },
    dedupe: (r) => r.name, dateField: "closeDate", repField: null,
  },
  appointments: { // ✔  Activities workbook — real appointment events
    workbook: "activities",
    require: ["Appointment Outcome", "Event Type"], exclude: [],
    schema: { subject: "Subject", createdBy: "Created By", rep: "Assigned",
      outcome: "Appointment Outcome", eventType: "Event Type" },
    dedupe: null, dateField: "date", dateCandidates: ["Created Date", "Create Date"], repField: "rep",
  },
  leads: { // ✔  Marketing workbook — lead-level rows by source (no spend data exists)
    workbook: "marketing",
    require: ["Lead ID", "Lead Source"], exclude: [],
    schema: { leadId: "Lead ID", account: "Company / Account", status: "Lead Status",
      icp: "Total Tier 1 ICP", segment: "Marketing Segmentation", source: "Lead Source" },
    dedupe: (r) => r.leadId, dateField: "date", dateCandidates: ["Create Date", "Created Date"], repField: null,
  },
  calls: { // ✔  Tasks workbook — call logs / talk time
    workbook: "tasks",
    require: ["Task", "Assigned", "Status"], exclude: [],
    schema: { account: "Company / Account", subject: "Subject", rep: "Assigned", status: "Status", task: "Task",
      durationMin: "smrtPhone Call Duration (Minutes)", qc: "smrtPhone QC Y/N" },
    dedupe: null, dateField: "date", dateCandidates: ["Created Date", "Create Date", "Completed Date", "Date"], repField: "rep",
  },
  directory: { // ✔  Context workbook — org source of truth
    workbook: "context",
    require: ["REP", "ROLE"], exclude: [],
    schema: { rep: "REP", name: "REP", role: "ROLE", team: "TEAM", department: "Department" },
    dedupe: (r) => r.rep, dateField: null, repField: null,
  },
  targets: { // ⧗ suspected 2nd tab of Context — headers unconfirmed (decode pending)
    workbook: "context",
    require: ["KPI", "Target"], exclude: [],
    schema: { kpiId: "KPI", scope: "Scope", scopeValue: "Scope Value", period: "Period", value: "Target" },
    dedupe: null, dateField: null, repField: null,
  },
};

/* ============================================================================
 * lib/sheetsClient.js  — Google adapter (public API key) + mock adapter.
 * ========================================================================== */
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const q = (title) => encodeURIComponent("'" + String(title).replace(/'/g, "''") + "'");

async function listTabs(id, key) {
  const url = `${SHEETS_API}/${id}?fields=sheets.properties(title)&key=${key}`;
  const meta = await fetch(url).then((r) => r.json());
  if (meta.error) throw new Error(meta.error.message);
  return (meta.sheets || []).map((s) => s.properties.title);
}
async function batchGet(id, titles, key) {
  const ranges = titles.map((t) => `ranges=${q(t)}`).join("&");
  const url = `${SHEETS_API}/${id}/values:batchGet?${ranges}` +
    `&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&key=${key}`;
  const data = await fetch(url).then((r) => r.json());
  if (data.error) throw new Error(data.error.message);
  const out = {};
  (data.valueRanges || []).forEach((vr, i) => { out[titles[i]] = vr.values || []; });
  return out;
}
function detectHeaderRow(values, hints) {
  const limit = Math.min(6, values.length);
  let best = 0, bestScore = -1;
  for (let i = 0; i < limit; i++) {
    const row = (values[i] || []).map((c) => String(c).trim());
    const score = hints.filter((h) => row.includes(h)).length;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}
function rowsToObjects(values, hints) {
  if (!values.length) return { headers: [], rows: [] };
  const hr = detectHeaderRow(values, hints);
  const headers = (values[hr] || []).map((h) => String(h).trim());
  return { headers, rows: values.slice(hr + 1)
    .filter((r) => r.some((c) => c !== "" && c != null))
    .map((r) => { const o = {}; headers.forEach((h, i) => { if (h) o[h] = r[i]; }); return o; }) };
}
// A tab belongs to a dataset if its headers include all `require` and no `exclude`.
function tabMatches(headers, ds) {
  const h = headers || [];
  return ds.require.every((x) => h.includes(x)) && !ds.exclude.some((x) => h.includes(x));
}
function makeGoogleClient(key) {
  const cache = {}; // workbook -> { title: {headers, rows} }
  return {
    async loadDataset(ds) {
      const wb = WORKBOOKS[ds.workbook];
      if (!cache[ds.workbook]) {
        const titles = await listTabs(wb.id, key);
        const raw = await batchGet(wb.id, titles, key);
        const parsed = {};
        const hints = [...ds.require, ...Object.values(ds.schema)];
        for (const t of titles) parsed[t] = rowsToObjects(raw[t] || [], hints);
        cache[ds.workbook] = parsed;
      }
      let rows = [], claimed = [];
      for (const [title, parsed] of Object.entries(cache[ds.workbook])) {
        if (tabMatches(parsed.headers, ds)) { rows = rows.concat(parsed.rows); claimed.push(title); }
      }
      return { rows, claimed };
    },
  };
}
function makeMockClient() {
  const raw = buildSample();
  return { async loadDataset(ds) { return { rows: raw[Object.keys(DATASETS).find((k) => DATASETS[k] === ds)] || [], claimed: ["(sample)"] }; } };
}

/* ============================================================================
 * lib/dataStore.js  — load + normalize + dedupe every dataset; schema doctor.
 * ========================================================================== */
function normalize(rows, ds) {
  return rows.map((row) => {
    const o = {}; for (const f in ds.schema) o[f] = row[ds.schema[f]];
    if (ds.dateCandidates) for (const c of ds.dateCandidates) { const v = row[c]; if (v != null && v !== "") { o.date = v; break; } }
    return o;
  });
}
function dedupe(rows, keyFn) {
  if (!keyFn) return rows;
  const seen = new Set(); const out = [];
  for (const r of rows) { const k = keyFn(r); if (k == null || !seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}
async function loadAll() {
  const useGoogle = !!API_KEY;
  const client = useGoogle ? makeGoogleClient(API_KEY) : makeMockClient();
  const store = {}, diagnostics = [];
  for (const key in DATASETS) {
    const ds = DATASETS[key];
    const { rows, claimed } = await client.loadDataset(ds);
    store[key] = dedupe(normalize(rows, ds), ds.dedupe);
    if (useGoogle && !rows.length)
      diagnostics.push({ dataset: key, note: `no tabs matched [${ds.require.join(", ")}] in ${WORKBOOKS[ds.workbook].title}` });
    else if (useGoogle) console.log(`[${key}] ${store[key].length} rows from tabs:`, claimed);
  }
  return { store, diagnostics, mode: useGoogle ? "google" : "mock" };
}

/* ============================================================================
 * SAMPLE DATA (used only with no API key). Keyed by real source headers.
 * ========================================================================== */
function rand(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const iso = (d) => d.toISOString().slice(0, 10);
const REF = new Date();
const OWNERS = ["Sam Dogbe", "Ray O'Donnell", "Joey Szal", "David Choi"];
const OPEN_STAGES = ["Marketing", "Pre Marketing", "Under Contract", "Arip", "Delayed Marketing", "Signed Listing"];
const RECORD_TYPES = ["Wholesale", "Listing", "Purchase ~ Front-End"];
const MGRS = ["Bhavin Shroff", "Erick Bonilla", "Nick Miller"];

function buildSample() {
  const r = rand(20260715);
  const opps_created = [], opps_closed = [], pipeline = [], appointments = [], leads = [], calls = [];
  const OUTCOMES = ["Appointment Met", "Rescheduled", "No Show", "Cancelled"];
  const EVENTS = ["Virtual Appointment", "In Person Appointment"];
  const SOURCES = ["Call Center", "Text Message Campaign", "Website", "Direct Mail Campaign", "Pay Per Lead", "Referral"];
  const STATUSES = ["New Lead", "Converted", "Dead", "Nurture"];
  for (let i = 0; i < 260; i++) { const cd = new Date(REF); cd.setDate(cd.getDate() - Math.floor(r() * 200));
    opps_created.push({ "Opportunity ID": "006VI" + (100000 + i), "Opportunity Name": `Deal ${i}, Newark, NJ`,
      "Opportunity Owner": OWNERS[Math.floor(r() * 4)], "Opportunity Record Type": RECORD_TYPES[Math.floor(r() * 3)],
      "ISA ICP Total Score": Math.floor(r() * 8), "Created By": MGRS[Math.floor(r() * 3)], "Created Date": iso(cd) }); }
  for (let i = 0; i < 120; i++) { const cd = new Date(REF); cd.setDate(cd.getDate() - Math.floor(r() * 200) + 30);
    opps_closed.push({ "Opportunity Owner": OWNERS[Math.floor(r() * 4)], "Opportunity Name": `${100 + i} Main St, NJ`,
      "Total Net Revenue": Math.round((r() < 0.1 ? -1 : 1) * (3000 + r() * 90000)),
      "Acquisition Manager": MGRS[Math.floor(r() * 3)], "Follow Up Specialist": "Irish Manoguid", "Close Date": iso(cd) }); }
  for (let i = 0; i < 90; i++) { const cd = new Date(REF); cd.setDate(cd.getDate() + Math.floor(r() * 150) - 30);
    const closed = r() < 0.25; const fc = Math.round(2000 + r() * 100000);
    pipeline.push({ "Opportunity Name": `${200 + i} Park Ave, NJ`, Stage: closed ? "Closed in Accounting Recon" : OPEN_STAGES[Math.floor(r() * OPEN_STAGES.length)],
      "Projected Net Revenue": Math.round(fc * (1 + r() * 0.3)), "Total Forecasted Revenue": fc, "Close Date": iso(cd) }); }
  for (let i = 0; i < 80; i++) { const ad = new Date(REF); ad.setDate(ad.getDate() - Math.floor(r() * 120));
    appointments.push({ Subject: "Property Consultation", "Created By": MGRS[Math.floor(r() * 3)], Assigned: OWNERS[Math.floor(r() * 4)],
      "Appointment Outcome": OUTCOMES[Math.floor(r() * 4)], "Created Date": iso(ad), "Event Type": EVENTS[Math.floor(r() * 2)] }); }
  for (let i = 0; i < 220; i++) { const ld = new Date(REF); ld.setDate(ld.getDate() - Math.floor(r() * 180));
    leads.push({ "Lead ID": "00QVI" + (200000 + i), "Company / Account": `${400 + i} Oak St, NJ`, "Lead Status": STATUSES[Math.floor(r() * 4)],
      "Total Tier 1 ICP": Math.floor(r() * 8), "Marketing Segmentation": r() < 0.5 ? "Core" : "Secondary",
      "Lead Source": SOURCES[Math.floor(r() * SOURCES.length)], "Create Date": iso(ld) }); }
  for (let i = 0; i < 300; i++) { const td = new Date(REF); td.setDate(td.getDate() - Math.floor(r() * 120));
    calls.push({ "Company / Account": `${500 + i} Elm St, NJ`, Subject: r() < 0.3 ? "Outgoing Call - Appt Set" : "Outgoing Call",
      Assigned: OWNERS[Math.floor(r() * 4)], Status: "Completed", Task: "True", "Created Date": iso(td) }); }
  const directory = [
    ["Bhavin Shroff", "Sr. Acquisition Manager", "Acquisition Managers", "Sales"],
    ["Nick Miller", "Sr. Acquisition Manager", "Acquisition Managers", "Sales"],
    ["Erick Bonilla", "Sr. Acquisition Manager", "Acquisition Managers", "Sales"],
    ["Billy Liapis", "Acquisition Manager", "Acquisition Managers", "Sales"],
    ["Irish Manoguid", "Follow-Up Specialist", "Follow up Specialists", "Sales"],
    ["Oscar Malik", "Follow-Up Specialist", "Follow up Specialists", "Sales"],
    ["Ray O'Donnell", "Vice President", "Follow up Specialists", "Sales"],
    ["Joey Szal", "Vice President", "Follow up Specialists", "Sales"],
    ["Sam Dogbe", "Vice President", "Follow up Specialists", "Sales"],
    ["Brendan Da Silva", "Realtor", "Da Silva Team", "Listing Partner"],
  ].map(([rep, role, team, department]) => ({ REP: rep, ROLE: role, TEAM: team, Department: department }));
  const targets = [
    { KPI: "closed_revenue", Scope: "Company", "Scope Value": "Leverage Homes", Period: "Monthly", Target: 700000 },
    { KPI: "deals_closed", Scope: "Company", "Scope Value": "Leverage Homes", Period: "Monthly", Target: 14 },
    { KPI: "pipeline_forecast", Scope: "Company", "Scope Value": "Leverage Homes", Period: "Monthly", Target: 900000 },
    { KPI: "opps_created", Scope: "Company", "Scope Value": "Leverage Homes", Period: "Monthly", Target: 120 },
    { KPI: "appointments", Scope: "Company", "Scope Value": "Leverage Homes", Period: "Monthly", Target: 90 },
    { KPI: "leads", Scope: "Company", "Scope Value": "Leverage Homes", Period: "Monthly", Target: 700 },
    { KPI: "calls", Scope: "Company", "Scope Value": "Leverage Homes", Period: "Monthly", Target: 2500 },
  ];
  return { opps_created, opps_closed, pipeline, appointments, leads, calls, directory, targets };
}

/* ============================================================================
 * lib/directory.js  — org source of truth (graceful when empty).
 * ========================================================================== */
function buildDirectory(store) {
  const people = store.directory || [];
  const byRep = {}; people.forEach((p) => { if (p.rep) byRep[p.rep] = p; });
  const distinct = (f) => [...new Set(people.map((p) => p[f]).filter(Boolean))].sort();
  // Rep options fall back to actual owners in the data if the directory is empty.
  const dataReps = [...new Set([...(store.opps_closed || []), ...(store.opps_created || [])].map((r) => r.owner).filter(Boolean))].sort();
  return { people, byRep, options: {
    company: distinct("company"), department: distinct("department"), team: distinct("team"),
    role: distinct("role"), rep: people.length ? distinct("rep") : dataReps } };
}
function repsInScope(dir, org) {
  const noOrgFilter = org.company === "All" && org.department === "All" && org.team === "All" && org.role === "All" && org.rep === "All";
  if (noOrgFilter) return null; // company-wide view: don't restrict by rep at all
  if (!dir.people.length) return org.rep !== "All" ? new Set([String(org.rep).trim()]) : null; // pass-through
  const matched = dir.people.filter((p) =>
    (org.company === "All" || p.company === org.company) && (org.department === "All" || p.department === org.department) &&
    (org.team === "All" || p.team === org.team) && (org.role === "All" || p.role === org.role) &&
    (org.rep === "All" || p.rep === org.rep));
  return new Set(matched.map((p) => String(p.rep).trim())); // trim so "Sam Dogbe " matches data's "Sam Dogbe"
}

/* ============================================================================
 * lib/dateRanges.js  — shared date vocabulary.
 * ========================================================================== */
const WEEK_START = 1;
const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const eod = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sow = (d) => { const x = sod(d); return addDays(x, -(((x.getDay() - WEEK_START) + 7) % 7)); };
const som = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const eom = (d) => eod(new Date(d.getFullYear(), d.getMonth() + 1, 0));
const soq = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const DATE_PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["this_week", "This Week"], ["last_week", "Last Week"],
  ["this_month", "This Month"], ["last_month", "Last Month"], ["this_quarter", "This Quarter"], ["last_quarter", "Last Quarter"],
  ["this_year", "This Year"], ["custom", "Custom Range"]];
function resolveRange(preset, custom, now = new Date()) {
  switch (preset) {
    case "today": return { start: sod(now), end: eod(now) };
    case "yesterday": { const y = addDays(now, -1); return { start: sod(y), end: eod(y) }; }
    case "this_week": return { start: sow(now), end: eod(now) };
    case "last_week": { const s = addDays(sow(now), -7); return { start: s, end: eod(addDays(s, 6)) }; }
    case "this_month": return { start: som(now), end: eod(now) };
    case "last_month": { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { start: s, end: eom(s) }; }
    case "this_quarter": return { start: soq(now), end: eod(now) };
    case "last_quarter": { const s = new Date(soq(now)); s.setMonth(s.getMonth() - 3); return { start: s, end: eom(new Date(s.getFullYear(), s.getMonth() + 2, 1)) }; }
    case "this_year": return { start: new Date(now.getFullYear(), 0, 1), end: eod(now) };
    case "custom": return { start: sod(new Date(custom.start)), end: eod(new Date(custom.end)) };
    default: return { start: som(now), end: eod(now) };
  }
}
const rangeDays = (r) => Math.max(1, Math.round((r.end - r.start) / 86400000) + 1);
// Handles M/D/YYYY (Coefficient default), ISO YYYY-MM-DD[ time], and Sheets serial numbers.
function parseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
  const s = String(v).trim();
  if (!s) return null;
  // ISO first: YYYY-MM-DD (optionally with a time component after)
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // US M/D/Y or M-D-Y, optionally followed by a time — no strict end anchor
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[1] - 1, +m[2]); }
  const d = new Date(s); return isNaN(d) ? null : d;
}
const monthKey = (v) => { const d = parseDate(v); return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : null; };

/* ============================================================================
 * lib/filters.js  — one engine. Datasets without a dateField ignore the date
 * filter (e.g. opps_created has no per-row date).
 * ========================================================================== */
function applyFilters(rows, ds, org, range, dir) {
  const reps = ds.repField ? repsInScope(dir, org) : null;
  const dateOn = !!(ds.dateField && rows.some((r) => r[ds.dateField])); // off until a date column exists
  return rows.filter((row) => {
    if (reps && !reps.has(String(row[ds.repField] ?? "").trim())) return false;
    if (dateOn) { const t = parseDate(row[ds.dateField]); if (!t || t < range.start || t > range.end) return false; }
    return true;
  });
}

/* ============================================================================
 * config/kpis.js + lib/kpiEngine.js
 * ========================================================================== */
const num = (v) => Number(v) || 0;
const isQC = (r) => num(r.qc) === 1; // smrtPhone QC Y/N flag
const isOpen = (s) => s && !/closed/i.test(s);
const KPIS = {
  closed_revenue: { id: "closed_revenue", label: "Closed Revenue", dataset: "opps_closed", format: "currency",
    targetKey: "closed_revenue", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.reduce((s, o) => s + num(o.revenue), 0) },
  deals_closed: { id: "deals_closed", label: "Deals Closed", dataset: "opps_closed", format: "number",
    targetKey: "deals_closed", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  avg_deal: { id: "avg_deal", label: "Avg Deal Size", dataset: "opps_closed", format: "currency",
    compute: (rows) => rows.length ? rows.reduce((s, o) => s + num(o.revenue), 0) / rows.length : 0 },
  pipeline_forecast: { id: "pipeline_forecast", label: "Pipeline (forecast)", dataset: "pipeline", format: "currency",
    targetKey: "pipeline_forecast", targetType: "volume", higherIsBetter: true,
    qualify: (o) => isOpen(o.stage), agg: (rows) => rows.reduce((s, o) => s + num(o.forecast), 0) },
  opps_created: { id: "opps_created", label: "Opps Created", dataset: "opps_created", format: "number",
    targetKey: "opps_created", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  appointments: { id: "appointments", label: "Appointments Set", dataset: "appointments", format: "number",
    targetKey: "appointments", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  leads: { id: "leads", label: "Leads", dataset: "leads", format: "number",
    targetKey: "leads", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  calls: { id: "calls", label: "Calls Logged", dataset: "calls", format: "number",
    targetKey: "calls", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  talk_time: { id: "talk_time", label: "Total Talk Time", dataset: "calls", format: "minutes",
    targetKey: "talk_time", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.reduce((s, r) => s + num(r.durationMin), 0) },
  qcs: { id: "qcs", label: "Total QCs", dataset: "calls", format: "number",
    targetKey: "qcs", targetType: "volume", higherIsBetter: true, qualify: isQC, agg: (rows) => rows.length },
};
function resolveTarget(kpi, store, org, range) {
  const rows = (store.targets || []).filter((t) => t.kpiId === kpi.targetKey);
  const tries = [];
  if (org.rep !== "All") tries.push(["Rep", org.rep]);
  if (org.team !== "All") tries.push(["Team", org.team]);
  if (org.role !== "All") tries.push(["Role", org.role]);
  if (org.department !== "All") tries.push(["Department", org.department]);
  tries.push(["Company", org.company === "All" ? "Leverage Homes" : org.company]);
  let base = null;
  for (const [scope, val] of tries) { const hit = rows.find((t) => t.scope === scope && t.scopeValue === val); if (hit) { base = num(hit.value); break; } }
  if (base == null) return null;
  return kpi.targetType === "rate" ? base : base * (rangeDays(range) / 30.4);
}
function computeKpi(kpi, store, dir, org, range) {
  const ds = DATASETS[kpi.dataset];
  const filtered = applyFilters(store[kpi.dataset] || [], ds, org, range, dir);
  const value = kpi.compute ? kpi.compute(filtered) : kpi.agg(kpi.qualify ? filtered.filter(kpi.qualify) : filtered);
  const target = kpi.targetKey ? resolveTarget(kpi, store, org, range) : null;
  let progress = null, variance = null, status = "none";
  if (target != null && target !== 0) {
    progress = value / target; variance = kpi.higherIsBetter ? value / target - 1 : target / value - 1;
    status = (kpi.higherIsBetter ? progress >= 1 : value <= target) ? "good"
      : (kpi.higherIsBetter ? progress >= 0.85 : value <= target * 1.15) ? "warn" : "bad";
  }
  return { value, target, progress, variance, status, rows: filtered };
}
const fmt = (v, f) => { if (v == null || isNaN(v)) return "—";
  if (f === "currency") return (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString();
  if (f === "percent") return (v * 100).toFixed(1) + "%";
  if (f === "minutes") return Math.round(v).toLocaleString() + " min"; return Math.round(v).toLocaleString(); };

/* ============================================================================
 * components/*
 * ========================================================================== */
function Select({ label, value, onChange, options }) {
  return (<label className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="text-sm rounded-md px-2.5 py-1.5 outline-none"
      style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>
      <option value="All">All</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>);
}
function FilterBar({ org, setOrg, date, setDate, dir }) {
  const set = (k) => (v) => setOrg({ ...org, [k]: v });
  return (<div className="rounded-xl p-4 mb-5" style={{ background: T.card, border: `1px solid ${T.border}` }}>
    <div className="flex flex-wrap gap-3 items-end">
      <Select label="Company" value={org.company} onChange={set("company")} options={dir.options.company} />
      <Select label="Department" value={org.department} onChange={set("department")} options={dir.options.department} />
      <Select label="Team" value={org.team} onChange={set("team")} options={dir.options.team} />
      <Select label="Role" value={org.role} onChange={set("role")} options={dir.options.role} />
      <Select label="Rep" value={org.rep} onChange={set("rep")} options={dir.options.rep} />
      <div className="w-px self-stretch mx-1" style={{ background: T.border }} />
      <label className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>Period</span>
        <select value={date.preset} onChange={(e) => setDate({ ...date, preset: e.target.value })} className="text-sm rounded-md px-2.5 py-1.5 outline-none"
          style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>{DATE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {date.preset === "custom" && (<>
        <label className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>From</span>
          <input type="date" value={date.start} onChange={(e) => setDate({ ...date, start: e.target.value })} className="text-sm rounded-md px-2.5 py-1.5 outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>To</span>
          <input type="date" value={date.end} onChange={(e) => setDate({ ...date, end: e.target.value })} className="text-sm rounded-md px-2.5 py-1.5 outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink }} /></label></>)}
    </div></div>);
}
function KpiCard({ kpi, result }) {
  const color = result.status === "good" ? T.good : result.status === "warn" ? T.warn : result.status === "bad" ? T.bad : T.faint;
  const pct = result.progress == null ? null : Math.min(1, Math.max(0, result.progress));
  return (<div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: T.card, border: `1px solid ${T.border}` }}>
    <div className="flex items-start justify-between"><span className="text-[13px] font-medium" style={{ color: T.sub }}>{kpi.label}</span>
      {result.variance != null && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color, background: result.status === "good" ? T.accentSoft : "transparent" }}>{result.variance >= 0 ? "+" : ""}{(result.variance * 100).toFixed(0)}%</span>}</div>
    <div className="text-[26px] font-semibold leading-none" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{fmt(result.value, kpi.format)}</div>
    {result.target != null ? (<div className="flex flex-col gap-1.5">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: T.track }}><div className="h-full rounded-full" style={{ width: `${(pct || 0) * 100}%`, background: color }} /></div>
      <span className="text-[11px]" style={{ color: T.faint }}>{result.progress != null ? `${(result.progress * 100).toFixed(0)}% of ` : ""}{fmt(result.target, kpi.format)} target</span></div>)
      : <span className="text-[11px]" style={{ color: T.faint }}>No target set</span>}</div>);
}
function Panel({ title, children }) {
  return (<div className="rounded-xl p-4" style={{ background: T.card, border: `1px solid ${T.border}` }}>
    <h3 className="text-[13px] font-semibold mb-3" style={{ color: T.sub }}>{title}</h3>{children}</div>);
}
function Notes({ diagnostics, mode }) {
  return (<div className="rounded-xl p-4 mb-5" style={{ background: T.warnSoft, border: `1px solid ${T.warn}33` }}>
    <div className="text-[13px] font-semibold mb-1" style={{ color: T.warn }}>Data notes</div>
    <ul className="text-[12px] flex flex-col gap-1" style={{ color: T.ink }}>
      <li>All six workbooks are wired: Opportunities, Pipeline, Activities (appointments), Marketing (leads), Tasks (calls), Context (directory). Date filtering is active on every dataset that carries a date column (all now do).</li>
      <li><b>Targets</b> is the one open item — it appears to be a second tab inside the Context workbook, not yet confirmed. Goal-progress bars stay at “No target set” until that tab is mapped.</li>
      {mode === "google" && diagnostics.map((d) => <li key={d.dataset} style={{ color: T.warn }}>⧗ {d.dataset}: {d.note}</li>)}
    </ul></div>);
}

/* ============================================================================
 * pages/ExecutiveDashboard.jsx
 * ========================================================================== */
function ExecutiveDashboard({ store, dir, org, range }) {
  const cards = ["closed_revenue", "deals_closed", "avg_deal", "pipeline_forecast", "opps_created", "appointments", "leads", "calls", "talk_time", "qcs"];
  const results = useMemo(() => Object.fromEntries(cards.map((id) => [id, computeKpi(KPIS[id], store, dir, org, range)])), [store, dir, org, range]);

  const byMonth = useMemo(() => { const m = {};
    results.closed_revenue.rows.forEach((o) => { const k = monthKey(o.closeDate); if (k) m[k] = (m[k] || 0) + num(o.revenue); });
    return Object.entries(m).sort().map(([k, v]) => ({ label: k, value: v })); }, [results.closed_revenue.rows]);
  const byStage = useMemo(() => { const m = {};
    results.pipeline_forecast.rows.filter((o) => isOpen(o.stage)).forEach((o) => { m[o.stage] = (m[o.stage] || 0) + num(o.forecast); });
    return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value); }, [results.pipeline_forecast.rows]);
  const leaderboard = useMemo(() => {
    const by = {}; results.closed_revenue.rows.forEach((o) => { const k = o.owner || "—"; (by[k] = by[k] || { owner: k, rev: 0, deals: 0 }); by[k].rev += num(o.revenue); by[k].deals += 1; });
    return Object.values(by).map((x) => ({ ...x, team: dir.byRep[x.owner]?.team, avg: x.deals ? x.rev / x.deals : 0 })).sort((a, b) => b.rev - a.rev);
  }, [results.closed_revenue.rows, dir]);
  const repActivity = useMemo(() => {
    const by = {};
    results.calls.rows.forEach((r) => { const k = r.rep || "—";
      (by[k] = by[k] || { rep: k, minutes: 0, qcs: 0, calls: 0 });
      by[k].minutes += num(r.durationMin); if (isQC(r)) by[k].qcs += 1; by[k].calls += 1; });
    return Object.values(by).map((x) => ({ ...x, team: dir.byRep[x.rep]?.team })).sort((a, b) => b.minutes - a.minutes);
  }, [results.calls.rows, dir]);

  return (<div className="flex flex-col gap-5">
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>{cards.map((id) => <KpiCard key={id} kpi={KPIS[id]} result={results[id]} />)}</div>
    <div className="grid gap-5" style={{ gridTemplateColumns: "3fr 2fr" }}>
      <Panel title="Closed revenue by month (Total Net Revenue)"><div style={{ height: 240 }}><ResponsiveContainer>
        <BarChart data={byMonth} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.track} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} width={48} />
          <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>{byMonth.map((d, i) => <Cell key={i} fill={d.value < 0 ? T.bad : T.accent} />)}</Bar>
        </BarChart></ResponsiveContainer></div></Panel>
      <Panel title="Open pipeline by stage (forecast)"><div style={{ height: 240 }}><ResponsiveContainer>
        <BarChart data={byStage} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.track} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: T.sub }} axisLine={false} tickLine={false} width={128} />
          <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>{byStage.map((_, i) => <Cell key={i} fill={T.chart[i % T.chart.length]} />)}</Bar>
        </BarChart></ResponsiveContainer></div></Panel>
    </div>
    <Panel title="Owner leaderboard (closed revenue)">
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead><tr style={{ color: T.faint }} className="text-left text-[11px] uppercase tracking-wide">
          <th className="pb-2 font-medium">Owner</th><th className="pb-2 font-medium">Team</th>
          <th className="pb-2 font-medium text-right">Closed Revenue</th><th className="pb-2 font-medium text-right">Deals</th><th className="pb-2 font-medium text-right">Avg Deal</th></tr></thead>
        <tbody>{leaderboard.map((row) => (<tr key={row.owner} style={{ borderTop: `1px solid ${T.border}`, color: T.ink }}>
          <td className="py-2 font-medium">{row.owner}</td><td className="py-2" style={{ color: T.sub }}>{row.team || "—"}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums", color: row.rev < 0 ? T.bad : T.ink }}>{fmt(row.rev, "currency")}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.deals}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(row.avg, "currency")}</td></tr>))}</tbody>
      </table></Panel>
    <Panel title="Rep activity (talk time &amp; QCs)">
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead><tr style={{ color: T.faint }} className="text-left text-[11px] uppercase tracking-wide">
          <th className="pb-2 font-medium">Rep</th><th className="pb-2 font-medium">Team</th>
          <th className="pb-2 font-medium text-right">Talk Time</th><th className="pb-2 font-medium text-right">QCs</th><th className="pb-2 font-medium text-right">Calls</th></tr></thead>
        <tbody>{repActivity.map((row) => (<tr key={row.rep} style={{ borderTop: `1px solid ${T.border}`, color: T.ink }}>
          <td className="py-2 font-medium">{row.rep}</td><td className="py-2" style={{ color: T.sub }}>{row.team || "—"}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(row.minutes, "minutes")}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.qcs.toLocaleString()}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.calls.toLocaleString()}</td></tr>))}</tbody>
      </table></Panel>
  </div>);
}

/* ============================================================================
 * App.jsx
 * ========================================================================== */
export default function App() {
  const [st, setSt] = useState({ loading: true, error: null, store: null, dir: null, diagnostics: [], mode: "mock" });
  const [org, setOrg] = useState({ company: "All", department: "All", team: "All", role: "All", rep: "All" });
  const [date, setDate] = useState({ preset: "this_year", start: "2026-01-01", end: iso(new Date()) });
  const range = useMemo(() => resolveRange(date.preset, date, new Date()), [date]);

  useEffect(() => { let alive = true;
    (async () => { try { const { store, diagnostics, mode } = await loadAll();
      if (alive) setSt({ loading: false, error: null, store, dir: buildDirectory(store), diagnostics, mode }); }
      catch (e) { if (alive) setSt((s) => ({ ...s, loading: false, error: String(e.message || e) })); } })();
    return () => { alive = false; }; }, []);

  const shell = (body) => (<div className="min-h-screen w-full" style={{ background: T.canvas, ...FONT }}>
    <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${T.border}`, background: T.card }}>
      <div className="flex items-center gap-3"><div className="w-2 h-6 rounded-sm" style={{ background: T.accent }} />
        <div><div className="text-[15px] font-semibold" style={{ color: T.ink }}>Leverage Homes</div><div className="text-[11px]" style={{ color: T.faint }}>Executive Dashboard</div></div></div>
      <div className="text-[11px] flex items-center gap-2" style={{ color: T.faint }}>
        <span className="px-2 py-0.5 rounded-full" style={{ background: st.mode === "google" ? T.accentSoft : T.track, color: st.mode === "google" ? T.good : T.sub }}>{st.mode === "google" ? "Live · Google Sheets" : "Sample data"}</span>
        <span>{iso(range.start)} → {iso(range.end)}</span></div></div>
    <div className="p-6 max-w-[1200px] mx-auto">{body}</div></div>);

  if (st.loading) return shell(<div className="text-sm" style={{ color: T.faint }}>Loading data…</div>);
  if (st.error) return shell(<div className="rounded-xl p-4 text-sm" style={{ background: T.warnSoft, border: `1px solid ${T.warn}33`, color: T.ink }}>
    <div className="font-semibold mb-1" style={{ color: T.warn }}>Couldn’t load Google Sheets</div><div style={{ color: T.sub }}>{st.error}</div>
    <div className="mt-2" style={{ color: T.faint }}>Check the API key, that the Sheets API is enabled, and each workbook is shared “Anyone with the link → Viewer.”</div></div>);

  return shell(<>
    <FilterBar org={org} setOrg={setOrg} date={date} setDate={setDate} dir={st.dir} />
    <Notes diagnostics={st.diagnostics} mode={st.mode} />
    <ExecutiveDashboard store={st.store} dir={st.dir} org={org} range={range} />
    <p className="text-[11px] mt-5" style={{ color: T.faint }}>Phase 3 · auto-tab-union model · {st.mode === "google" ? "live Sheets via public API key" : "sample data (set API_KEY to go live)"}</p>
  </>);
}
