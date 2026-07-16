import React, { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
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

const THEMES = {
  light: { // clean, bright — Leverage Homes marketing feel
    canvas: "#F6F7F9", card: "#FFFFFF", border: "#E6E9ED", ink: "#0F1B2D",
    sub: "#5B6675", faint: "#8A94A3", accent: "#127A56", accentSoft: "#E7F2ED",
    good: "#127A56", warn: "#B45309", bad: "#BE123C", track: "#EEF1F4", warnSoft: "#FBF1E4",
    chart: ["#127A56", "#2E9E78", "#5FB89A", "#0F1B2D", "#4A5A6E", "#93CDB8", "#B45309"],
  },
  dark: { // deep navy — Leverage Companies hero feel
    canvas: "#0A0F1A", card: "#121A2A", border: "#25324A", ink: "#EAF1F8",
    sub: "#A7B6C9", faint: "#6E7E93", accent: "#34C08C", accentSoft: "#123528",
    good: "#34C08C", warn: "#E0A63E", bad: "#F2607F", track: "#1B2740", warnSoft: "#2A2214",
    chart: ["#34C08C", "#5FD3A8", "#8FE3C4", "#7FA0C9", "#A7B6C9", "#2E9E78", "#E0A63E"],
  },
};
let T = THEMES.light; // active theme — App reassigns from the mode toggle; every T.* read picks it up on re-render
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
  leads_wb:      { id: "1iS4PLBML63qWqpgWwxRH83jFVw7TJ9SAlHK06JQ2MmI", title: "Homes Dashboard Pt 1 (Leads)" },
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
    dateCandidates: ["Created Date", "Create Date", "Date Created", "Opportunity Created Date"], repField: "createdBy", // per-rep = who CREATED it (setter), not who owns it (closer)
  },
  opps_closed: { // ✔  actuals — Total Net Revenue by Close Date
    workbook: "opportunities",
    require: ["Total Net Revenue", "Close Date"], exclude: [],
    schema: { owner: "Opportunity Owner", name: "Opportunity Name", revenue: "Total Net Revenue",
      acqManager: "Acquisition Manager", acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", closeDate: "Close Date", txType: "Transaction Type" },
    // a rep is credited on a closed deal via ANY of these roles (owner / AM / AM2 / follow-up), not just owner
    dedupe: (r) => `${r.name}|${r.closeDate}`, dateField: "closeDate",
    repField: "owner", repFields: ["owner", "acqManager", "acqManager2", "followUp"],
  },
  pipeline: { // ✔  "YTD x Pipeline Forecast" — one row per deal w/ owner, lead source, transaction type, forecasted+net rev, stage, close date
    workbook: "pipeline",
    require: ["Total Forecasted Revenue", "Opportunity Owner", "Lead Source"], exclude: [], tabInclude: /YTD x Pipeline Forecast/i,
    schema: { name: "Opportunity Name", stage: "Stage", projected: "Projected Net Revenue", forecast: "Total Forecasted Revenue",
      netRev: "Total Net Revenue", closeDate: "Close Date", owner: "Opportunity Owner", acqManager: "Acquisition Manager",
      acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", source: "Lead Source", txType: "Transaction Type", segment: "Marketing Segmentation" },
    dedupe: (r) => r.name, dateField: null, repFields: ["owner", "acqManager", "acqManager2", "followUp"], // snapshot (no date filter); now per-rep & per-channel
  },
  arip: { // ✔  Pipeline workbook — per-rep "Arips to Deal Review" tabs = deals that LEFT ARIP and where they went (New Value = destination)
    workbook: "pipeline",
    require: ["out of arip", "Acquisition Manager", "Edit Date"], exclude: [], tabInclude: /Arips to Deal Review/i, tabField: "__tab",
    schema: { name: "Opportunity Name", stage: "Stage", rep: "Acquisition Manager", followUp: "Follow Up Specialist",
      source: "Lead Source", projected: "Projected Net Revenue", newValue: "New Value", outArip: "out of arip", tab: "__tab" },
    dedupe: null, dateField: "date", dateCandidates: ["Edit Date"], repField: "rep", // final rep resolved in loadAll (needs directory for first→full-name)
  },
  arip_out: { // ✔  Pipeline workbook — "Opps - Out of ARIP - YTD": every opp that LEFT ARIP + where it went (New Value). Drives pull-through as a RUNNING TOTAL (no date filter).
    workbook: "pipeline",
    require: ["New Value", "Opportunity ID", "Follow Up Specialist"], exclude: [], tabInclude: /Opps - Out of ARIP/i,
    schema: { id: "Opportunity ID", name: "Opportunity Name", owner: "Opportunity Owner", acqManager: "Acquisition Manager",
      acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", newValue: "New Value", oldValue: "Old Value",
      txType: "Transaction Type", icp: "ISA ICP Total Score", source: "Lead Source", segment: "Marketing Segmentation" },
    dedupe: null, dateField: null, repFields: ["owner", "acqManager", "acqManager2", "followUp"], // running total; per-rep & per-channel capable
  },
  arip_entered: { // ✔  Opportunities workbook — "Opps - ARIP - YTD": opps whose stage changed to Arip; shared credit across the deal team (like closed revenue)
    workbook: "opportunities",
    require: ["New Value", "Opportunity Owner", "Acquisition Manager"], exclude: [], tabInclude: /Opps - ARIP/i,
    schema: { id: "Opportunity ID", name: "Opportunity Name", owner: "Opportunity Owner", acqManager: "Acquisition Manager",
      acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", newValue: "New Value", oldValue: "Old Value", icp: "ISA ICP Total Score", txType: "Transaction Type" },
    dedupe: (r) => `${r.id}|${r.date}`, dateField: "date", dateCandidates: ["Edit Date"], repFields: ["owner", "acqManager", "acqManager2", "followUp"],
  },
  appt_funnel: { // ✔  Pipeline workbook — "Totals Appt To Arip": appointment→ARIP funnel (appt-type mix + which appts led to an ARIP). No appt date in export → appts are all-time.
    workbook: "pipeline",
    require: ["Deals to Arip", "Created By", "Appointment Type"], exclude: [], tabInclude: /Totals Appt To Arip/i,
    schema: { name: "Opportunity Name", rep: "Created By", flag: "Deals to Arip", apptType: "Appointment Type", aripDate: "Arip Date" },
    dedupe: null, dateField: null, repField: "rep",
  },
  appointments: { // ✔  Activities workbook — real appointment events
    workbook: "activities",
    require: ["Appointment Outcome", "Event Type"], exclude: [],
    schema: { subject: "Subject", createdBy: "Created By", rep: "Assigned",
      outcome: "Appointment Outcome", eventType: "Event Type" },
    dedupe: null, dateField: "date", dateCandidates: ["Created Date", "Create Date"], repField: "createdBy", // per-rep = the SETTER (Created By); Assigned is the attendee, handled in the scorecard
  },
  leads: { // ✔  Marketing workbook — the 5 per-source lead tabs (Call Center, Texting, Website, Direct Mail, PPL)
    workbook: "marketing",
    require: ["Lead ID", "Lead Source"], exclude: [], tabExclude: /^All leads|Reactivated/i, // drop the mislabeled "All leads" (a Call-Center dup) and Reactivated
    schema: { leadId: "Lead ID", account: "Company / Account", status: "Lead Status",
      icp: "Total Tier 1 ICP", segment: "Marketing Segmentation", source: "Lead Source" },
    dedupe: (r) => r.leadId, dateField: "date", dateCandidates: ["Create Date", "Created Date"], repField: null,
  },
  mkt_opps: { // ✔  Marketing workbook — opps created tagged with Lead Source + Segmentation
    workbook: "marketing",
    require: ["Opportunity ID", "Lead Source"], exclude: [], tabInclude: /All Opps/i,
    schema: { id: "Opportunity ID", name: "Opportunity Name", source: "Lead Source",
      segment: "Marketing Segmentation", icp: "Total ICP Score", isaIcp: "ISA ICP Total Score" },
    dedupe: (r) => r.id, dateField: "date", dateCandidates: ["Created Date"], repField: null,
  },
  reactivated: { // ✔  Marketing workbook — leads reactivated (Lead Status change) by source
    workbook: "marketing",
    require: ["Lead ID", "Field / Event"], exclude: [], tabInclude: /Reactivated/i,
    schema: { leadId: "Lead ID", source: "Lead Source", segment: "Marketing Segmentation",
      oldValue: "Old Value", newValue: "New Value" },
    dedupe: (r) => r.leadId, dateField: "date", dateCandidates: ["Edit Date"], repField: null,
  },
  leads_claimed: { // ✔  Leads workbook — Salesforce owner-change history; New Value = the rep who claimed the lead
    workbook: "leads_wb",
    require: ["Lead ID", "New Value", "Edit Date"], exclude: [], tabInclude: /Leads Claimed/i, // Deaded tabs share headers
    schema: { leadId: "Lead ID", account: "Company", status: "Lead Status", icp: "Total Tier 1 ICP",
      rep: "New Value", oldValue: "Old Value" },
    // one rep can re-claim the same lead across months — dedupe to distinct (rep, lead) so it counts leads, not events
    dedupe: (r) => `${String(r.rep).trim()}|${r.leadId}`, dateField: "date", dateCandidates: ["Edit Date"], repField: "rep",
  },
  leads_deaded: { // ✔  Leads workbook — status→Dead history; Edited By = the rep who marked it dead (New Value is just "Dead")
    workbook: "leads_wb",
    require: ["Lead ID", "Edited By", "Edit Date"], exclude: [], tabInclude: /Leads Deaded/i,
    schema: { leadId: "Lead ID", account: "Company", status: "Lead Status", icp: "Total Tier 1 ICP",
      rep: "Edited By", oldValue: "Old Value", newValue: "New Value" },
    dedupe: (r) => `${String(r.rep).trim()}|${r.leadId}`, dateField: "date", dateCandidates: ["Edit Date"], repField: "rep",
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
// A tab belongs to a dataset if its headers include all `require`, none of `exclude`,
// and (optionally) its title matches `tabInclude` / avoids `tabExclude` — needed when
// two tab families share identical headers (e.g. Leads Claimed vs Leads Deaded).
function tabMatches(headers, ds, title = "") {
  const h = headers || [];
  if (!(ds.require.every((x) => h.includes(x)) && !ds.exclude.some((x) => h.includes(x)))) return false;
  if (ds.tabInclude && !ds.tabInclude.test(title)) return false;
  if (ds.tabExclude && ds.tabExclude.test(title)) return false;
  return true;
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
        if (tabMatches(parsed.headers, ds, title)) {
          const tabRows = ds.tabField ? parsed.rows.map((r) => ({ ...r, [ds.tabField]: title })) : parsed.rows; // carry the tab name when the rep lives in the tab, not a column
          rows = rows.concat(tabRows); claimed.push(title);
        }
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
  // ARIP rep = Acquisition Manager when present; otherwise derive from the tab's first name (VP/Follow-Up tabs leave AM blank).
  if (store.arip) {
    const first2full = {};
    (store.directory || []).forEach((p) => { const f = String(p.rep || "").trim().split(/\s+/)[0].toLowerCase(); if (f && !first2full[f]) first2full[f] = String(p.rep).trim(); });
    store.arip = dedupe(store.arip.map((r) => {
      let rep = String(r.rep || "").trim();
      if (!rep) { const f = String(r.tab || "").split("-").pop().trim().toLowerCase(); rep = first2full[f] || f; }
      return { ...r, rep };
    }), (r) => `${String(r.rep).trim()}|${r.name}|${r.newValue}|${r.date}`); // distinct exit events, not just rep|opp
    if (useGoogle) console.log(`[arip] ${store.arip.length} rows after rep resolution`);
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
  const clean = (v) => (typeof v === "string" ? v.trim() : v); // stray trailing spaces in the sheet must never create phantom dropdown values or break rep matching
  const people = (store.directory || []).map((p) => ({ ...p, rep: clean(p.rep), name: clean(p.name), role: clean(p.role), team: clean(p.team), department: clean(p.department), company: clean(p.company) }));
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
  const fields = ds.repFields || (ds.repField ? [ds.repField] : null); // a rep can be credited through several role columns
  const reps = fields ? repsInScope(dir, org) : null;
  const dateOn = !!(range && ds.dateField && rows.some((r) => r[ds.dateField])); // off when no range is passed (period-independent charts) or no date column
  return rows.filter((row) => {
    if (reps && !fields.some((f) => reps.has(String(row[f] ?? "").trim()))) return false;
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
const groupSum = (rows, keyFn, valFn) => { const m = {}; rows.forEach((r) => { const k = keyFn(r); if (k) m[k] = (m[k] || 0) + valFn(r); }); return Object.entries(m).map(([label, value]) => ({ label, value })); };
const txTypeOf = (r) => String(r.txType ?? "").trim();
const ALL_ORG = { company: "All", department: "All", team: "All", role: "All", rep: "All" }; // date-only pass for per-rep scorecard
const KPIS = {
  closed_revenue: { id: "closed_revenue", label: "Closed Revenue", dataset: "opps_closed", format: "currency",
    targetKey: "closed_revenue", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.reduce((s, o) => s + num(o.revenue), 0),
    breakoutBy: (rows) => groupSum(rows, txTypeOf, (r) => num(r.revenue)) }, // splits by transaction type once that column is on the Closed Opps report; else falls back to team
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
    targetKey: "appointments", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length,
    breakoutBy: (rows) => groupSum(rows, (r) => String(r.eventType || "").replace(/ Appointment$/i, "").trim() || "(unset)", () => 1) },
  opps_to_arip: { id: "opps_to_arip", label: "Opps → ARIP", dataset: "arip_entered", format: "number", higherIsBetter: true,
    agg: (rows) => rows.length,
    breakoutBy: (rows) => groupSum(rows, (r) => txTypeOf(r) || "(unset)", () => 1) }, // distinct opps whose stage moved to Arip; shared credit across the deal team
  arip_dealreview: { id: "arip_dealreview", label: "ARIP → Deal Review", dataset: "arip", format: "number", higherIsBetter: true,
    qualify: (r) => String(r.newValue).trim() === "Deal Review" && Number(r.outArip) === 1, agg: (rows) => rows.length }, // advanced past ARIP
  arip_pullthrough: { id: "arip_pullthrough", label: "ARIP Pull-Through", dataset: "arip_out", format: "percent", higherIsBetter: true,
    compute: (rows) => { if (!rows.length) return 0;
      return rows.filter((r) => ["Deal Review", "Pre Marketing"].includes(String(r.newValue).trim())).length / rows.length; } }, // positive (Deal Review/Pre Marketing) ÷ all that left ARIP
  leads: { id: "leads", label: "Leads", dataset: "leads", format: "number", domain: "marketing", // marketing funnel volume — only shown in the Marketing team view
    targetKey: "leads", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  leads_call_center: { id: "leads_call_center", label: "Call Center", dataset: "leads", format: "number", domain: "marketing",
    qualify: (r) => r.source === "Call Center", agg: (rows) => rows.length },
  leads_texting: { id: "leads_texting", label: "Texting", dataset: "leads", format: "number", domain: "marketing",
    qualify: (r) => r.source === "Text Message Campaign", agg: (rows) => rows.length },
  leads_website: { id: "leads_website", label: "Website", dataset: "leads", format: "number", domain: "marketing",
    qualify: (r) => r.source === "Website", agg: (rows) => rows.length },
  leads_direct_mail: { id: "leads_direct_mail", label: "Direct Mail", dataset: "leads", format: "number", domain: "marketing",
    qualify: (r) => r.source === "Direct Mail Campaign", agg: (rows) => rows.length },
  leads_ppl: { id: "leads_ppl", label: "PPL", dataset: "leads", format: "number", domain: "marketing",
    qualify: (r) => r.source === "Pay Per Lead", agg: (rows) => rows.length },
  reactivated_leads: { id: "reactivated_leads", label: "Reactivated Leads", dataset: "reactivated", format: "number", domain: "marketing",
    agg: (rows) => rows.length },
  mkt_opps_created: { id: "mkt_opps_created", label: "Opps Created (sourced)", dataset: "mkt_opps", format: "number", domain: "marketing",
    agg: (rows) => rows.length },
  avg_lead_icp: { id: "avg_lead_icp", label: "Avg Lead ICP", dataset: "leads", format: "decimal", domain: "marketing",
    compute: (rows) => rows.length ? rows.reduce((s, r) => s + num(r.icp), 0) / rows.length : 0 },
  leads_claimed: { id: "leads_claimed", label: "Leads Claimed", dataset: "leads_claimed", format: "number",
    targetKey: "leads_claimed", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  leads_deaded: { id: "leads_deaded", label: "Leads Deaded", dataset: "leads_deaded", format: "number",
    targetKey: "leads_deaded", targetType: "volume", higherIsBetter: false, agg: (rows) => rows.length },
  calls: { id: "calls", label: "Calls Logged", dataset: "calls", format: "number",
    targetKey: "calls", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  talk_time: { id: "talk_time", label: "Total Talk Time", dataset: "calls", format: "minutes",
    targetKey: "talk_time", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.reduce((s, r) => s + num(r.durationMin), 0) },
  qcs: { id: "qcs", label: "Total QCs", dataset: "calls", format: "number",
    targetKey: "qcs", targetType: "volume", higherIsBetter: true, qualify: isQC, agg: (rows) => rows.length,
    breakoutBy: (rows) => { const q = rows.filter(isQC); const c = (m) => q.filter((r) => num(r.durationMin) >= m).length; return [{ label: "3+ min", value: c(3) }, { label: "5+ min", value: c(5) }, { label: "10+ min", value: c(10) }]; } },
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
  // Datasets with no per-row rep can't honor a person/team/role filter — say so instead of showing a company-wide number.
  const peopleFilter = org.department !== "All" || org.team !== "All" || org.role !== "All" || org.rep !== "All";
  if (!(ds.repField || ds.repFields) && peopleFilter && kpi.domain !== "marketing" && !ds.companyScope)
    return { value: null, target: null, progress: null, variance: null, status: "none", rows: [], unattributable: true };
  const filtered = applyFilters(store[kpi.dataset] || [], ds, org, range, dir);
  const value = kpi.compute ? kpi.compute(filtered) : kpi.agg(kpi.qualify ? filtered.filter(kpi.qualify) : filtered);
  const target = kpi.targetKey ? resolveTarget(kpi, store, org, range) : null;
  let progress = null, variance = null, status = "none";
  if (target != null && target !== 0) {
    progress = value / target; variance = kpi.higherIsBetter ? value / target - 1 : target / value - 1;
    status = (kpi.higherIsBetter ? progress >= 1 : value <= target) ? "good"
      : (kpi.higherIsBetter ? progress >= 0.85 : value <= target * 1.15) ? "warn" : "bad";
  }
  return { value, target, progress, variance, status, rows: filtered, companyWide: !!(ds.companyScope && peopleFilter) };
}
const fmt = (v, f) => { if (v == null || isNaN(v)) return "—";
  if (f === "currency") return (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString();
  if (f === "percent") return (v * 100).toFixed(1) + "%";
  if (f === "minutes") return Math.round(v).toLocaleString() + " min";
  if (f === "decimal") return (Math.round(v * 10) / 10).toFixed(1); return Math.round(v).toLocaleString(); };
// Count rows by a key and attach share-of-total — used for the marketing breakdown bars.
function breakdown(rows, keyFn) {
  const m = {}; rows.forEach((r) => { const k = String(keyFn(r) ?? "").trim() || "(unset)"; m[k] = (m[k] || 0) + 1; });
  const total = rows.length || 1;
  return { total: rows.length, items: Object.entries(m).map(([label, count]) => ({ label, count, pct: count / total })).sort((a, b) => b.count - a.count) };
}
function Bars({ items, tint }) {
  return (<div className="flex flex-col gap-2">{items.map((o) => (
    <div key={o.label} className="flex items-center gap-3">
      <div className="text-[12px] shrink-0" style={{ width: 160, color: T.sub }}>{o.label}</div>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${Math.round(o.pct * 100)}%`, height: "100%", background: tint || T.accent }} /></div>
      <div className="text-[12px] text-right shrink-0" style={{ width: 110, fontVariantNumeric: "tabular-nums", color: T.ink }}>{o.count.toLocaleString()} · {(o.pct * 100).toFixed(1)}%</div>
    </div>))}</div>);
}

/* ============================================================================
 * components/*
 * ========================================================================== */
// Cascading org options — each level is narrowed by the selections above it, so impossible combos can't be picked.
function orgOptions(dir, org) {
  const people = dir.people || [];
  if (!people.length) return dir.options; // fallback to static lists (e.g. data-derived reps) when directory is empty
  const uniq = (arr, f) => [...new Set(arr.map(f).filter(Boolean))].sort();
  const match = (p, keys) => keys.every((k) => org[k] === "All" || p[k] === org[k]);
  return {
    company: uniq(people, (p) => p.company),
    department: uniq(people.filter((p) => match(p, ["company"])), (p) => p.department),
    team: uniq(people.filter((p) => match(p, ["company", "department"])), (p) => p.team),
    role: uniq(people.filter((p) => match(p, ["company", "department", "team"])), (p) => p.role),
    rep: uniq(people.filter((p) => match(p, ["company", "department", "team", "role"])), (p) => p.rep),
  };
}
function ViewToggle({ view, setView }) {
  const tabs = [["sales", "Sales"], ["marketing", "Marketing"], ["transactions", "Transactions"]];
  return (<div className="inline-flex rounded-lg p-0.5 mb-4" style={{ background: T.track, border: `1px solid ${T.border}` }}>
    {tabs.map(([v, l]) => (
      <button key={v} onClick={() => setView(v)} className="text-[13px] font-medium px-3.5 py-1.5 rounded-md transition-colors"
        style={{ background: view === v ? T.card : "transparent", color: view === v ? T.ink : T.sub, boxShadow: view === v ? "0 1px 2px rgba(0,0,0,0.06)" : "none" }}>{l}</button>))}
  </div>);
}
function ThemeToggle({ mode, setMode }) {
  const dark = mode === "dark";
  return (<button onClick={() => setMode(dark ? "light" : "dark")} title={dark ? "Switch to light mode" : "Switch to dark mode"}
    className="flex items-center justify-center rounded-md" style={{ width: 30, height: 26, border: `1px solid ${T.border}`, color: T.sub, background: T.card }}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dark
        ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
        : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
    </svg></button>);
}
function Select({ label, value, onChange, options }) {
  return (<label className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="text-sm rounded-md px-2.5 py-1.5 outline-none"
      style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>
      <option value="All">All</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>);
}
function FilterBar({ org, setOrg, date, setDate, dir }) {
  const CHAIN = ["company", "team", "rep"]; // Department & Role dropped — tabbed views + per-team breakouts cover them; they stay "All" in state
  const set = (k) => (v) => { const next = { ...org, [k]: v }; // changing a level clears everything below it
    for (let i = CHAIN.indexOf(k) + 1; i < CHAIN.length; i++) next[CHAIN[i]] = "All"; setOrg(next); };
  const opts = orgOptions(dir, org);
  return (<div className="rounded-xl p-4 mb-5" style={{ background: T.card, border: `1px solid ${T.border}` }}>
    <div className="flex flex-wrap gap-3 items-end">
      <Select label="Team" value={org.team} onChange={set("team")} options={opts.team} />
      <Select label="Rep" value={org.rep} onChange={set("rep")} options={opts.rep} />
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
function Sparkline({ data, color }) {
  if (!data || data.length < 2) return null;
  const vals = data.map((d) => d.value); const max = Math.max(...vals); const min = Math.min(...vals, 0);
  const W = 100, H = 26, n = data.length;
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => max === min ? H / 2 : H - (((v - min) / (max - min)) * (H - 4) + 2);
  const line = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  return (<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 26, display: "block" }}>
    <polyline points={`0,${H} ${line} ${W},${H}`} fill={color || T.accent} fillOpacity="0.12" stroke="none" />
    <polyline points={line} fill="none" stroke={color || T.accent} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
  </svg>);
}
function KpiCard({ kpi, result, breakout, spark }) {
  const color = result.status === "good" ? T.good : result.status === "warn" ? T.warn : result.status === "bad" ? T.bad : T.faint;
  const pct = result.progress == null ? null : Math.min(1, Math.max(0, result.progress));
  const items = breakout && breakout.items ? breakout.items : null;
  const bmax = items && items.length ? Math.max(...items.map((b) => b.value)) : 0;
  const showSpark = spark && !(breakout && breakout.custom); // a custom breakout replaces the sparkline
  return (<div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: T.card, border: `1px solid ${T.border}` }}>
    <div className="flex items-start justify-between"><span className="text-[13px] font-medium" style={{ color: T.sub }}>{kpi.label}</span>
      {result.variance != null && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color, background: result.status === "good" ? T.accentSoft : "transparent" }}>{result.variance >= 0 ? "+" : ""}{(result.variance * 100).toFixed(0)}%</span>}</div>
    {result.unattributable
      ? (<><div className="text-[34px] font-bold leading-none tracking-tight" style={{ color: T.faint }}>n/a</div>
          <span className="text-[11px]" style={{ color: T.faint }}>Not tracked per rep in this data</span></>)
      : (<><div className="text-[34px] font-bold leading-none tracking-tight" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{fmt(result.value, kpi.format)}</div>
    {result.target != null ? (<div className="flex flex-col gap-1.5">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: T.track }}><div className="h-full rounded-full" style={{ width: `${(pct || 0) * 100}%`, background: color }} /></div>
      <span className="text-[11px]" style={{ color: T.faint }}>{result.progress != null ? `${(result.progress * 100).toFixed(0)}% of ` : ""}{fmt(result.target, kpi.format)} target</span></div>)
      : result.companyWide ? <span className="text-[11px]" style={{ color: T.faint }}>Company-wide · no rep split</span>
      : <span className="text-[11px]" style={{ color: T.faint }}>No target set</span>}
    {showSpark && <div className="pt-1"><Sparkline data={spark} color={result.status === "bad" ? T.bad : T.accent} /></div>}
    {items && items.length > 0 && (<div className="flex flex-col gap-1.5 pt-2 mt-1" style={{ borderTop: `1px solid ${T.border}` }}>
      {items.slice(0, 3).map((b) => (<div key={b.label} className="flex items-center gap-2">
        <span className="text-[11px] shrink-0 truncate" style={{ width: 92, color: T.sub }} title={b.label}>{b.label}</span>
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${bmax ? Math.round((b.value / bmax) * 100) : 0}%`, height: "100%", background: T.accent }} /></div>
        <span className="text-[11px] text-right shrink-0" style={{ width: 60, fontVariantNumeric: "tabular-nums", color: T.ink }}>{fmt(b.value, kpi.format)}</span>
      </div>))}
    </div>)}</>)}</div>);
}
function Panel({ title, children }) {
  return (<div className="rounded-xl p-4" style={{ background: T.card, border: `1px solid ${T.border}` }}>
    <h3 className="text-[13px] font-semibold mb-3" style={{ color: T.sub }}>{title}</h3>{children}</div>);
}
function dataFreshness(store) {
  const pick = [["opps_created", "Opps"], ["appointments", "Appts"], ["calls", "Calls"], ["leads_claimed", "Leads"], ["arip_entered", "ARIP"], ["opps_closed", "Closed"]];
  const out = [];
  pick.forEach(([k, label]) => {
    const ds = DATASETS[k], rows = store[k] || [];
    if (!ds || !ds.dateField || !rows.length) return;
    let mx = null; rows.forEach((r) => { const d = parseDate(r[ds.dateField]); if (d && (!mx || d > mx)) mx = d; });
    if (mx) out.push({ label, date: mx });
  });
  return out;
}
function Notes({ diagnostics, mode, freshness }) {
  const fmtD = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (<div className="rounded-xl p-4 mb-5" style={{ background: T.warnSoft, border: `1px solid ${T.warn}33` }}>
    <div className="text-[13px] font-semibold mb-1" style={{ color: T.warn }}>Data notes</div>
    <ul className="text-[12px] flex flex-col gap-1" style={{ color: T.ink }}>
      <li>Seven workbooks are wired: Opportunities, Pipeline, Activities (appointments), Marketing (lead volume), Leads (per-rep claims), Tasks (calls), Context (directory). Date filtering is active on every dataset that carries a date column.</li>
      {freshness && freshness.length > 0 && <li><b>Data current through:</b> {freshness.map((f) => `${f.label} ${fmtD(f.date)}`).join("  ·  ")}. Workbooks sync on different schedules, so very recent windows (Today/Yesterday) can look sparse for a source that hasn't caught up — e.g. calls typically lag a day or two.</li>}
      {mode === "google" && diagnostics.map((d) => <li key={d.dataset} style={{ color: T.warn }}>⧗ {d.dataset}: {d.note}</li>)}
    </ul></div>);
}

/* ============================================================================
 * pages/ExecutiveDashboard.jsx
 * ========================================================================== */
function ExecutiveDashboard({ store, dir, org, range, view }) {
  const isMktView = view === "marketing"; // driven by the Sales/Marketing view toggle, not an org filter
  const isTxView = view === "transactions";
  const allCards = ["closed_revenue", "deals_closed", "avg_deal", "pipeline_forecast", "opps_created", "appointments", "opps_to_arip", "arip_dealreview", "arip_pullthrough", "leads", "leads_call_center", "leads_texting", "leads_website", "leads_direct_mail", "leads_ppl", "reactivated_leads", "mkt_opps_created", "avg_lead_icp", "leads_claimed", "leads_deaded", "calls", "talk_time", "qcs"];
  const cards = isTxView ? ["deals_closed", "closed_revenue", "avg_deal", "pipeline_forecast"]
    : allCards.filter((id) => (isMktView ? KPIS[id].domain === "marketing" : KPIS[id].domain !== "marketing"));
  const results = useMemo(() => Object.fromEntries(allCards.map((id) => [id, computeKpi(KPIS[id], store, dir, org, range)])), [store, dir, org, range]);
  // Per-tile breakout: split each attributable KPI by the primary rep's team, reusing that KPI's own aggregation.
  const teamOf = (rep) => dir.byRep[String(rep ?? "").trim()]?.team || null;
  const breakouts = useMemo(() => {
    const out = {};
    cards.forEach((id) => {
      const kpi = KPIS[id], ds = DATASETS[kpi.dataset], res = results[id];
      if (!res || res.unattributable) { out[id] = null; return; }
      // A KPI can define its own meaningful split (appt type, call length, transaction type…); use it if it yields data.
      if (kpi.breakoutBy) {
        const custom = kpi.breakoutBy(res.rows).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
        if (custom.length) { out[id] = { items: custom, custom: true }; return; }
      }
      if (ds.companyScope || !(ds.repField || ds.repFields)) { out[id] = null; return; }
      const primary = ds.repField || ds.repFields[0];
      const groups = {};
      res.rows.forEach((row) => { const t = teamOf(row[primary]); if (t) (groups[t] = groups[t] || []).push(row); });
      const items = Object.entries(groups).map(([label, rows]) => ({ label,
        value: kpi.compute ? kpi.compute(rows) : kpi.agg(kpi.qualify ? rows.filter(kpi.qualify) : rows) }))
        .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
      out[id] = items.length ? { items, custom: false } : null;
    });
    return out;
  }, [cards, results, dir]);
  // Sparklines: monthly trend per volume/sum KPI (org-filtered, all periods). Skipped for averages, rates, and company-scope snapshots.
  const sparks = useMemo(() => {
    const out = {};
    cards.forEach((id) => {
      const kpi = KPIS[id], ds = DATASETS[kpi.dataset];
      if (!kpi.agg || ds.companyScope || !ds.dateField) { out[id] = null; return; }
      const rows = applyFilters(store[kpi.dataset] || [], ds, org, null, dir);
      const src = kpi.qualify ? rows.filter(kpi.qualify) : rows;
      const m = {}; src.forEach((r) => { const k = monthKey(r[ds.dateField]); if (k) (m[k] = m[k] || []).push(r); });
      const series = Object.entries(m).sort().map(([label, rs]) => ({ label, value: kpi.agg(rs) }));
      out[id] = series.length >= 2 ? series : null;
    });
    return out;
  }, [cards, store, org, dir]);
  // Appt → ARIP funnel (Totals Appt To Arip): appt-type mix (all-time) + ARIP conversion (period-aware).
  const apptFunnel = useMemo(() => {
    const rows = applyFilters(store.appt_funnel || [], DATASETS.appt_funnel, org, null, dir);
    const byType = {}; const opps = new Set(); const aripOpps = new Set();
    rows.forEach((r) => {
      const t = String(r.apptType || "").trim() || "(unset)"; byType[t] = (byType[t] || 0) + 1;
      if (r.name) opps.add(r.name);
      if (Number(r.flag) === 1 && r.name) { const d = parseDate(r.aripDate);
        if (!range || (d && d >= range.start && d <= range.end)) aripOpps.add(r.name); }
    });
    const total = rows.length || 1;
    const items = Object.entries(byType).map(([label, count]) => ({ label, count, pct: count / total })).sort((a, b) => b.count - a.count);
    return { appts: rows.length, uniqueOpps: opps.size, arips: aripOpps.size, conv: opps.size ? aripOpps.size / opps.size : 0, items };
  }, [store, org, range, dir]);

  // Charts are period-independent on purpose: the revenue trend shows every month with data, and the
  // pipeline is a live snapshot of open deals — neither should blank out just because the period is a short window.
  const byMonth = useMemo(() => { const m = {};
    applyFilters(store.opps_closed || [], DATASETS.opps_closed, org, null, dir)
      .forEach((o) => { const k = monthKey(o.closeDate); if (k) m[k] = (m[k] || 0) + num(o.revenue); });
    return Object.entries(m).sort().map(([k, v]) => ({ label: k, value: v })); }, [store, org, dir]);
  const byStage = useMemo(() => { const m = {};
    applyFilters(store.pipeline || [], DATASETS.pipeline, org, null, dir)
      .forEach((o) => { const s = String(o.stage || "").trim(); if (s) m[s] = (m[s] || 0) + num(o.forecast); });
    return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value); }, [store, org, dir]);
  const byCloseMonth = useMemo(() => { const m = {};
    applyFilters(store.pipeline || [], DATASETS.pipeline, org, null, dir)
      .forEach((o) => { const k = monthKey(o.closeDate); if (k) m[k] = (m[k] || 0) + num(o.forecast); });
    return Object.entries(m).sort().map(([k, v]) => ({ label: k, value: v })); }, [store, org, dir]);
  const drillLabel = org.rep !== "All" ? org.rep : org.team !== "All" ? org.team : org.company !== "All" ? org.company : "All reps";
  const leaderboard = useMemo(() => {
    const by = {}; results.closed_revenue.rows.forEach((o) => { const k = o.owner || "—"; (by[k] = by[k] || { owner: k, rev: 0, deals: 0 }); by[k].rev += num(o.revenue); by[k].deals += 1; });
    return Object.values(by).map((x) => ({ ...x, team: dir.byRep[x.owner]?.team, avg: x.deals ? x.rev / x.deals : 0 })).sort((a, b) => b.rev - a.rev);
  }, [results.closed_revenue.rows, dir]);
  // Rep scorecard: 5 ready metrics, per rep, filter-aware. Appointments attribute two ways —
  // Created By = setter (Appts Set), Assigned = attendee (Attended). Aggregated date-only (ALL_ORG)
  // so grouping isn't pre-narrowed by the Assigned-based rep filter, then rep rows are scoped after.
  const scorecard = useMemo(() => {
    const oppRows  = applyFilters(store.opps_created || [], DATASETS.opps_created, ALL_ORG, range, dir);
    const callRows = applyFilters(store.calls || [],        DATASETS.calls,        ALL_ORG, range, dir);
    const apptRows = applyFilters(store.appointments || [], DATASETS.appointments, ALL_ORG, range, dir);
    const leadRows = applyFilters(store.leads_claimed || [], DATASETS.leads_claimed, ALL_ORG, range, dir);
    const deadRows = applyFilters(store.leads_deaded || [], DATASETS.leads_deaded, ALL_ORG, range, dir);
    const aripRows = applyFilters(store.arip || [], DATASETS.arip, ALL_ORG, range, dir);
    const enteredRows = applyFilters(store.arip_entered || [], DATASETS.arip_entered, ALL_ORG, range, dir);
    const key = (v) => String(v ?? "").trim();
    const isMet = (o) => /appointment met/i.test(String(o || "")); // "Appointment Met" = attended
    const M = {};
    const ensure = (k) => (M[k] = M[k] || { rep: k, oppsCreated: 0, leadsClaimed: 0, leadsDeaded: 0, oppsArip: 0, aripReview: 0, minutes: 0, qcs: 0, apptsSet: 0, setMet: 0, apptsAssigned: 0, attended: 0 });
    oppRows.forEach((r) => { const k = key(r.createdBy); if (k) ensure(k).oppsCreated += 1; });
    leadRows.forEach((r) => { const k = key(r.rep); if (k) ensure(k).leadsClaimed += 1; });
    deadRows.forEach((r) => { const k = key(r.rep); if (k) ensure(k).leadsDeaded += 1; });
    enteredRows.forEach((r) => { const roles = new Set([r.owner, r.acqManager, r.acqManager2, r.followUp].map(key).filter(Boolean)); roles.forEach((k) => ensure(k).oppsArip += 1); });
    aripRows.forEach((r) => { if (String(r.newValue).trim() === "Deal Review" && Number(r.outArip) === 1) { const k = key(r.rep); if (k) ensure(k).aripReview += 1; } });
    callRows.forEach((r) => { const k = key(r.rep); if (!k) return; const e = ensure(k); e.minutes += num(r.durationMin); if (isQC(r)) e.qcs += 1; });
    apptRows.forEach((r) => {
      const s = key(r.createdBy); if (s) { const e = ensure(s); e.apptsSet += 1; if (isMet(r.outcome)) e.setMet += 1; }        // setter
      const a = key(r.rep);       if (a) { const e = ensure(a); e.apptsAssigned += 1; if (isMet(r.outcome)) e.attended += 1; } // attendee
    });
    const scope = repsInScope(dir, org); // null => company-wide (show everyone)
    const isVP = (role) => /vice\s*president|\bvp\b/i.test(String(role || ""));
    return Object.values(M)
      .filter((x) => !scope || scope.has(x.rep))
      .map((x) => { const role = dir.byRep[x.rep]?.role, vp = isVP(role);
        const attendeePrimary = vp || (x.apptsSet === 0 && x.apptsAssigned > 0); // VPs/closers scored on appts attended; setters (incl. anyone missing from the directory) on appts they set
        const denom = attendeePrimary ? x.apptsAssigned : x.apptsSet, numer = attendeePrimary ? x.attended : x.setMet;
        return { ...x, team: dir.byRep[x.rep]?.team, role, vp, attendeePrimary, shownAttended: attendeePrimary ? x.attended : x.setMet, rate: denom ? numer / denom : null }; })
      .sort((a, b) => b.oppsCreated - a.oppsCreated || b.minutes - a.minutes);
  }, [store, dir, org, range]);
  // Appointment outcome mix (all outcomes as %), scoped normally by Assigned + period.
  const outcomeMix = useMemo(() => {
    const rows = applyFilters(store.appointments || [], DATASETS.appointments, org, range, dir);
    const m = {}; rows.forEach((r) => { const o = String(r.outcome || "").trim() || "(blank)"; m[o] = (m[o] || 0) + 1; });
    const total = rows.length || 1;
    return { total: rows.length, items: Object.entries(m).map(([label, count]) => ({ label, count, pct: count / total })).sort((a, b) => b.count - a.count) };
  }, [store, org, range, dir]);
  // Marketing breakdowns (period-filtered, company-wide — leads/opps carry no rep)
  const mktLeadsBySource  = useMemo(() => breakdown(applyFilters(store.leads || [], DATASETS.leads, org, range, dir), (r) => r.source), [store, org, range, dir]);
  const mktLeadsBySegment = useMemo(() => breakdown(applyFilters(store.leads || [], DATASETS.leads, org, range, dir), (r) => r.segment), [store, org, range, dir]);
  const mktOppsBySource   = useMemo(() => breakdown(applyFilters(store.mkt_opps || [], DATASETS.mkt_opps, org, range, dir), (r) => r.source), [store, org, range, dir]);
  const mktOppsBySegment  = useMemo(() => breakdown(applyFilters(store.mkt_opps || [], DATASETS.mkt_opps, org, range, dir), (r) => r.segment), [store, org, range, dir]);
  // Transactions: pipeline deals (open + closed) grouped by Transaction Type. Snapshot (no period filter); drills by rep/team via org.
  const txByType = useMemo(() => {
    const rows = applyFilters(store.pipeline || [], DATASETS.pipeline, org, null, dir);
    const m = {};
    rows.forEach((o) => { const t = String(o.txType || "").trim() || "(unset)"; const closed = /closed|escrow|owned/i.test(String(o.stage || ""));
      const e = m[t] = m[t] || { type: t, deals: 0, forecast: 0, net: 0, closed: 0, open: 0 };
      e.deals += 1; e.forecast += num(o.forecast); e.net += num(o.netRev); closed ? e.closed++ : e.open++; });
    const arr = Object.values(m).sort((a, b) => b.forecast - a.forecast);
    const totDeals = arr.reduce((s, x) => s + x.deals, 0) || 1, totFc = arr.reduce((s, x) => s + x.forecast, 0) || 1, totNet = arr.reduce((s, x) => s + x.net, 0);
    return { rows: arr.map((x) => ({ ...x, avg: x.deals ? x.forecast / x.deals : 0, pctDeals: x.deals / totDeals, pctFc: x.forecast / totFc })),
      totals: { deals: totDeals, forecast: totFc, net: totNet, avg: totFc / totDeals } };
  }, [store, org, dir]);

  return (<div className="flex flex-col gap-5">
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(248px, 1fr))" }}>{cards.map((id) => <KpiCard key={id} kpi={KPIS[id]} result={results[id]} breakout={breakouts[id]} spark={sparks[id]} />)}</div>
    {isTxView ? (<>
      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Panel title={`Deals by transaction type — ${drillLabel}`}><div style={{ height: 260 }}><ResponsiveContainer>
          <BarChart data={txByType.rows.map((x) => ({ label: x.type, value: x.deals }))} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.track} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: T.sub }} axisLine={false} tickLine={false} width={132} />
            <Tooltip cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}><LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: T.sub }} />{txByType.rows.map((_, i) => <Cell key={i} fill={T.chart[i % T.chart.length]} />)}</Bar>
          </BarChart></ResponsiveContainer></div></Panel>
        <Panel title={`Forecasted revenue by transaction type — ${drillLabel}`}><div style={{ height: 260 }}><ResponsiveContainer>
          <BarChart data={txByType.rows.map((x) => ({ label: x.type, value: x.forecast }))} layout="vertical" margin={{ top: 0, right: 52, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.track} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: T.sub }} axisLine={false} tickLine={false} width={132} />
            <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}><LabelList dataKey="value" position="right" formatter={(v) => "$" + Math.round(v / 1000) + "k"} style={{ fontSize: 10, fill: T.sub }} />{txByType.rows.map((_, i) => <Cell key={i} fill={T.accent} />)}</Bar>
          </BarChart></ResponsiveContainer></div></Panel>
      </div>
      <Panel title={`Transaction summary — ${drillLabel}`}>
        <div style={{ overflowX: "auto" }}><table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
          <thead><tr style={{ color: T.faint, textAlign: "right" }}>
            {["Transaction type", "Deals", "Open", "Closed", "Forecasted rev", "Net rev", "Avg (forecast)", "% deals", "% rev"].map((h, i) => (
              <th key={h} className="py-2 px-2" style={{ textAlign: i === 0 ? "left" : "right", borderBottom: `1px solid ${T.border}` }}>{h}</th>))}
          </tr></thead>
          <tbody>
            {txByType.rows.map((x) => (
              <tr key={x.type} style={{ color: T.ink }}>
                <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{x.type}</td>
                <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{x.deals}</td>
                <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{x.open}</td>
                <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{x.closed}</td>
                <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{fmt(x.forecast, "currency")}</td>
                <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{fmt(x.net, "currency")}</td>
                <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{fmt(x.avg, "currency")}</td>
                <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{(x.pctDeals * 100).toFixed(0)}%</td>
                <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{(x.pctFc * 100).toFixed(0)}%</td>
              </tr>))}
            <tr style={{ color: T.ink, fontWeight: 700 }}>
              <td className="py-2 px-2">Total</td>
              <td className="py-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{txByType.totals.deals}</td>
              <td className="py-2 px-2 text-right" style={{ color: T.sub, fontVariantNumeric: "tabular-nums" }}>{txByType.rows.reduce((s, x) => s + x.open, 0)}</td>
              <td className="py-2 px-2 text-right" style={{ color: T.sub, fontVariantNumeric: "tabular-nums" }}>{txByType.rows.reduce((s, x) => s + x.closed, 0)}</td>
              <td className="py-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(txByType.totals.forecast, "currency")}</td>
              <td className="py-2 px-2 text-right" style={{ color: T.sub, fontVariantNumeric: "tabular-nums" }}>{fmt(txByType.totals.net, "currency")}</td>
              <td className="py-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(txByType.totals.avg, "currency")}</td>
              <td className="py-2 px-2 text-right" style={{ color: T.sub }}>100%</td>
              <td className="py-2 px-2 text-right" style={{ color: T.sub }}>100%</td>
            </tr>
          </tbody>
        </table></div>
        <div className="text-[11px] mt-3" style={{ color: T.faint }}>Live snapshot of all open + closed deals in the pipeline (period filter doesn't apply). Revenue uses <b>Total Forecasted Revenue</b>. Scoped to <b>{drillLabel}</b> — pick a team or rep to drill in.</div>
      </Panel>
    </>) : isMktView ? (<>
      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Panel title="Leads by source"><Bars items={mktLeadsBySource.items} /></Panel>
        <Panel title="Leads by marketing segmentation"><Bars items={mktLeadsBySegment.items} tint={T.chart[1]} /></Panel>
      </div>
      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Panel title="Opps created by source"><Bars items={mktOppsBySource.items} tint={T.chart[3]} /></Panel>
        <Panel title="Opps created by segmentation"><Bars items={mktOppsBySegment.items} tint={T.chart[4]} /></Panel>
      </div>
      <Panel title="Marketing view">
        <div className="text-[12px]" style={{ color: T.sub }}>Company-level lead-funnel metrics — leads and opps carry no individual rep, so only the Period filter applies. "Avg Lead ICP" is the mean Total Tier 1 ICP (0–7) across leads in the period. Spend/CPL isn't in the current sync, so cost-per-lead and ROAS aren't available yet.</div>
      </Panel>
    </>) : (<>
    {org.rep !== "All" ? (
    <div className="grid gap-5" style={{ gridTemplateColumns: "3fr 2fr" }}>
      <Panel title={`Deals · Close Date × Projected Rev — ${org.rep}`}><div style={{ height: 260 }}><ResponsiveContainer>
        <BarChart data={byCloseMonth} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.track} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} width={48} />
          <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}><LabelList dataKey="value" position="top" formatter={(v) => "$" + Math.round(v / 1000) + "k"} style={{ fontSize: 10, fill: T.sub }} />{byCloseMonth.map((d, i) => <Cell key={i} fill={T.accent} />)}</Bar>
        </BarChart></ResponsiveContainer></div></Panel>
      <Panel title={`Deals · Stage × Projected Rev — ${org.rep}`}><div style={{ height: 260 }}><ResponsiveContainer>
        <BarChart data={byStage} layout="vertical" margin={{ top: 0, right: 44, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.track} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: T.sub }} axisLine={false} tickLine={false} width={132} />
          <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}><LabelList dataKey="value" position="right" formatter={(v) => "$" + Math.round(v / 1000) + "k"} style={{ fontSize: 10, fill: T.sub }} />{byStage.map((_, i) => <Cell key={i} fill={T.chart[i % T.chart.length]} />)}</Bar>
        </BarChart></ResponsiveContainer></div></Panel>
    </div>
    ) : (
    <Panel title="Deals · by rep">
      <div className="text-[13px] py-6 text-center" style={{ color: T.sub }}>
        Deal breakdowns are rep-specific. Pick a rep in the filter bar to see their <b>Close Date × Projected Rev</b> and <b>Stage × Projected Rev</b> charts.
      </div>
    </Panel>
    )}
    <Panel title={`Closed revenue by month — ${drillLabel} (Total Net Revenue · all months)`}><div style={{ height: 200 }}><ResponsiveContainer>
      <BarChart data={byMonth} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={T.track} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} width={48} />
        <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>{byMonth.map((d, i) => <Cell key={i} fill={d.value < 0 ? T.bad : T.good} />)}</Bar>
      </BarChart></ResponsiveContainer></div></Panel>
    <Panel title={`Appt Set → ARIP — ${drillLabel} (appointment funnel)`}>
      <Bars items={apptFunnel.items} tint={T.chart[2]} />
      <div className="grid gap-3 mt-3 pt-3" style={{ gridTemplateColumns: "repeat(4, 1fr)", borderTop: `1px solid ${T.border}` }}>
        {[["Appts set", apptFunnel.appts.toLocaleString()], ["Unique opps", apptFunnel.uniqueOpps.toLocaleString()], ["ARIPs (in period)", apptFunnel.arips.toLocaleString()], ["Appt → ARIP", (apptFunnel.conv * 100).toFixed(1) + "%"]].map(([l, v]) => (
          <div key={l}><div className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>{l}</div>
            <div className="text-[22px] font-bold leading-tight" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{v}</div></div>))}
      </div>
      <div className="text-[11px] mt-2" style={{ color: T.faint }}>Scoped to <b>{drillLabel}</b>. Appointments carry no date in the export, so appt counts are all-time; ARIPs respect the selected period.</div>
    </Panel>
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
    <Panel title="Rep scorecard">
      <div className="text-[11px] mb-3" style={{ color: T.faint }}>Attendance % is role-aware — VPs &amp; closers (anyone who runs appointments) are scored on appointments attended ÷ appointments assigned to them; setters on appointments they set that were met ÷ appointments they set. The Attended column follows the same rule.</div>
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead><tr style={{ color: T.faint }} className="text-left text-[11px] uppercase tracking-wide">
          <th className="pb-2 font-medium">Rep</th><th className="pb-2 font-medium">Role</th>
          <th className="pb-2 font-medium text-right">Opps Created</th><th className="pb-2 font-medium text-right">Opps→ARIP</th><th className="pb-2 font-medium text-right">ARIP→Review</th><th className="pb-2 font-medium text-right">Leads Claimed</th><th className="pb-2 font-medium text-right">Leads Deaded</th><th className="pb-2 font-medium text-right">Talk Time</th>
          <th className="pb-2 font-medium text-right">QCs</th><th className="pb-2 font-medium text-right">Appts Set</th>
          <th className="pb-2 font-medium text-right">Attended</th><th className="pb-2 font-medium text-right">Attend %</th></tr></thead>
        <tbody>{scorecard.map((row) => (<tr key={row.rep} style={{ borderTop: `1px solid ${T.border}`, color: T.ink }}>
          <td className="py-2 font-medium">{row.rep}</td>
          <td className="py-2" style={{ color: T.sub }}>{row.role || "—"}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.oppsCreated.toLocaleString()}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.oppsArip.toLocaleString()}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.aripReview.toLocaleString()}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.leadsClaimed.toLocaleString()}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.leadsDeaded.toLocaleString()}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(row.minutes, "minutes")}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.qcs.toLocaleString()}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.apptsSet.toLocaleString()}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{row.shownAttended.toLocaleString()}</td>
          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums", color: row.rate == null ? T.faint : T.ink }}>{row.rate == null ? "—" : fmt(row.rate, "percent")}</td></tr>))}</tbody>
      </table></Panel>
    <Panel title="Appointment outcomes (all appointments in scope)">
      <div className="text-[11px] mb-3" style={{ color: T.faint }}>{outcomeMix.total.toLocaleString()} appointments · Created Date in the selected period</div>
      <div className="flex flex-col gap-2">{outcomeMix.items.map((o) => (
        <div key={o.label} className="flex items-center gap-3">
          <div className="text-[12px] shrink-0" style={{ width: 150, color: T.sub }}>{o.label}</div>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${Math.round(o.pct * 100)}%`, height: "100%", background: /met/i.test(o.label) ? T.good : /no show|missed/i.test(o.label) ? T.bad : T.chart[3] }} /></div>
          <div className="text-[12px] text-right shrink-0" style={{ width: 110, fontVariantNumeric: "tabular-nums", color: T.ink }}>{o.count.toLocaleString()} · {(o.pct * 100).toFixed(1)}%</div>
        </div>))}</div>
    </Panel>
    </>)}
  </div>);
}

/* ============================================================================
 * App.jsx
 * ========================================================================== */
export default function App() {
  const [st, setSt] = useState({ loading: true, error: null, store: null, dir: null, diagnostics: [], mode: "mock" });
  const [org, setOrg] = useState({ company: "All", department: "All", team: "All", role: "All", rep: "All" });
  const [view, setView] = useState("sales");
  const [mode, setMode] = useState(() => (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
  T = THEMES[mode]; // activate the chosen theme for this render pass (all T.* reads below use it)
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
        <span>{iso(range.start)} → {iso(range.end)}</span>
        <ThemeToggle mode={mode} setMode={setMode} /></div></div>
    <div className="p-6 max-w-[1200px] mx-auto">{body}</div></div>);

  if (st.loading) return shell(<div className="text-sm" style={{ color: T.faint }}>Loading data…</div>);
  if (st.error) return shell(<div className="rounded-xl p-4 text-sm" style={{ background: T.warnSoft, border: `1px solid ${T.warn}33`, color: T.ink }}>
    <div className="font-semibold mb-1" style={{ color: T.warn }}>Couldn’t load Google Sheets</div><div style={{ color: T.sub }}>{st.error}</div>
    <div className="mt-2" style={{ color: T.faint }}>Check the API key, that the Sheets API is enabled, and each workbook is shared “Anyone with the link → Viewer.”</div></div>);

  return shell(<>
    <ViewToggle view={view} setView={setView} />
    <FilterBar org={org} setOrg={setOrg} date={date} setDate={setDate} dir={st.dir} />
    <Notes diagnostics={st.diagnostics} mode={st.mode} freshness={st.store ? dataFreshness(st.store) : []} />
    <ExecutiveDashboard store={st.store} dir={st.dir} org={org} range={range} view={view} />
    <p className="text-[11px] mt-5" style={{ color: T.faint }}>Phase 3 · auto-tab-union model · {st.mode === "google" ? "live Sheets via public API key" : "sample data (set API_KEY to go live)"}</p>
  </>);
}
