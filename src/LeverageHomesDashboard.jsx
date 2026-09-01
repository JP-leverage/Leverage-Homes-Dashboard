import React, { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";

const API_KEY =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SHEETS_API_KEY) ||
  (typeof window !== "undefined" && window.SHEETS_API_KEY) ||
  "";

const THEMES = {
  light: {
    canvas: "#ECE3D0", card: "#FFFFFF", border: "#2B2721", ink: "#14110B",
    sub: "#4B4535", faint: "#877C60", accent: "#A87C0A", accentSoft: "#F3E8CB",
    good: "#0F6B4A", warn: "#9A5308", bad: "#A81729", track: "#E6DDC8", warnSoft: "#F6ECD6",
    shadow: "0 2px 5px rgba(28,22,12,0.13), 0 1px 2px rgba(28,22,12,0.08)",
    chart: ["#A87C0A", "#7A5C12", "#C9A227", "#14110B", "#5A5140", "#D9C68C", "#9A5308"],
  },
  dark: {
    canvas: "#0A0F1A", card: "#121A2A", border: "#25324A", ink: "#EAF1F8",
    sub: "#A7B6C9", faint: "#6E7E93", accent: "#34C08C", accentSoft: "#123528",
    good: "#34C08C", warn: "#E0A63E", bad: "#F2607F", track: "#1B2740", warnSoft: "#2A2214",
    shadow: "none",
    chart: ["#34C08C", "#5FD3A8", "#8FE3C4", "#7FA0C9", "#A7B6C9", "#2E9E78", "#E0A63E"],
  },
};
let T = THEMES.light;
// Density presets. Mirrors the `let T` theme pattern: App reassigns `D` from state each render
// before children read it. Comfortable = default; Compact packs more per screen without shrinking print.
const DENSITIES = {
  comfortable: { cardPad: "p-4", gridGap: 16, minBig: 300, min: 248, numBig: "text-[46px]", num: "text-[34px]" },
  compact:     { cardPad: "p-3", gridGap: 10, minBig: 268, min: 214, numBig: "text-[38px]", num: "text-[30px]" },
};
let D = DENSITIES.comfortable;
const FONT = { fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" };

/* Speed to Lead — team metric. Elapsed = claim minus start (start = Created Date
 * for New Leads, else Edit Date). Three start-time buckets: primary (weekday
 * 10am–7pm), outwindow (weekday off-hours), weekend (Sat/Sun, wins over time).
 * Priority: ICP >=4 High, 1–3 Low, else premium source (Website/PPL/Direct Mail)
 * High else Low. Headline = average; median kept as secondary. */
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
function stlStartRaw(row, scenario) { return /new leads/i.test(scenario) ? row.createdTime : row.editDate; }
function stlBucket(startDate) {
  const d = parseDateTime(startDate); if (!d) return null;
  const day = d.getDay(); if (day === 0 || day === 6) return "weekend"; // weekend wins first
  const h = d.getHours(); return (h >= 10 && h < 19) ? "primary" : "outwindow"; // 10am–7pm
}
const mean = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0);
const plural = (n, word) => `${(n || 0).toLocaleString()} ${word}${n === 1 ? "" : "s"}`; // "1 lead" / "2 leads"
// Adaptive duration format: 42s / 3m 20s / 1h 14m
function fmtDur(sec) {
  if (sec == null || isNaN(sec)) return "—";
  sec = Math.round(sec);
  if (sec < 60) return sec + "s";
  if (sec < 3600) { const m = Math.floor(sec / 60), s = sec % 60; return s ? `${m}m ${s}s` : `${m}m`; }
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`;
}

const WORKBOOKS = {
  opportunities: { id: "1UN-p8DcLKpWkqretcUL_SzmTpnDSOWkPqISbEYKduLg", title: "Homes Dashboard Pt 1 (Opportunities)" },
  opportunities_pt2: { id: "151Gp7XvOrUHkbbh485lGyDLdX8DDzfZAkjGZPuutkZk", title: "Homes Dashboard Pt 2 (Opportunities)" },
  pipeline:      { id: "1ui2pXxOFeAu58VYiYOgliF_yBCBq7m0H0Xy8JJnoALM", title: "Homes Dashboard PT1 (Pipeline)" },
  context:       { id: "1LUi9VfpX0T_1bgg40NPvt6ltxNX0ASPmwGiymbDmxa8", title: "Homes Dashboard Pt 1 (Context)" },
  activities:    { id: "1gfYW52duE4tmNr5b92F2HvanZroMlcaQZ01_5f4bgac", title: "Homes Dashboard Pt 1 (Activities)" },
  marketing:     { id: "1lkftyL4-_kX-hxHXQZ_ylwPlFQg2wYJBXXHE2bzN4wc", title: "Homes Dashboard PT1 (Marketing)" },
  tasks:         { id: "1Vs-IMKBDW3FilFSM8gQKo1NqSgUqh0aVPhFPb4wGOPE", title: "Homes Dashboard Pt 1 (Tasks)" },
  leads_wb:      { id: "1iS4PLBML63qWqpgWwxRH83jFVw7TJ9SAlHK06JQ2MmI", title: "Homes Dashboard Pt 1 (Leads)" },
  transactions:  { id: "1nMLGx8PSvq1aSx6GAOCtaieNIiSEHHezNS-NxjkEH3w", title: "Homes Dashboard PT1 (Transactions)" },
  speed_to_lead: { id: STL_WORKBOOK_ID, title: "Homes Dashboard PT1 ( Speed To Lead )" },
  dispositions:  { id: "14bZZxtILsNeWzJHgvlgrKj5boyhg5c_3FgSjr_SZ0gQ", title: "Homes Dashboard Pt 1 (Dispositions)" },
};

const DATASETS = {
  opps_created: {
    workbook: "opportunities",
    require: ["Opportunity ID", "Opportunity Record Type"], exclude: ["Total Net Revenue", "Lead Status"],
    schema: { id: "Opportunity ID", name: "Opportunity Name", owner: "Opportunity Owner",
      recordType: "Opportunity Record Type", icp: "ISA ICP Total Score", createdBy: "Created By" },
    dedupe: (r) => r.id, dateField: "date",
    dateCandidates: ["Created Date", "Create Date", "Date Created", "Opportunity Created Date"], repField: "createdBy",
  },
  opps_closed: {
    workbook: "opportunities",
    require: ["Total Net Revenue", "Close Date"], exclude: [],
    schema: { owner: "Opportunity Owner", name: "Opportunity Name", revenue: "Total Net Revenue",
      acqManager: "Acquisition Manager", acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", closeDate: "Close Date", txType: "Transaction Type" },
    dedupe: (r) => `${r.name}|${r.closeDate}`, dateField: "closeDate",
    repField: "owner", repFields: ["owner", "acqManager", "acqManager2", "followUp"],
  },
  pipeline: {
    workbook: "pipeline",
    require: ["Total Forecasted Revenue", "Opportunity Owner", "Lead Source"], exclude: [], tabInclude: /YTD x Pipeline Forecast/i,
    schema: { name: "Opportunity Name", stage: "Stage", projected: "Projected Net Revenue", forecast: "Total Forecasted Revenue",
      netRev: "Total Net Revenue", closeDate: "Close Date", owner: "Opportunity Owner", acqManager: "Acquisition Manager",
      acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", source: "Lead Source", txType: "Transaction Type", segment: "Marketing Segmentation" },
    dedupe: (r) => r.name, dateField: "closeDate", repFields: ["owner", "acqManager", "acqManager2", "followUp"],
  },
  arip: {
    workbook: "pipeline",
    require: ["out of arip", "Acquisition Manager", "Edit Date"], exclude: [], tabInclude: /Arips to Deal Review/i, tabField: "__tab",
    schema: { name: "Opportunity Name", stage: "Stage", rep: "Acquisition Manager", followUp: "Follow Up Specialist",
      source: "Lead Source", projected: "Projected Net Revenue", newValue: "New Value", outArip: "out of arip", tab: "__tab" },
    dedupe: null, dateField: "date", dateCandidates: ["Edit Date"], repField: "rep",
  },
  arip_out_rev: {
    workbook: "transactions",
    require: ["New Value", "Opportunity Name"], exclude: [], tabInclude: /out of arip/i,
    schema: { id: "Opportunity ID", name: "Opportunity Name", owner: "Opportunity Owner", acqManager: "Acquisition Manager",
      acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", newValue: "New Value", oldValue: "Old Value",
      txType: "Transaction Type", source: "Lead Source", segment: "Marketing Segmentation",
      projNet: ["Projected Net Revenue"] },
    dedupe: null, dateField: "date", dateCandidates: ["Edit Date", "Date", "Created Date"], repFields: ["owner", "acqManager", "acqManager2", "followUp"],
  },
  arip_out: {
    workbook: "pipeline",
    require: ["New Value", "Opportunity ID", "Follow Up Specialist"], exclude: [], tabInclude: /Opps - Out of ARIP/i,
    schema: { id: "Opportunity ID", name: "Opportunity Name", owner: "Opportunity Owner", acqManager: "Acquisition Manager",
      acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", newValue: "New Value", oldValue: "Old Value",
      txType: "Transaction Type", icp: "ISA ICP Total Score", source: "Lead Source", segment: "Marketing Segmentation", projNet: ["Projected Net Revenue"] },
    dedupe: null, dedupeInPeriod: "id", dedupePrefer: (r) => isAripOut(r.newValue), dateField: "date", dateCandidates: ["Edit Date", "Date", "Created Date"], repFields: ["owner", "acqManager", "acqManager2", "followUp"],
  },
  tx_duration: {
    workbook: "transactions",
    require: ["Duration ARIP to Closed", "Transaction Type", "Arip Date"], exclude: [], tabInclude: /Median Duration/i,
    schema: { id: "Opportunity ID", name: "Opportunity Name", txType: "Transaction Type", aripDate: "Arip Date",
      closeDate: "Close Date", duration: "Duration ARIP to Closed", owner: "Opportunity Owner",
      acqManager: "Acquisition Manager", acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist",
      dealReviewDate: "Date Moved to Deal Review", preMarketingDate: "Date Moved to Pre Marketing",
      marketingDate: "Date Moved to Marketing", buyerAripDate: "Date Moved to Buyer ARIP", underContractDate: "Under Contract Date" },
    dedupe: (r) => r.id, dateField: null, repFields: ["owner", "acqManager", "acqManager2", "followUp"],
  },
  stage_history: {
    // StageName field-history. To keep Coefficient refresh fast, this can be split into two single-filter
    // reports — "…Stage History Entries…" (New Value = a core stage) and "…Stage History Exits…" (Old Value =
    // a core stage). The loader unions any tab whose name contains "Stage History" and dedupes the core→core
    // rows that appear in both. A single full "All Opportunity Stage History" tab also still works unchanged.
    workbook: "transactions",
    require: ["Opportunity ID", "New Value", "Stage", "Edit Date"], exclude: [], tabInclude: /Stage History/i,
    schema: { id: "Opportunity ID", name: "Opportunity Name", recordType: "Opportunity Record Type", txType: "Transaction Type",
      oldValue: "Old Value", newValue: "New Value", stage: "Stage", forecast: "Total Forecasted Revenue",
      owner: "Opportunity Owner", acqManager: "Acquisition Manager", acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist" },
    dedupe: (r) => [r.id, r.oldValue, r.newValue, r.date].join("|"), dateField: "date", dateCandidates: ["Edit Date"], repFields: ["owner", "acqManager", "acqManager2", "followUp"],
  },
  contracts_sent: {
    // Tasks workbook — "Contracts Sent x YTD - VPs" tab. Standard Salesforce Activity export
    // (same shape as the Talk Time tabs): one row per "Contract Sent" activity, credited to the
    // Assigned rep (VP), dated by Created Date. VP-only via the KPI's vpOnly gate; a few non-VP
    // strays can appear in Assigned (data hygiene) — see note. To lock rows to VPs only, add a
    // role check in the KPI qualify.
    workbook: "tasks",
    require: ["Assigned", "Subject", "Created Date"], exclude: [], tabInclude: /Contracts Sent/i,
    schema: { id: "Activity ID", account: "Company / Account", name: "Opportunity", subject: "Subject", owner: "Assigned" },
    dedupe: (r) => r.id, dateField: "date", dateCandidates: ["Created Date"], repField: "owner",
  },
  arip_entered: {
    workbook: "opportunities",
    require: ["New Value", "Opportunity Owner", "Acquisition Manager"], exclude: [], tabInclude: /Opps\s*-\s*ARIP\s*-\s*YTD/i,
    schema: { id: "Opportunity ID", name: "Opportunity Name", owner: "Opportunity Owner", acqManager: "Acquisition Manager",
      acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", newValue: "New Value", oldValue: "Old Value", icp: "ISA ICP Total Score", txType: "Transaction Type" },
    dedupe: (r) => `${r.id}|${r.date}`, dedupeInPeriod: "id", dateField: "date", dateCandidates: ["Edit Date"], repFields: ["owner", "acqManager", "acqManager2", "followUp"],
  },
  appt_funnel: {
    workbook: "pipeline",
    require: ["Deals to Arip", "Created By", "Appointment Type"], exclude: [], tabInclude: /Totals Appt To Arip/i,
    schema: { name: "Opportunity Name", rep: "Created By", flag: "Deals to Arip", apptType: "Appointment Type", aripDate: "Arip Date" },
    dedupe: null, dateField: "date", dateCandidates: ["Created Date", "Create Date"], repField: "rep",
  },
  // Appointments SET — volume of appointments created, dated by Created Date.
  // Reads the Segment x Source tab (only appt tab carrying a Start column) so Set and Attended share one source.
  appointments: {
    workbook: "activities",
    require: ["Appointment Outcome", "Start"], exclude: [], tabInclude: /Segment x Source/i,
    schema: { name: "Opportunity Name", subject: "Subject", createdBy: "Created By", rep: "Assigned",
      outcome: "Appointment Outcome", eventType: "Event Type",
      icp: ["ISA ICP Total Score", "Total ICP Score", "ICP Total Score", "Total Tier 1 ICP", "ISA ICP", "ICP Score", "ICP"] },
    dedupe: null, dateField: "date", dateCandidates: ["Created Date", "Create Date"], repField: "createdBy",
  },
  // Appointments ATTENDED / Show Rate — dated by Start (when the appointment actually occurred).
  appointments_attended: {
    workbook: "activities",
    require: ["Appointment Outcome", "Start"], exclude: [], tabInclude: /Segment x Source/i,
    schema: { name: "Opportunity Name", subject: "Subject", createdBy: "Created By", rep: "Assigned",
      outcome: "Appointment Outcome", eventType: "Event Type" },
    dedupe: null, dateField: "date", dateCandidates: ["Start"], repField: "createdBy",
  },
  appts_seg: {
    workbook: "activities",
    require: ["Marketing Segmentation", "Opportunity Lead Source"], exclude: [], tabInclude: /Segment x Source/i,
    schema: { name: "Opportunity Name", subject: "Subject", eventType: "Event Type", createdBy: "Created By",
      outcome: "Appointment Outcome", rep: "Assigned", segment: "Marketing Segmentation", source: "Opportunity Lead Source" },
    dedupe: null, dateField: "date", dateCandidates: ["Created Date", "Create Date"], repField: "createdBy",
  },
  leads: {
    workbook: "marketing",
    require: ["Lead ID", "Lead Source"], exclude: [], tabExclude: /^All leads|Reactivated/i,
    schema: { leadId: "Lead ID", account: "Company / Account", status: "Lead Status",
      icp: "Total Tier 1 ICP", segment: "Marketing Segmentation", source: "Lead Source" },
    dedupe: (r) => r.leadId, dateField: "date", dateCandidates: ["Create Date", "Created Date"], repField: null,
  },
  mkt_opps: {
    workbook: "marketing",
    require: ["Opportunity ID", "Lead Source"], exclude: [], tabInclude: /All Opps/i,
    schema: { id: "Opportunity ID", name: "Opportunity Name", source: "Lead Source",
      segment: "Marketing Segmentation", icp: "Total ICP Score", isaIcp: "ISA ICP Total Score" },
    dedupe: (r) => r.id, dateField: "date", dateCandidates: ["Created Date"], repField: null,
  },
  reactivated: {
    workbook: "marketing",
    require: ["Lead ID", "Field / Event"], exclude: [], tabInclude: /Reactivated/i,
    schema: { leadId: "Lead ID", source: "Lead Source", segment: "Marketing Segmentation",
      oldValue: "Old Value", newValue: "New Value" },
    dedupe: (r) => r.leadId, dateField: "date", dateCandidates: ["Edit Date"], repField: null,
  },
  leads_claimed: {
    workbook: "leads_wb",
    require: ["Lead ID", "New Value", "Edit Date"], exclude: [], tabInclude: /Leads Claimed/i,
    schema: { leadId: "Lead ID", account: "Company", status: "Lead Status", icp: "Total Tier 1 ICP",
      rep: "New Value", oldValue: "Old Value" },
    dedupe: (r) => `${String(r.rep).trim()}|${r.leadId}`, dateField: "date", dateCandidates: ["Edit Date"], repField: "rep",
  },
  leads_deaded: {
    workbook: "leads_wb",
    require: ["Lead ID", "Edited By", "Edit Date"], exclude: [], tabInclude: /Leads Deaded/i,
    schema: { leadId: "Lead ID", account: "Company", status: "Lead Status", icp: "Total Tier 1 ICP",
      rep: "Edited By", oldValue: "Old Value", newValue: "New Value" },
    dedupe: (r) => `${String(r.rep).trim()}|${r.leadId}`, dateField: "date", dateCandidates: ["Edit Date"], repField: "rep",
  },
  calls: {
    workbook: "tasks",
    require: ["Assigned", "smrtPhone Call Duration (Minutes)"], exclude: [], tabInclude: /Talk Time/i,
    schema: { account: "Company / Account", subject: "Subject", rep: "Assigned", status: "Status", task: "Task",
      durationMin: "smrtPhone Call Duration (Minutes)", qc: "smrtPhone QC Y/N" },
    dedupe: null, dateField: "date", dateCandidates: ["Date", "Created Date", "Create Date", "Completed Date"], repField: "rep",
  },
  // Avg talk time per INBOUND CHANNEL — "Average Talk Time Per Inbound x YTD" tab in the Speed to Lead
  // workbook. One row per call (task), carrying its duration, the lead's inbound channel (Lead Source),
  // and the call's own Created Date (dated on "Created Date Task" per spec). repField = Assigned rep so the
  // tile still honors Team/Rep scope; the channel split is a custom breakout on the KPI (not rep-based).
  talk_time_channel: {
    workbook: "speed_to_lead",
    require: ["smrtPhone Call Duration (Minutes)", "Lead Source"], exclude: [], tabInclude: /Average Talk Time Per Inbound/i,
    schema: { rep: "Assigned To: Full Name", subject: "Subject", account: "Company",
      durationMin: "smrtPhone Call Duration (Minutes)", source: "Lead Source" },
    dedupe: null, dateField: "date", dateCandidates: ["Created Date Task", "Created Date", "Create Date"], repField: "rep",
  },
  opps_assigned: {
    workbook: "opportunities_pt2",
    require: [], exclude: [], tabInclude: /Opps Assigned x YTD/i, tabField: "__tab",
    schema: { id: "Opportunity ID", name: "Opportunity Name", owner: "Opportunity Owner", createdBy: "Created By", tab: "__tab" },
    dedupe: (r) => (r.id ? `${r.tab}|${r.id}` : null), dateField: "date",
    dateCandidates: ["Created Date", "Create Date"], repField: "rep",
  },
  opps_deaded: {
    workbook: "opportunities_pt2",
    require: [], exclude: [], tabInclude: /Opportunities Deaded x YTD/i, tabField: "__tab",
    schema: { id: "Opportunity ID", name: "Opportunity Name", editedBy: "Edited By", tab: "__tab" },
    dedupe: (r) => (r.id ? `${r.tab}|${r.id}` : null), dateField: "date",
    dateCandidates: ["Edit Date", "Edited Date"], repField: "rep",
  },
  closed_opps: {
    workbook: "opportunities_pt2",
    require: [], exclude: [], tabInclude: /Closed Opps x YTD/i,
    schema: { id: "Opportunity ID", owner: "Opportunity Owner", name: "Opportunity Name",
      revenue: ["Total Forecasted Revenue", "Total Net Revenue", "Net Revenue"], acqManager: "Acquisition Manager",
      acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", listingPartner: "Listing Partner", closeDate: "Close Date", txType: "Transaction Type" },
    dedupe: (r) => (r.id != null && r.id !== "" ? String(r.id) : null), dateField: "closeDate",
    repField: "owner", repFields: ["owner", "acqManager", "acqManager2", "followUp"],
  },
  listing_pipeline: {
    workbook: "opportunities_pt2",
    require: ["Total Listing Commission Percentage", "Stage", "Opportunity Name"], exclude: [], tabInclude: /Listing Pipeline x YTD/i, tabField: "sourceTab",
    schema: { stage: "Stage", name: "Opportunity Name", forecast: "Total Forecasted Revenue", recordType: "Opportunity Record Type",
      owner: "Opportunity Owner", acqManager: "Acquisition Manager", acqManager2: "Acquisition Manager 2", followUp: "Follow Up Specialist", sourceTab: "sourceTab" },
    dedupe: (r) => r.name, dateField: null, repField: null,
  },
  listing_appts: {
    workbook: "activities",
    require: ["Appointment Outcome", "Event Type"], exclude: [], tabInclude: /Appts YTD x Month/i,
    schema: { subject: "Subject", createdBy: "Created By", rep: "Assigned", outcome: "Appointment Outcome", eventType: "Event Type" },
    dedupe: null, dateField: "date", dateCandidates: ["Created Date", "Create Date"], repField: "rep",
  },
  live_transfers: {
    workbook: "leads_wb",
    require: ["Live Transfer Attempted?"], exclude: [], tabInclude: /Live Transfer/i, companyScope: true,
    schema: { leadId: "Lead ID", attempted: "Live Transfer Attempted?", connected: "Live Transfer Connected?", source: "Lead Source" },
    dedupe: null, dateField: "date", dateCandidates: ["Created Date", "Create Date"], repField: null,
  },
  directory: {
    workbook: "context",
    require: ["REP", "TEAM"], exclude: [],
    schema: { rep: "REP", name: "REP", role: "ROLE", team: "TEAM", department: "Department" },
    dedupe: (r) => r.rep, dateField: null, repField: null,
  },
  targets: {
    workbook: "context",
    require: ["KPI", "Target"], exclude: [],
    schema: { kpiId: "KPI", scope: "Scope", scopeValue: "Scope Value", period: "Period", value: "Target" },
    dedupe: null, dateField: null, repField: null,
  },
  speed_to_lead: {
    workbook: "speed_to_lead",
    require: ["Speed to Lead Claimed Date & Time", "Lead Source"], exclude: [],
    tabInclude: /Speed to Lead X YTD/i, tabField: "__tab",
    schema: {
      id: ["Lead ID", "Opportunity ID"], name: ["Company / Account", "Company", "Opportunity Name"],
      claimed: "Speed to Lead Claimed Date & Time", editDate: "Edit Date",
      createdTime: "Created time", createdDate: "Create Date",
      icp: ["Total Tier 1 ICP", "Total ICP Score"], source: "Lead Source",
      newValue: "New Value", tab: "__tab",
    },
    dedupe: null, dateField: null, repField: null,
  },
  // Dispositions — campaign-member grain (one row per buyer/prospect per campaign). Stable Salesforce IDs
  // (Opportunity ID, Campaign ID) enable cross-referencing to Opportunities/Transactions without text joins.
  // Aggregate/stage-based, not per-rep, so it's consumed directly by DispositionsView rather than the KPI path.
  dispositions: {
    workbook: "dispositions",
    require: ["Opportunity ID", "Campaign ID", "Campaign Member Status"], exclude: [],
    tabInclude: /Opportunities.*Campaigns/i,
    schema: {
      oid: "Opportunity ID", oppName: "Opportunity Name", stage: "Stage",
      campId: "Campaign ID", campName: "Campaign Name",
      campStatus: "Campaign Status", memberStatus: "Campaign Member Status", member: "Full Name",
      source: "Campaign Member Source", txType: "Transaction Type",
      // cumulative "ever-reached" checkboxes (1/0) — sparse now, backfills over time
      cbInterested: "Interested", cbConfirmed: "Confirmed Walkthrough",
      cbWalkNew: "Walkthrough Attended - New", cbOffer: "Walkthrough Attended - Offer Made",
    },
    dedupe: null, dateField: "date", dateCandidates: ["Member Status Update Date"], repField: null,
  },
};

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const q = (title) => encodeURIComponent("'" + String(title).replace(/'/g, "''") + "'");

async function listTabs(id, key) {
  const url = `${SHEETS_API}/${id}?fields=sheets.properties(title)&key=${key}&_=${Date.now()}`;
  const meta = await fetch(url, { cache: "no-store" }).then((r) => r.json());
  if (meta.error) throw new Error(meta.error.message);
  return (meta.sheets || []).map((s) => s.properties.title);
}
async function batchGet(id, titles, key) {
  const ranges = titles.map((t) => `ranges=${q(t)}`).join("&");
  const url = `${SHEETS_API}/${id}/values:batchGet?${ranges}` +
    `&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&key=${key}&_=${Date.now()}`;
  const data = await fetch(url, { cache: "no-store" }).then((r) => r.json());
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
function tabMatches(headers, ds, title = "") {
  const h = headers || [];
  if (!(ds.require.every((x) => h.includes(x)) && !ds.exclude.some((x) => h.includes(x)))) return false;
  if (ds.tabInclude && !ds.tabInclude.test(title)) return false;
  if (ds.tabExclude && ds.tabExclude.test(title)) return false;
  return true;
}
function makeGoogleClient(key) {
  const cache = {};
  return {
    async loadDataset(ds) {
      const wb = WORKBOOKS[ds.workbook];
      if (!cache[ds.workbook]) {
        const titles = await listTabs(wb.id, key);
        const raw = await batchGet(wb.id, titles, key);
        const parsed = {};
        const hints = Array.from(new Set(Object.values(DATASETS).flatMap((d) =>
          [...d.require, ...Object.values(d.schema).flatMap((h) => (Array.isArray(h) ? h : [h]))])));
        for (const t of titles) parsed[t] = rowsToObjects(raw[t] || [], hints);
        cache[ds.workbook] = parsed;
      }
      let rows = [], claimed = [];
      for (const [title, parsed] of Object.entries(cache[ds.workbook])) {
        if (tabMatches(parsed.headers, ds, title)) {
          const tabRows = ds.tabField ? parsed.rows.map((r) => ({ ...r, [ds.tabField]: title })) : parsed.rows;
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

const normKey = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
function normalize(rows, ds) {
  return rows.map((row) => {
    let ci = null; // lazily-built case/whitespace-insensitive index of this row's headers (fallback only)
    const get = (h) => {
      if (h in row) return row[h];                       // exact match wins — no behavior change when headers align
      if (!ci) { ci = {}; for (const k in row) ci[normKey(k)] = row[k]; }
      return ci[normKey(h)];                             // tolerate case / stray spacing in the sheet header
    };
    const o = {};
    for (const f in ds.schema) { const h = ds.schema[f];
      o[f] = Array.isArray(h) ? (h.map((k) => get(k)).find((v) => v != null && v !== "")) : get(h); }
    if (ds.dateCandidates) for (const c of ds.dateCandidates) { const v = get(c); if (v != null && v !== "") { o.date = v; break; } }
    return o;
  });
}
function dedupe(rows, keyFn) {
  if (!keyFn) return rows;
  const seen = new Set(); const out = [];
  for (const r of rows) { const k = keyFn(r); if (k == null || !seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}
async function loadAll(onProgress) {
  const useGoogle = !!API_KEY;
  const client = useGoogle ? makeGoogleClient(API_KEY) : makeMockClient();
  const store = {}, diagnostics = [];
  const keys = Object.keys(DATASETS);
  const total = keys.length;
  const friendly = (ds) => { const t = WORKBOOKS[ds.workbook]?.title || ds.workbook; const m = t.match(/\(([^)]+)\)/); return (m ? m[1] : t).trim(); };
  let done = 0;
  for (const key of keys) {
    const ds = DATASETS[key];
    onProgress && onProgress({ done, total, label: friendly(ds) }); // announce what's about to load
    const { rows, claimed } = await client.loadDataset(ds);
    store[key] = dedupe(normalize(rows, ds), ds.dedupe);
    done++;
    onProgress && onProgress({ done, total, label: friendly(ds) });
    if (useGoogle && !rows.length)
      diagnostics.push({ dataset: key, note: `no tabs matched [${ds.require.join(", ")}] in ${WORKBOOKS[ds.workbook].title}` });
    else if (useGoogle) console.log(`[${key}] ${store[key].length} rows from tabs:`, claimed);
  }
  if (store.arip) {
    const first2full = {};
    (store.directory || []).forEach((p) => { const f = String(p.rep || "").trim().split(/\s+/)[0].toLowerCase(); if (f && !first2full[f]) first2full[f] = String(p.rep).trim(); });
    store.arip = dedupe(store.arip.map((r) => {
      let rep = String(r.rep || "").trim();
      if (!rep) { const f = String(r.tab || "").split("-").pop().trim().toLowerCase(); rep = first2full[f] || f; }
      return { ...r, rep };
    }), (r) => `${String(r.rep).trim()}|${r.name}|${r.newValue}|${r.date}`);
    if (useGoogle) console.log(`[arip] ${store.arip.length} rows after rep resolution`);
  }
  // Opps Assigned / Deaded live in per-VP tabs ("... x YTD - Joey"); resolve the rep from the tab name.
  ["opps_assigned", "opps_deaded"].forEach((k) => {
    if (!store[k] || !store[k].length) return;
    const first2full = {};
    (store.directory || []).forEach((p) => { const f = String(p.rep || "").trim().split(/\s+/)[0].toLowerCase(); if (f && !first2full[f]) first2full[f] = String(p.rep).trim(); });
    store[k] = store[k].map((r) => {
      const f = String(r.tab || "").split("-").pop().trim().toLowerCase();
      return { ...r, rep: first2full[f] || (f ? f.charAt(0).toUpperCase() + f.slice(1) : "") };
    });
    if (useGoogle) console.log(`[${k}] ${store[k].length} rows`);
  });
  return { store, diagnostics, mode: useGoogle ? "google" : "mock" };
}

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

// Derive a role label from the TEAM name. The Context sheet no longer carries a ROLE
// column, so role (used for VP detection, role-aware Show Rate, and the scorecard Role
// column) is inferred from team. If a ROLE value ever comes back, it takes precedence.
function roleFromTeam(team) {
  const s = String(team || "").toLowerCase();
  if (/vice\s*president|\bvp\b/.test(s)) return "Vice President";
  if (/acqu/.test(s)) return "Acquisition Manager";
  if (/follow.?up/.test(s)) return "Follow-Up Specialist";
  if (/listing/.test(s)) return "Listing Partner";
  return team ? String(team).trim() : "";
}
function buildDirectory(store) {  const clean = (v) => (typeof v === "string" ? v.trim() : v);
  const people = (store.directory || []).map((p) => { const team = clean(p.team);
    return { ...p, rep: clean(p.rep), name: clean(p.name), role: clean(p.role) || roleFromTeam(team), team, department: clean(p.department), company: clean(p.company) }; });
  const byRep = {}; people.forEach((p) => { if (p.rep) byRep[p.rep] = p; });
  const distinct = (f) => [...new Set(people.map((p) => p[f]).filter(Boolean))].sort();
  const dataReps = [...new Set([...(store.opps_closed || []), ...(store.opps_created || [])].map((r) => r.owner).filter(Boolean))].sort();
  return { people, byRep, options: {
    company: distinct("company"), department: distinct("department"), team: distinct("team"),
    role: distinct("role"), rep: people.length ? distinct("rep") : dataReps } };
}
// A Listing Partner is any directory rep whose (canonical) role or team reads "Listing".
const isLProle = (role, team) => /listing/i.test(String(role || "")) || /listing/i.test(String(team || ""));
function lpNameSet(dir) {
  return (dir.people || []).filter((p) => isLProle(p.role, p.team)).map((p) => String(p.rep).trim());
}
// Tag each appointment row with lpAssigned = its Assigned rep is a Listing Partner.
// Lets the outcome-based appointment metrics pull LP-routed appts out of the AM/FU + VP numbers.
function tagApptRoles(store, dir) {
  const lps = lpNameSet(dir);
  const isLP = (name) => { const n = String(name || "").trim(); return !!n && lps.some((r) => nameMatch(n, r)); };
  ["appointments", "appointments_attended", "appts_seg"].forEach((k) => { (store[k] || []).forEach((r) => { r.lpAssigned = isLP(r.rep); }); });
}
// Synthetic Team option: a role-union of Acquisition Managers + Follow-Up Specialists across every real team.
// It isn't a directory team — repsInScope and orgOptions expand it to "role matches AM or Follow-Up" instead
// of matching p.team, so all rep-scoped KPIs, tables, and the rep dropdown restrict to those two roles.
const TEAM_AMFU = "AMs + Follow-Up Specialists";
const isAmFuRole = (role) => /acqu|follow.?up/i.test(String(role || ""));
const teamMatches = (p, orgTeam) => orgTeam === "All" || (orgTeam === TEAM_AMFU ? isAmFuRole(p.role) : p.team === orgTeam);
function repsInScope(dir, org) {
  const noOrgFilter = org.company === "All" && org.department === "All" && org.team === "All" && org.role === "All" && org.rep === "All";
  if (noOrgFilter) return null;
  if (!dir.people.length) return org.rep !== "All" ? new Set([String(org.rep).trim()]) : null;
  const matched = dir.people.filter((p) =>
    (org.company === "All" || p.company === org.company) && (org.department === "All" || p.department === org.department) &&
    teamMatches(p, org.team) && (org.role === "All" || p.role === org.role) &&
    (org.rep === "All" || p.rep === org.rep));
  return new Set(matched.map((p) => String(p.rep).trim()));
}
// Set of every rep in the Context directory (source of truth). Used to keep
// non-directory names (people who show up only in raw activity data) out of the
// per-rep tables even in the unfiltered "All" view, where repsInScope returns null.
// Returns null if the directory failed to load, so the tables fall back to showing all.
function directorySet(dir) {
  return dir.people && dir.people.length ? new Set(dir.people.map((p) => String(p.rep).trim())) : null;
}
function creditRole(org) {
  const s = `${org.role || ""} ${org.team || ""}`.toLowerCase();
  if (/vice\s*president|\bvp\b/.test(s)) return { field: "owner", label: "Vice President" };
  if (/follow.?up/.test(s)) return { field: "followUp", label: "Follow-Up Specialist" };
  if (/acqu/.test(s)) return { field: "acqManager", label: "Acquisition Manager" };
  if (/listing/.test(s)) return { field: "owner", label: "Listing Partner" };
  return { field: "owner", label: "Owner" };
}
// Listing-Partner helpers. LP identity lives in a tab name ("Listing Pipeline x YTD - Da Silva")
// or the Assigned field on appointments; directory name may be fuller ("Brendan Da Silva"), so match loosely.
const normName = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const nameMatch = (a, b) => { const x = normName(a), y = normName(b); return !!(x && y && (x === y || x.includes(y) || y.includes(x))); };
const tabLP = (t) => { const s = String(t || ""); const i = s.indexOf(" - "); return (i >= 0 ? s.slice(i + 3) : s).trim(); };
// Returns the Listing Partner's rep name if the current scope is exactly one Listing Partner, else null.
function lpScopeName(dir, org) {
  if (org.rep && org.rep !== "All") { const p = dir.byRep && dir.byRep[String(org.rep).trim()];
    if (p && /listing/i.test(String(p.role || ""))) return String(org.rep).trim(); }
  return null;
}
// True when the current scope is a VP (a VP team or a single VP rep). Directory-driven:
// every rep resolved in scope must be a VP. Used to gate VP-only KPIs (e.g. Contracts Sent,
// which is tracked by the Assigned rep = the VP). Falls back to name-based detection if the
// directory hasn't loaded. The unfiltered "All" view is never VP scope.
function isVpScope(dir, org) {
  const isVP = (role) => /vice\s*president|\bvp\b/i.test(String(role || ""));
  const scope = repsInScope(dir, org);
  if (scope && scope.size) return [...scope].every((r) => isVP(dir.byRep[r]?.role));
  return isVP(`${org.role || ""} ${org.team || ""}`); // fallback when directory absent/empty
}
function isAmFuScope(dir, org) {
  const test = (role) => /acqu|follow.?up/i.test(String(role || ""));
  const scope = repsInScope(dir, org);
  if (scope && scope.size) return [...scope].every((r) => test(dir.byRep[r]?.role));
  return test(`${org.role || ""} ${org.team || ""}`);
}

const WEEK_START = 1;
const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const eod = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sow = (d) => { const x = sod(d); return addDays(x, -(((x.getDay() - WEEK_START) + 7) % 7)); };
const som = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const eom = (d) => eod(new Date(d.getFullYear(), d.getMonth() + 1, 0));
const soq = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const eoq = (d) => eod(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0));
const eoy = (d) => eod(new Date(d.getFullYear(), 11, 31));
const eow = (d) => eod(addDays(sow(d), 6));
const DATE_PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["this_week", "This Week"], ["last_week", "Last Week"],
  ["this_month", "This Month"], ["last_month", "Last Month"], ["this_quarter", "This Quarter"], ["last_quarter", "Last Quarter"], ["next_quarter", "Next Quarter"],
  ["this_year", "This Year"], ["full_year", "Full Year"], ["custom", "Custom Range"]];
function resolveRange(preset, custom, now = new Date(), forward = false) {
  switch (preset) {
    case "today": return { start: sod(now), end: eod(now) };
    case "yesterday": { const y = addDays(now, -1); return { start: sod(y), end: eod(y) }; }
    case "this_week": return { start: sow(now), end: forward ? eow(now) : eod(now) };
    case "last_week": { const s = addDays(sow(now), -7); return { start: s, end: eod(addDays(s, 6)) }; }
    case "this_month": return { start: som(now), end: forward ? eom(now) : eod(now) };
    case "last_month": { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { start: s, end: eom(s) }; }
    case "this_quarter": return { start: soq(now), end: forward ? eoq(now) : eod(now) };
    case "last_quarter": { const s = new Date(soq(now)); s.setMonth(s.getMonth() - 3); return { start: s, end: eom(new Date(s.getFullYear(), s.getMonth() + 2, 1)) }; }
    case "next_quarter": { const s = new Date(soq(now)); s.setMonth(s.getMonth() + 3); return { start: s, end: eoq(s) }; }
    case "this_year": return { start: new Date(now.getFullYear(), 0, 1), end: forward ? eoy(now) : eod(now) };
    case "full_year": return { start: new Date(now.getFullYear(), 0, 1), end: eod(new Date(now.getFullYear(), 11, 31)) };
    case "custom": return { start: sod(new Date(custom.start)), end: eod(new Date(custom.end)) };
    default: return { start: som(now), end: eod(now) };
  }
}
const rangeDays = (r) => Math.max(1, Math.round((r.end - r.start) / 86400000) + 1);
// Fraction of calendar months a range covers: full months count as 1 (so a quarter = 3.0, a year = 12.0);
// a partial current month prorates by day. Used to scale monthly targets to the selected period.
function monthsInRange(start, end) {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let total = 0, y = s.getFullYear(), m = s.getMonth();
  while (y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth())) {
    const dim = new Date(y, m + 1, 0).getDate();
    const first = (y === s.getFullYear() && m === s.getMonth()) ? s.getDate() : 1;
    const last = (y === e.getFullYear() && m === e.getMonth()) ? e.getDate() : dim;
    total += (last - first + 1) / dim;
    m++; if (m > 11) { m = 0; y++; }
  }
  return total || 1 / 30.4;
}
// Inclusive Mon–Fri count between two dates (date-only).
function businessDaysBetween(start, end) {
  let s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let n = 0;
  while (s <= e) { const d = s.getDay(); if (d !== 0 && d !== 6) n++; s.setDate(s.getDate() + 1); }
  return n;
}
// Business-day analog of monthsInRange: a full month = 1.0 (so a quarter = 3.0, year = 12.0);
// partial/current periods prorate by business days within the month, and weekends contribute nothing.
function businessMonthsInRange(start, end) {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let total = 0, y = s.getFullYear(), m = s.getMonth();
  while (y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth())) {
    const mStart = new Date(y, m, 1), mEnd = new Date(y, m + 1, 0);
    const from = s > mStart ? s : mStart, to = e < mEnd ? e : mEnd;
    const bizMonth = businessDaysBetween(mStart, mEnd);
    if (bizMonth) total += businessDaysBetween(from, to) / bizMonth;
    m++; if (m > 11) { m = 0; y++; }
  }
  return total;
}
function parseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[1] - 1, +m[2]); }
  const d = new Date(s); return isNaN(d) ? null : d;
}
const monthKey = (v) => { const d = parseDate(v); return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : null; };
// Whole-day gap between two date columns (date-only). null if either side is blank or the gap is negative.
const daysBetween = (from, to) => { const a = parseDate(from), b = parseDate(to); if (!a || !b) return null; const d = Math.round((b - a) / 86400000); return d >= 0 ? d : null; };

function dedupeLatest(rows, keyField, dateField, prefer) {
  const best = {}, keep = [];
  for (const r of rows) {
    const k = String(r[keyField] ?? "").trim();
    if (!k) { keep.push(r); continue; }               // no id → can't dedupe, keep as-is
    const t = +(dateField && parseDate(r[dateField])) || 0;
    const p = prefer ? (prefer(r) ? 1 : 0) : 1;        // prefer qualifying rows (positive stages) over dead-ends
    const cur = best[k];
    if (!cur || p > cur.p || (p === cur.p && t >= cur.t)) best[k] = { r, t, p };
  }
  return keep.concat(Object.values(best).map((x) => x.r));
}
function applyFilters(rows, ds, org, range, dir) {
  const fields = ds.repFields || (ds.repField ? [ds.repField] : null);
  const reps = fields ? repsInScope(dir, org) : null;
  const dateOn = !!(range && ds.dateField && rows.some((r) => r[ds.dateField]));
  const out = rows.filter((row) => {
    if (reps && !fields.some((f) => reps.has(String(row[f] ?? "").trim()))) return false;
    if (dateOn) { const t = parseDate(row[ds.dateField]); if (!t || t < range.start || t > range.end) return false; }
    return true;
  });
  return ds.dedupeInPeriod ? dedupeLatest(out, ds.dedupeInPeriod, ds.dateField, ds.dedupePrefer) : out; // dedupe within the filtered window
}

const num = (v) => Number(v) || 0;
const isQC = (r) => num(r.qc) === 1;
const isYes = (v) => { const s = String(v ?? "").trim().toLowerCase(); return s === "yes" || s === "y" || s === "true" || s === "1" || Number(v) === 1; };
const isOpen = (s) => s && !/closed/i.test(s);
const groupSum = (rows, keyFn, valFn) => { const m = {}; rows.forEach((r) => { const k = keyFn(r); if (k) m[k] = (m[k] || 0) + valFn(r); }); return Object.entries(m).map(([label, value]) => ({ label, value })); };
const txTypeOf = (r) => String(r.txType ?? "").trim();
const ALL_ORG = { company: "All", department: "All", team: "All", role: "All", rep: "All" };
// Single source of truth: which views expose (and therefore apply) Team/Rep filtering.
// Views that don't expose it must not silently honor a stale Team/Rep selection carried over from another view.
const viewUsesRepFilter = (v) => v !== "speedtolead" && v !== "marketing";
const scopeOrgForView = (org, view) => viewUsesRepFilter(view) ? org : { ...org, team: "All", rep: "All" };
// "Out of ARIP" = an opp whose ARIP New Value advanced to any active downstream stage.
// One source of truth for the three ARIP-out KPIs (Deals Out of ARIP, Pull-Through, Revenue).
const ARIP_OUT_STAGES = ["Deal Review", "Pre Marketing", "Delayed Marketing", "Marketing", "Post Showing", "Buyer ARIP", "Under Contract", "Closed in Accounting Reconciliation", "Closed With Escrow", "Closed Won", "On Market", "Owned", "Rehab In Progress", "Pre Closing", "Investment Committee (IC)", "Investment Committee", "Deals w/ Issues", "Probate"];
const isAripOut = (v) => ARIP_OUT_STAGES.includes(String(v ?? "").trim());
// Stage-transition durations for the Transactions view. Each = day-gap between two date columns on the
// Median Duration tabs (Transactions workbook), computed in-app from the raw stage dates — not the sheet's
// precomputed "Duration ARIP to Closed" — so every transition uses one consistent method. Add a row here to
// track a new transition; no other change is needed (schema fields already carry the dates).
const TX_STAGE_DURATIONS = [
  { id: "arip_close",       label: "ARIP → Close",                from: "aripDate",          to: "closeDate" },
  { id: "dealreview_close", label: "Deal Review → Close",         from: "dealReviewDate",    to: "closeDate" },
  { id: "premkt_close",     label: "Pre-Marketing → Close",       from: "preMarketingDate",  to: "closeDate" },
  { id: "mkt_close",        label: "Marketing → Close",           from: "marketingDate",     to: "closeDate" },
  { id: "buyerarip_close",  label: "Buyer ARIP → Close",          from: "buyerAripDate",     to: "closeDate" },
  { id: "uc_close",         label: "Under Contract → Close",      from: "underContractDate", to: "closeDate" },
  { id: "mkt_buyerarip",    label: "Marketing → Buyer ARIP",      from: "marketingDate",     to: "buyerAripDate" },
  { id: "buyerarip_uc",     label: "Buyer ARIP → Under Contract", from: "buyerAripDate",     to: "underContractDate" },
];
// One matrix cell: median days (headline) + average & deal count beneath (renders "—" when empty). Uses module-level theme T.
function txDurCell(c) {
  if (!c || c.median == null) return <span style={{ color: T.faint }}>—</span>;
  return (<><span>{Math.round(c.median)}<span style={{ color: T.faint, fontWeight: 400 }}> d</span></span>
    <div className="text-[9px] leading-none" style={{ color: T.faint }}>avg {Math.round(c.avg)}d · {c.n}</div></>);
}
// ── Stage CONVERSION / PROBABILITY engine (Transactions view) ────────────────────────────────────────
// Source: "All Opportunity Stage History x YTD" (stage_history dataset). Two reports off one engine:
//   A) Resolved close rate — of opps that ENTERED a stage in the selected period, the share that reached a
//      Closed (Won) state, measured over RESOLVED deals only. A deal still at/ahead in the ladder is
//      excluded as in-flight; a deal that reverted below where it entered — or is Dead — is a miss.
//   B) Adjacent advance % — of opps that reached stage A, the share that ever reached the next core stage
//      B (chainable down the funnel).
// STAGE_ORDER is JP's exact stage sequence; positions decide "reverted (miss) vs still-advancing (in-flight)".
// Closed variants collapse to one Won bucket; Dead+Dead With Escrow are the only misses-by-outcome. Deals
// bounce between early stages and can revive (Dead→New), which is why cohorts anchor on first entry and
// outcome is read from the single current-stage column rather than the last transition.
const STAGE_ORDER = ["New", "Short Term Nurture", "Cadence Replied", "Nurture", "Appointment Set",
  "Underwriting Complete", "Appt Set Offering", "Appointment DNH", "Negotiation", "Red Zone",
  "Arip", "Deal Review", "Investment Committee (IC)", "Delayed Marketing", "Renegotiation",
  "Pre Marketing", "Marketing", "Post Showing", "Buyer ARIP", "Under Contract", "Pre Closing"];
const STAGE_POS = STAGE_ORDER.reduce((m, s, i) => { m[s] = i + 1; return m; }, {});
STAGE_POS["Investment Committee"] = STAGE_POS["Investment Committee (IC)"]; // data uses the "(IC)" suffix
STAGE_POS["ARIP"] = STAGE_POS["Arip"];
const WON_STAGES = new Set(["Closed in Accounting Reconciliation", "Closed With Escrow", "Closed Won"]);
const DEAD_STAGES = new Set(["Dead", "Dead With Escrow"]);
// Classify a cohort deal's CURRENT stage relative to the stage it entered.
const stageOutcome = (fromStage, o) => {
  const cur = String(o.cur ?? "").trim();
  if (o.won) return "win";                 // Won only if confirmed in the Closed Opps report
  if (DEAD_STAGES.has(cur)) return "miss";
  if (WON_STAGES.has(cur)) return "exclude"; // in a closed stage but not in the Closed report → pending, not counted
  const fp = STAGE_POS[fromStage], cp = STAGE_POS[cur];
  if (cp == null) return "miss";        // off-ladder end state (flip/listing/etc.) → miss
  return cp < fp ? "miss" : "exclude";  // reverted below entry → miss; at/ahead & still open → in-flight
};
// Report-A from-stages and Report-B adjacent chain (data labels).
const STAGE_CONV_FROM = [
  { id: "arip",       label: "ARIP → Close",          stage: "Arip" },
  { id: "dealreview", label: "Deal Review → Close",    stage: "Deal Review" },
  { id: "premkt",     label: "Pre-Marketing → Close",  stage: "Pre Marketing" },
  { id: "mkt",        label: "Marketing → Close",      stage: "Marketing" },
  { id: "postshow",   label: "Post Showing → Close",   stage: "Post Showing" },
  { id: "buyerarip",  label: "Buyer ARIP → Close",     stage: "Buyer ARIP" },
  { id: "uc",         label: "Under Contract → Close", stage: "Under Contract" },
  { id: "preclose",   label: "Pre Closing → Close",    stage: "Pre Closing" },
];
const STAGE_CONV_CHAIN = ["Arip", "Deal Review", "Pre Marketing", "Marketing", "Post Showing", "Buyer ARIP", "Under Contract", "Pre Closing", "Closed"];
const STAGE_SHORT = { "Arip": "ARIP", "Deal Review": "Deal Review", "Pre Marketing": "Pre-Marketing",
  "Marketing": "Marketing", "Post Showing": "Post Showing", "Buyer ARIP": "Buyer ARIP", "Under Contract": "Under Contract", "Pre Closing": "Pre-Closing", "Closed": "Closed" };
// Front-end purchases legitimately skip Buyer ARIP. The Transactions stage panels expose a toggle to pull
// these out entirely; this is the membership test for that toggle.
const isExcludedRecord = (r) => /front.?end/i.test(String(r.recordType ?? ""));
// Roll transition-level rows up to one record per opp: current stage + first in-window entry date per stage,
// plus owner/VP & AM (constant per opp). Rows arrive already org/rep/dir-gated (range=null); we date-anchor here.
function stageOppAgg(rows, closedSet) {
  const m = new Map();
  for (const r of rows) {
    const id = r.id; if (id == null || id === "") continue;
    let o = m.get(id);
    if (!o) { o = { cur: "", owner: String(r.owner ?? "").trim(), am: String(r.acqManager ?? "").trim(), entered: {} }; m.set(id, o); }
    const st = String(r.stage ?? "").trim(); if (st) o.cur = st;      // current stage (constant per opp)
    if (!o.owner && r.owner) o.owner = String(r.owner).trim();
    if (!o.am && r.acqManager) o.am = String(r.acqManager).trim();
    const nv = String(r.newValue ?? "").trim();
    if (nv) { const t = parseDate(r.date); if (o.entered[nv] === undefined || (t && o.entered[nv] && o.entered[nv] > t)) o.entered[nv] = t || o.entered[nv] || null; }
  }
  // Skip assumption (symmetric): a Won deal that never logged a late stage is assumed to have passed through
  // it — credit the entry so fast closers that skip Under Contract / Buyer ARIP aren't missing from those
  // cohorts or read as leaks. Order matters: fill Under Contract first, then Buyer ARIP can inherit its date.
  m.forEach((o, id) => {
    o.won = closedSet ? closedSet.has(id) : WON_STAGES.has(o.cur); // Won = confirmed in Closed Opps report (fallback: current stage)
    const wonDate = () => { let d; for (const s of WON_STAGES) { const t = o.entered[s]; if (t && (d === undefined || t < d)) d = t; } return d; };
    if (!("Under Contract" in o.entered) && o.won) { const d = wonDate(); if (d !== undefined) o.entered["Under Contract"] = d || null; }
    if (!("Buyer ARIP" in o.entered)) {
      let d = o.entered["Under Contract"];
      if (d === undefined && o.won) d = wonDate();
      if (d !== undefined) o.entered["Buyer ARIP"] = d || null;
    }
  });
  return m;
}
const enteredInRange = (o, stage, range) => {
  if (!(stage in o.entered)) return false;
  if (!range) return true;
  const t = o.entered[stage]; return !!(t && t >= range.start && t <= range.end);
};
const reachedStage = (o, stage) => {
  if (stage === "Closed") return !!o.won;               // reached Closed = CONFIRMED won (in the Closed report)
  if (stage in o.entered) return true;                 // ever entered it
  if (o.won) return true;                              // confirmed closed ⇒ passed every prior gate
  const cp = STAGE_POS[o.cur], sp = STAGE_POS[stage];
  return !!(cp && sp && cp >= sp);                     // current stage at/ahead of it
};
function stageReportA(agg, range) {
  return STAGE_CONV_FROM.map((f) => {
    let win = 0, miss = 0, inflight = 0;
    agg.forEach((o) => { if (!enteredInRange(o, f.stage, range)) return;
      const k = stageOutcome(f.stage, o); if (k === "win") win++; else if (k === "miss") miss++; else inflight++; });
    const resolved = win + miss;
    return { ...f, win, miss, inflight, cohort: win + miss + inflight, rate: resolved ? win / resolved : null };
  }).filter((r) => r.cohort > 0);
}
function stageReportB(agg, range) {
  const steps = [];
  for (let i = 0; i < STAGE_CONV_CHAIN.length - 1; i++) {
    const a = STAGE_CONV_CHAIN[i], b = STAGE_CONV_CHAIN[i + 1];
    let base = 0, adv = 0;
    agg.forEach((o) => { if (!enteredInRange(o, a, range)) return; base++; if (reachedStage(o, b)) adv++; });
    steps.push({ id: a + ">" + b, from: STAGE_SHORT[a] || a, to: STAGE_SHORT[b] || b, base, adv, rate: base ? adv / base : null });
  }
  return steps;
}
// Resolved close rate broken out by VP (Opportunity Owner = the assigner) across every from-stage.
function stageReportByVP(agg, range, dir) {
  const isVP = (name) => /president|vp\b/i.test(dir?.byRep?.[name]?.role || "");
  const names = new Set();
  agg.forEach((o) => { if (o.owner && isVP(o.owner)) names.add(o.owner); });
  return [...names].map((vp) => {
    const cells = {};
    STAGE_CONV_FROM.forEach((f) => {
      let win = 0, miss = 0;
      agg.forEach((o) => { if (o.owner !== vp || !enteredInRange(o, f.stage, range)) return;
        const k = stageOutcome(f.stage, o); if (k === "win") win++; else if (k === "miss") miss++; });
      cells[f.id] = { win, miss, rate: (win + miss) ? win / (win + miss) : null };
    });
    return { vp, cells };
  }).sort((a, b) => a.vp.localeCompare(b.vp));
}
// ICP score × funnel-stage matrix (Marketing view). ISA ICP Total Score lives on opps_created keyed by
// Opportunity ID, NOT on stage_history — so the caller joins it onto each opp in the stage aggregation
// (o.icp) before calling this. Rows = each distinct ISA ICP score present (+ an "Unscored" row for blanks),
// built from the data so it's robust if the score ever runs past 7. Columns = ARIP / Deal Review / Under
// Contract / Closed. Cell = # opps that ENTERED that stage within the period (flow), matching how every
// other stage metric here date-filters; Closed = confirmed won with a close date in the window. `coverage`
// = share of the in-period funnel opps that carry an ICP score, surfaced so sync gaps read as data.
const ICP_FUNNEL_STAGES = [
  { key: "arip",       label: "ARIP",           stage: "Arip" },
  { key: "dealreview", label: "Deal Review",    stage: "Deal Review" },
  { key: "uc",         label: "Under Contract", stage: "Under Contract" },
  { key: "closed",     label: "Closed",         stage: "Closed" },
];
function icpScoreFunnel(agg, range, closeById) {
  const closedInRange = (o, id) => {
    if (!o.won) return false;
    if (!range) return true;
    const c = closeById && closeById.get(id);
    const t = c ? parseDate(c.closeDate) : (o.entered["Under Contract"] || null); // fall back to UC date if no close row
    return !!(t && t >= range.start && t <= range.end);
  };
  const bucket = (icp) => {
    if (icp == null || String(icp).trim() === "") return { k: "__ns", label: "Unscored", sort: 1e6 };
    const n = Number(icp); if (isNaN(n)) return { k: "__ns", label: "Unscored", sort: 1e6 };
    const v = Math.trunc(n); return { k: String(v), label: `ICP ${v}`, sort: v };
  };
  const map = new Map();
  let scoredOpps = 0, totalOpps = 0;
  agg.forEach((o, id) => {
    const hitArip = enteredInRange(o, "Arip", range);
    const hitDR   = enteredInRange(o, "Deal Review", range);
    const hitUC   = enteredInRange(o, "Under Contract", range);
    const hitCl   = closedInRange(o, id);
    if (!(hitArip || hitDR || hitUC || hitCl)) return; // opp didn't touch the funnel in-period
    const b = bucket(o.icp);
    totalOpps++; if (b.k !== "__ns") scoredOpps++;
    let row = map.get(b.k);
    if (!row) { row = { key: b.k, label: b.label, sort: b.sort, arip: 0, dealreview: 0, uc: 0, closed: 0 }; map.set(b.k, row); }
    if (hitArip) row.arip++;
    if (hitDR) row.dealreview++;
    if (hitUC) row.uc++;
    if (hitCl) row.closed++;
  });
  const rows = [...map.values()]
    .map((r) => ({ ...r, total: r.arip + r.dealreview + r.uc + r.closed }))
    .filter((r) => r.total > 0)
    .sort((a, b) => a.sort - b.sort);
  const totals = rows.reduce((t, r) => ({ arip: t.arip + r.arip, dealreview: t.dealreview + r.dealreview, uc: t.uc + r.uc, closed: t.closed + r.closed, total: t.total + r.total }),
    { arip: 0, dealreview: 0, uc: 0, closed: 0, total: 0 });
  return { rows, totals, coverage: totalOpps ? scoredOpps / totalOpps : null };
}
// Stage FLOW for the selected period — movement, not outcomes. Counts stage transitions whose Edit Date
// falls in the window: how many deals ENTERED each core stage, how many LEFT, and of those that left, how
// many Advanced (moved forward or closed), Reverted (slipped to an earlier stage), or went Dead. Because it's
// keyed on the transition date it reads cleanly on any window — including This Month — unlike the cohort
// close rates, which wait on maturity. This is the real-time "what's happening now / where's the leak" view.
function stageFlow(rows, range) {
  const inR = (d) => { if (!range) return true; const t = parseDate(d); return !!(t && t >= range.start && t <= range.end); };
  const CORE = STAGE_CONV_CHAIN.filter((s) => s !== "Closed");
  const stat = {}; CORE.forEach((s) => { stat[s] = { stage: s, label: STAGE_SHORT[s] || s, entered: 0, left: 0, adv: 0, rev: 0, dead: 0 }; });
  for (const r of rows) {
    if (!inR(r.date)) continue;
    const ov = String(r.oldValue ?? "").trim(), nv = String(r.newValue ?? "").trim();
    if (nv && stat[nv]) stat[nv].entered++;
    if (ov && stat[ov]) { const e = stat[ov]; e.left++;
      if (WON_STAGES.has(nv)) e.adv++;
      else if (DEAD_STAGES.has(nv)) e.dead++;
      else { const op = STAGE_POS[ov], np = STAGE_POS[nv];
        if (np != null && op != null && np > op) e.adv++; else e.rev++; } }
  }
  return CORE.map((s) => { const e = stat[s];
    return { ...e, advPct: e.left ? e.adv / e.left : null, revPct: e.left ? e.rev / e.left : null, deadPct: e.left ? e.dead / e.left : null }; });
}
// Appointment outcome semantics (JP spec):
//   attended  = "Appointment Met" ONLY. Anything containing "no show" / "missed" is a miss —
//               including "Attended, No Show", which counts toward the total but not as attended.
//   excluded  = Cancelled / Rescheduled (dropped from the show-rate calc entirely)
//   scheduled (show-rate denominator) = every appt with a Start in window EXCEPT the excluded ones —
//     this INCLUDES blanks, no-shows, and "Attended, No Show", so they count against the rate
const apptExcluded = (o) => /cancel|reschedul/i.test(String(o ?? ""));
const apptAttended = (o) => { const s = String(o ?? "").trim().toLowerCase();
  if (/no show|missed/.test(s)) return false;
  return /appointment met/.test(s) || s === "met"; };
// Normalize a raw Lead Source into one of the three inbound channels for the talk-time tile.
// Directory of raw values seen in the sync: "Direct Mail Campaign", "Pay Per Lead", "Website".
const inboundChannel = (s) => { const x = String(s ?? "").toLowerCase();
  if (/direct\s*mail/.test(x)) return "Direct Mail";
  if (/pay\s*per\s*lead|\bppl\b/.test(x)) return "Pay Per Lead";
  if (/web\s*site|website/.test(x)) return "Website";
  return "Other"; };
const KPIS = {
  closed_revenue: { id: "closed_revenue", label: "Closed Revenue", dataset: "closed_opps", format: "currency", breakoutRep: "acqManager",
    targetKey: "closed_revenue", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.reduce((s, o) => s + num(o.revenue), 0) },
  deals_closed: { id: "deals_closed", label: "Deals Closed", dataset: "closed_opps", format: "number", breakoutRep: "acqManager",
    targetKey: "deals_closed", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  avg_deal: { id: "avg_deal", label: "Avg Deal Size", dataset: "closed_opps", format: "currency", breakoutRep: "acqManager",
    targetKey: "avg_deal", targetType: "rate", higherIsBetter: true,
    compute: (rows) => rows.length ? rows.reduce((s, o) => s + num(o.revenue), 0) / rows.length : 0 },
  pipeline_forecast: { id: "pipeline_forecast", label: "Pipeline (forecast)", dataset: "pipeline", format: "currency", forwardDate: true,
    targetKey: "pipeline_forecast", targetType: "volume", higherIsBetter: true,
    agg: (rows) => rows.reduce((s, o) => s + num(o.forecast), 0) },
  opps_created: { id: "opps_created", label: "Opps Created", dataset: "opps_created", format: "number",
    targetKey: "opps_created", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  appointments: { id: "appointments", label: "Appointments Set", dataset: "appointments", format: "number",
    targetKey: "appointments", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  // Avg ICP of appointments SET, averaged over appts that carry an ICP (blank/unsynced rows excluded so
  // they don't drag it to 0). Breaks out per setter (Created By) via the standard rep-breakout path,
  // team-sectioned on the All view. Reads 0 with a "not synced yet" note until the ICP column propagates.
  avg_icp_per_appt: { id: "avg_icp_per_appt", label: "Avg ICP · Appt Set", dataset: "appointments", format: "decimal", higherIsBetter: true,
    compute: (rows) => { const v = rows.filter((r) => r.icp != null && r.icp !== "" && !isNaN(Number(r.icp))).map((r) => Number(r.icp)); return v.length ? mean(v) : 0; },
    subStat: (rows) => { const n = rows.filter((r) => r.icp != null && r.icp !== "" && !isNaN(Number(r.icp))).length; return n ? `${n.toLocaleString()} scored ${n === 1 ? "appt" : "appts"} · avg ICP` : "ICP column not synced yet"; } },
  opps_to_arip: { id: "opps_to_arip", label: "Opps → ARIP", dataset: "arip_entered", format: "number", higherIsBetter: true, breakoutRep: "acqManager", uniqueTotal: true,
    targetKey: "opps_to_arip", targetType: "volume",
    agg: (rows) => rows.length },
  arip_dealreview: { id: "arip_dealreview", label: "Deals Out of ARIP", dataset: "arip_out", format: "number", higherIsBetter: true, breakoutRep: "acqManager", uniqueTotal: true,
    targetKey: "arip_dealreview", targetType: "volume",
    qualify: (r) => isAripOut(r.newValue), agg: (rows) => rows.length },
  arip_pullthrough: { id: "arip_pullthrough", label: "ARIP Pull-Through", dataset: "arip_out", format: "percent", higherIsBetter: true,
    targetKey: "arip_pullthrough", targetType: "rate",
    compute: (rows) => { if (!rows.length) return 0;
      return rows.filter((r) => isAripOut(r.newValue)).length / rows.length; } },
  rev_out_of_arip: { id: "rev_out_of_arip", label: "Revenue Out of ARIP", dataset: "arip_out", format: "currency", higherIsBetter: true,
    targetKey: "rev_out_of_arip", targetType: "revenue", breakoutRep: "acqManager",
    qualify: (r) => isAripOut(r.newValue),
    agg: (rows) => rows.reduce((s, r) => s + num(r.projNet), 0) },
  // Forecasted revenue that MOVED INTO a stage in the window, dated by Edit Date (the stage-change event).
  // Source: Opportunity Stage History (transactions wb) — qualify to the target New Value, then dedupeLatest
  // by Opportunity ID so an opp that re-enters the stage counts once at its latest entry, and sum the opp's
  // current Total Forecasted Revenue. Transactions tab only (txOnly).
  rev_to_buyer_arip: { id: "rev_to_buyer_arip", label: "Forecasted Rev → Buyer ARIP", dataset: "stage_history", format: "currency", higherIsBetter: true, txOnly: true, breakoutRep: "acqManager",
    targetKey: "rev_to_buyer_arip", targetType: "revenue",
    qualify: (r) => String(r.newValue ?? "").trim() === "Buyer ARIP",
    agg: (rows) => dedupeLatest(rows, "id", "date").reduce((s, r) => s + num(r.forecast), 0),
    subStat: (rows) => { const dd = dedupeLatest(rows.filter((r) => String(r.newValue ?? "").trim() === "Buyer ARIP"), "id", "date"); const imp = dd.filter((r) => r.__imputed).length; return `${dd.length.toLocaleString()} ${dd.length === 1 ? "opp" : "opps"} moved in${imp ? ` · ${imp} skipped via UC` : ""}`; } },
  rev_to_under_contract: { id: "rev_to_under_contract", label: "Forecasted Rev → Under Contract", dataset: "stage_history", format: "currency", higherIsBetter: true, txOnly: true, breakoutRep: "acqManager",
    targetKey: "rev_to_under_contract", targetType: "revenue",
    qualify: (r) => String(r.newValue ?? "").trim() === "Under Contract",
    agg: (rows) => dedupeLatest(rows, "id", "date").reduce((s, r) => s + num(r.forecast), 0),
    subStat: (rows) => { const n = dedupeLatest(rows.filter((r) => String(r.newValue ?? "").trim() === "Under Contract"), "id", "date").length; return `${n.toLocaleString()} ${n === 1 ? "opp" : "opps"} moved in · latest entry per opp`; } },
  contracts_sent: { id: "contracts_sent", label: "Contracts Sent", dataset: "contracts_sent", format: "number", higherIsBetter: true, vpOnly: true,
    targetKey: "contracts_sent", targetType: "volume", qualify: (r) => String(r.subject).trim().toLowerCase() === "contract sent", agg: (rows) => rows.length },
  appts_attended: { id: "appts_attended", label: "Appts Attended", dataset: "appointments_attended", format: "number", higherIsBetter: true, amFuOnly: true,
    targetKey: "appts_attended", targetType: "volume",
    qualify: (r) => !r.lpAssigned && apptAttended(r.outcome), agg: (rows) => rows.length },
  show_rate: { id: "show_rate", label: "Show Rate", dataset: "appointments_attended", format: "percent", higherIsBetter: true, amFuOnly: true, targetKey: "show_rate", targetType: "rate",
    subStat: () => "Met ÷ scheduled · excl. cancelled&rescheduled & Listing-Partner appts",
    compute: (rows) => { const core = rows.filter((x) => !x.lpAssigned);
      const denom = core.filter((x) => !apptExcluded(x.outcome));
      if (!denom.length) return 0; return denom.filter((x) => apptAttended(x.outcome)).length / denom.length; } },
  leads: { id: "leads", label: "Leads", dataset: "leads", format: "number", domain: "marketing",
    targetKey: "leads", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  leads_call_center: { id: "leads_call_center", label: "Call Center", dataset: "leads", format: "number", domain: "marketing", targetKey: "leads_call_center", targetType: "volume", higherIsBetter: true,
    qualify: (r) => r.source === "Call Center", agg: (rows) => rows.length },
  leads_texting: { id: "leads_texting", label: "Texting", dataset: "leads", format: "number", domain: "marketing", targetKey: "leads_texting", targetType: "volume", higherIsBetter: true,
    qualify: (r) => r.source === "Text Message Campaign", agg: (rows) => rows.length },
  leads_website: { id: "leads_website", label: "Website", dataset: "leads", format: "number", domain: "marketing", targetKey: "leads_website", targetType: "volume", higherIsBetter: true,
    qualify: (r) => r.source === "Website", agg: (rows) => rows.length },
  leads_direct_mail: { id: "leads_direct_mail", label: "Direct Mail", dataset: "leads", format: "number", domain: "marketing", targetKey: "leads_direct_mail", targetType: "volume", higherIsBetter: true,
    qualify: (r) => r.source === "Direct Mail Campaign", agg: (rows) => rows.length },
  leads_ppl: { id: "leads_ppl", label: "PPL", dataset: "leads", format: "number", domain: "marketing", targetKey: "leads_ppl", targetType: "volume", higherIsBetter: true,
    qualify: (r) => r.source === "Pay Per Lead", agg: (rows) => rows.length },
  reactivated_leads: { id: "reactivated_leads", label: "Reactivated Leads", dataset: "reactivated", format: "number", domain: "marketing",
    agg: (rows) => rows.length },
  mkt_opps_created: { id: "mkt_opps_created", label: "Opps Created (sourced)", dataset: "mkt_opps", format: "number", domain: "marketing",
    agg: (rows) => rows.length },
  avg_lead_icp: { id: "avg_lead_icp", label: "Avg Lead ICP", dataset: "leads", format: "decimal", domain: "marketing",
    targetKey: "avg_lead_icp", targetType: "rate", higherIsBetter: true,
    compute: (rows) => rows.length ? rows.reduce((s, r) => s + num(r.icp), 0) / rows.length : 0 },
  leads_claimed: { id: "leads_claimed", label: "Leads Claimed", dataset: "leads_claimed", format: "number", amFuOnly: true,
    targetKey: "leads_claimed", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  leads_deaded: { id: "leads_deaded", label: "Leads Deaded", dataset: "leads_deaded", format: "number", amFuOnly: true,
    targetKey: "leads_deaded", targetType: "volume", higherIsBetter: false, agg: (rows) => rows.length },
  calls: { id: "calls", label: "Calls Logged", dataset: "calls", format: "number",
    targetKey: "calls", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  talk_time: { id: "talk_time", label: "Total Talk Time", dataset: "calls", format: "minutes",
    targetKey: "talk_time", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.reduce((s, r) => s + num(r.durationMin), 0) },
  // Avg talk time PER INBOUND CHANNEL. Headline = avg seconds/call across inbound calls (channel known);
  // the breakout (always shown, not rep-based) is avg per Direct Mail / Pay Per Lead / Website. Honors
  // Team/Rep scope via the dataset's Assigned repField. Dated by the call's Created Date (Created Date Task).
  avg_talk_time_channel: { id: "avg_talk_time_channel", label: "Avg Talk Time · Inbound", dataset: "talk_time_channel", format: "duration", higherIsBetter: true,
    compute: (rows) => { const v = rows.filter((r) => num(r.durationMin) > 0 && inboundChannel(r.source) !== "Other").map((r) => num(r.durationMin)); return v.length ? mean(v) * 60 : 0; },
    customBreakout: (rows) => { const m = {}; rows.forEach((r) => { const n = num(r.durationMin); if (!(n > 0)) return; const c = inboundChannel(r.source); if (c === "Other") return; (m[c] = m[c] || []).push(n); });
      const ORDER = ["Direct Mail", "Pay Per Lead", "Website"];
      return Object.entries(m).map(([label, arr]) => ({ label, value: mean(arr) * 60 })).sort((a, b) => (ORDER.indexOf(a.label) + 1 || 9) - (ORDER.indexOf(b.label) + 1 || 9)); },
    subStat: (rows) => { const n = rows.filter((r) => num(r.durationMin) > 0 && inboundChannel(r.source) !== "Other").length; return n ? `${n.toLocaleString()} inbound ${n === 1 ? "call" : "calls"} · avg per call` : "No inbound calls in scope"; } },
  qcs: { id: "qcs", label: "Total QCs", dataset: "calls", format: "number",
    targetKey: "qcs", targetType: "volume", higherIsBetter: true, qualify: isQC, agg: (rows) => rows.length,
    breakoutBy: (rows) => { const q = rows.filter(isQC); const c = (m) => q.filter((r) => num(r.durationMin) >= m).length; return [{ label: "3+ min", value: c(3) }, { label: "5+ min", value: c(5) }, { label: "10+ min", value: c(10) }]; } },
  opps_assigned: { id: "opps_assigned", label: "Opps Assigned", dataset: "opps_assigned", format: "number", breakoutRep: "createdBy", vpOnly: true,
    targetKey: "opps_assigned", targetType: "volume", higherIsBetter: true, agg: (rows) => rows.length },
  opps_deaded: { id: "opps_deaded", label: "Opps Deaded", dataset: "opps_deaded", format: "number", breakoutRep: "editedBy", vpOnly: true,
    targetKey: "opps_deaded", targetType: "volume", higherIsBetter: false, agg: (rows) => rows.length },
  live_transfers_attempted: { id: "live_transfers_attempted", label: "Live Transfers Attempted", dataset: "live_transfers", format: "number", domain: "marketing",
    targetKey: "live_transfers_attempted", targetType: "volume", higherIsBetter: true, qualify: (r) => { const s = String(r.attempted ?? "").toLowerCase(); return s.includes("attempted") && !s.includes("not attempted"); }, agg: (rows) => rows.length },
  live_transfers_connected: { id: "live_transfers_connected", label: "Live Transfers Connected", dataset: "live_transfers", format: "number", domain: "marketing",
    targetKey: "live_transfers_connected", targetType: "volume", higherIsBetter: true, qualify: (r) => isYes(r.connected), agg: (rows) => rows.length },
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
  if (!base) return null; // 0 / blank Column F -> treat as "no target set" rather than a $0 target
  return kpi.targetType === "rate" ? base : base * businessMonthsInRange(range.start, range.end);
}
function computeKpi(kpi, store, dir, org, range, targetRange) {
  const ds = DATASETS[kpi.dataset];
  const peopleFilter = org.department !== "All" || org.team !== "All" || org.role !== "All" || org.rep !== "All";
  if (!(ds.repField || ds.repFields) && peopleFilter && kpi.domain !== "marketing" && !ds.companyScope)
    return { value: null, target: null, progress: null, variance: null, status: "none", rows: [], unattributable: true };
  const filtered = applyFilters(store[kpi.dataset] || [], kpi.rawRows && ds.dedupeInPeriod ? { ...ds, dedupeInPeriod: null } : ds, org, range, dir);
  const value = kpi.compute ? kpi.compute(filtered) : kpi.agg(kpi.qualify ? filtered.filter(kpi.qualify) : filtered);
  const target = kpi.targetKey ? resolveTarget(kpi, store, org, targetRange || range) : null;
  let progress = null, variance = null, status = "none";
  if (target != null && target !== 0) {
    progress = value / target; variance = kpi.higherIsBetter ? value / target - 1 : target / value - 1;
    status = (kpi.higherIsBetter ? progress >= 1 : value <= target) ? "good"
      : (kpi.higherIsBetter ? progress >= 0.85 : value <= target * 1.15) ? "warn" : "bad";
  }
  let subtitle = kpi.subStat ? kpi.subStat(filtered, ds) : null;
  if (kpi.uniqueTotal && ds.dedupeInPeriod) {
    const cnt = (rs) => (kpi.qualify ? rs.filter(kpi.qualify) : rs).length;
    const totalN = cnt(applyFilters(store[kpi.dataset] || [], { ...ds, dedupeInPeriod: null }, org, range, dir));
    const uniqN = cnt(applyFilters(store[kpi.dataset] || [], ds, org, range, dir));
    subtitle = `${uniqN.toLocaleString()} unique · ${totalN.toLocaleString()} total`;
  }
  return { value, target, progress, variance, status, rows: filtered, subtitle, companyWide: !!(ds.companyScope && peopleFilter) };
}
const fmt = (v, f) => { if (v == null || isNaN(v)) return "—";
  if (f === "currency") return (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString();
  if (f === "percent") return (v * 100).toFixed(1) + "%";
  if (f === "minutes") return Math.round(v).toLocaleString() + " min";
  if (f === "duration") return fmtDur(v);
  if (f === "decimal") return (Math.round(v * 10) / 10).toFixed(1); return Math.round(v).toLocaleString(); };
// Animated count-up for headline numbers. Interpolates the raw value and passes through fmt(), so
// currency/percent/minutes all animate correctly. Respects prefers-reduced-motion and lands exactly
// on the final value (so a PDF captured after load shows the real number).
function useCountUp(value) {
  const [disp, setDisp] = useState(0);
  const prev = React.useRef(null);
  useEffect(() => {
    if (value == null || isNaN(value)) { setDisp(value); prev.current = value; return; }
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = (prev.current == null || isNaN(prev.current)) ? 0 : prev.current;
    prev.current = value;
    if (reduce || from === value) { setDisp(value); return; }
    const dur = 600, t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    let raf;
    const tick = (t) => { const p = Math.min(1, (t - t0) / dur); const eased = 1 - Math.pow(1 - p, 3);
      setDisp(from + (value - from) * eased); if (p < 1) raf = requestAnimationFrame(tick); else setDisp(value); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return disp;
}
function CountNum({ value, format }) { return <>{fmt(useCountUp(value), format)}</>; }
// Subtle per-column heatmap: shades a cell background with the accent color at an alpha proportional
// to value ÷ column-max (invert for lower-is-better columns). Returns undefined below a floor so
// near-zero cells stay clean. 8-digit hex alpha prints fine.
function heatBg(v, max, invert) {
  if (v == null || !max || max <= 0) return undefined;
  let r = Math.max(0, Math.min(1, v / max)); if (invert) r = 1 - r;
  const alpha = Math.round(r * 42); if (alpha <= 3) return undefined;
  return { background: `${T.accent}${alpha.toString(16).padStart(2, "0")}` };
}
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
const median = (arr) => { const s = arr.filter((n) => n > 0).sort((a, b) => a - b); if (!s.length) return 0; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function MoneyBars({ items, tint, fmtVal }) {
  const max = Math.max(1, ...items.map((o) => o.value));
  return (<div className="flex flex-col gap-2">{items.map((o) => (
    <div key={o.label} className="flex items-center gap-3">
      <div className="text-[12px] shrink-0" style={{ width: 150, color: T.sub }}>{o.label}</div>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${Math.round((o.value / max) * 100)}%`, height: "100%", background: tint || T.accent }} /></div>
      <div className="text-[12px] text-right shrink-0" style={{ width: 96, fontVariantNumeric: "tabular-nums", color: T.ink }}>{fmtVal ? fmtVal(o.value) : o.value.toLocaleString()}</div>
    </div>))}</div>);
}
function SegPctBars({ data, noun }) {
  return (<>
    <div className="flex flex-col gap-3 pt-1">
      {data.items.map((x, i) => (
        <div key={x.label} className="flex items-center gap-3">
          <div className="text-[14px] shrink-0" style={{ width: 104, color: T.ink }}>{x.label}</div>
          <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${Math.round(x.pct * 100)}%`, height: "100%", background: T.chart[i % T.chart.length] }} /></div>
          <div className="text-[15px] font-semibold text-right shrink-0" style={{ width: 108, fontVariantNumeric: "tabular-nums", color: T.ink }}>{(x.pct * 100).toFixed(0)}% <span className="text-[12px] font-normal" style={{ color: T.faint }}>({x.value})</span></div>
        </div>))}
    </div>
    <div className="text-[11px] mt-3" style={{ color: T.faint }}>% across Core / Secondary / Exploratory (segmented {noun} only). <b>{data.blank}</b> of {data.total} {noun} are unsegmented and excluded from the %.</div>
  </>);
}
function orgOptions(dir, org) {
  const people = dir.people || [];
  if (!people.length) return dir.options;
  const uniq = (arr, f) => [...new Set(arr.map(f).filter(Boolean))].sort();
  const match = (p, keys) => keys.every((k) => k === "team" ? teamMatches(p, org.team) : (org[k] === "All" || p[k] === org[k]));
  const teamPool = people.filter((p) => match(p, ["company", "department"]));
  const teams = uniq(teamPool, (p) => p.team);
  if (teamPool.some((p) => isAmFuRole(p.role))) teams.push(TEAM_AMFU); // role-union option, listed after real teams
  return {
    company: uniq(people, (p) => p.company),
    department: uniq(people.filter((p) => match(p, ["company"])), (p) => p.department),
    team: teams,
    role: uniq(people.filter((p) => match(p, ["company", "department", "team"])), (p) => p.role),
    rep: uniq(people.filter((p) => match(p, ["company", "department", "team", "role"])), (p) => p.rep),
  };
}
function ViewToggle({ view, setView }) {
  const tabs = [["sales", "Sales"], ["marketing", "Marketing"], ["transactions", "Transactions"], ["speedtolead", "Speed to Lead"]];
  return (<div className="flex overflow-x-auto rounded-lg p-0.5 mb-4" style={{ background: T.track, border: `1px solid ${T.border}`, scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
    {tabs.map(([v, l]) => (
      <button key={v} onClick={() => setView(v)} className="text-[13px] font-medium px-3 sm:px-3.5 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0"
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
function FilterBar({ org, setOrg, date, setDate, dir, view }) {
  const CHAIN = ["company", "team", "rep"];
  const set = (k) => (v) => { const next = { ...org, [k]: v };
    for (let i = CHAIN.indexOf(k) + 1; i < CHAIN.length; i++) next[CHAIN[i]] = "All"; setOrg(next); };
  const opts = orgOptions(dir, org);
  const showRepFilters = viewUsesRepFilter(view); // Team/Rep are inert in those views
  const [open, setOpen] = useState(false); // mobile-only: filters collapsed by default to free screen
  const periodLabel = (DATE_PRESETS.find(([v]) => v === date.preset) || [null, date.preset])[1];
  const scopeLabel = !showRepFilters ? "Company" : org.rep !== "All" ? org.rep : org.team !== "All" ? org.team : "All reps";
  return (<div className="rounded-xl p-3 sm:p-4 mb-4 sm:mb-5" style={{ background: T.card, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
    <button onClick={() => setOpen((o) => !o)} className="sm:hidden w-full flex items-center justify-between">
      <span className="text-[13px]" style={{ color: T.sub }}>Filters · <span style={{ color: T.ink, fontWeight: 600 }}>{scopeLabel} · {periodLabel}</span></span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}><path d="M6 9l6 6 6-6" stroke={T.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    <div className={`${open ? "flex" : "hidden"} sm:flex flex-wrap gap-3 items-end mt-3 sm:mt-0`}>
      {showRepFilters && <Select label="Team" value={org.team} onChange={set("team")} options={opts.team} />}
      {showRepFilters && <Select label="Rep" value={org.rep} onChange={set("rep")} options={opts.rep} />}
      {showRepFilters && <div className="w-px self-stretch mx-1 hidden sm:block" style={{ background: T.border }} />}
      <label className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>Period</span>
        <select value={date.preset} onChange={(e) => setDate({ ...date, preset: e.target.value })} className="text-sm rounded-md px-2.5 py-1.5 outline-none"
          style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>{DATE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {date.preset === "custom" && (<>
        <label className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>From</span>
          <input type="date" value={date.start} onChange={(e) => setDate({ ...date, start: e.target.value })} className="text-sm rounded-md px-2.5 py-1.5 outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, background: T.card, colorScheme: T === THEMES.dark ? "dark" : "light" }} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>To</span>
          <input type="date" value={date.end} onChange={(e) => setDate({ ...date, end: e.target.value })} className="text-sm rounded-md px-2.5 py-1.5 outline-none" style={{ border: `1px solid ${T.border}`, color: T.ink, background: T.card, colorScheme: T === THEMES.dark ? "dark" : "light" }} /></label></>)}
    </div></div>);
}
// Sparkline — deliberately literal + dramatic. Y is scaled to the data's OWN min..max (not anchored at 0),
// with a little headroom, so real month-to-month swings read at full amplitude instead of a flat squiggle.
// A gradient area sits under a thick line; every data point gets a marker and the latest point is emphasized.
// Rendered with a uniform (meet) viewBox sized to the point count so the markers stay perfectly round.
function Sparkline({ data, color }) {
  const gid = useMemo(() => "spark_" + Math.random().toString(36).slice(2, 9), []);
  if (!data || data.length < 2) return null;
  const c = color || T.accent;
  const vals = data.map((d) => d.value);
  let max = Math.max(...vals), min = Math.min(...vals);
  if (max === min) { max += 1; min -= 1; }                 // dead-flat series → gentle centered line
  const pad = (max - min) * 0.14; max += pad; min -= pad;  // headroom so peaks/troughs don't clip the markers
  const span = max - min;
  const n = data.length, W = Math.max(60, (n - 1) * 22), H = 44, mY = 5;
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - mY - ((v - min) / span) * (H - mY * 2);
  const pts = data.map((d, i) => [x(i), y(d.value)]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const last = pts[n - 1];
  return (<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: H, display: "block", overflow: "visible" }}>
    <defs>
      <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={c} stopOpacity="0.36" />
        <stop offset="100%" stopColor={c} stopOpacity="0" />
      </linearGradient>
    </defs>
    <polyline points={`0,${H} ${line} ${W},${H}`} fill={`url(#${gid})`} stroke="none" />
    <polyline points={line} fill="none" stroke={c} strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    {pts.map((p, i) => i < n - 1 && <circle key={i} cx={p[0]} cy={p[1]} r="1.6" fill={T.card} stroke={c} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />)}
    <circle cx={last[0]} cy={last[1]} r="3.2" fill={c} stroke={T.card} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
  </svg>);
}
function KpiCard({ kpi, result, breakout, spark, big }) {
  const color = result.status === "good" ? T.good : result.status === "warn" ? T.warn : result.status === "bad" ? T.bad : T.faint;
  const pct = result.progress == null ? null : Math.min(1, Math.max(0, result.progress));
  const sections = breakout && breakout.sections ? breakout.sections : null;
  const items = !sections && breakout && breakout.items ? breakout.items : null;
  const custom = !!(breakout && breakout.custom);
  const bmax = items && items.length ? Math.max(...items.map((b) => b.value)) : 0;
  // one shared bar scale across every section's items, so bars are comparable card-wide
  const smax = sections ? Math.max(1, ...sections.flatMap((s) => s.items.map((b) => b.value))) : 0;
  const showSpark = spark && !custom && !sections;
  const live = !!(DATASETS[kpi.dataset] && DATASETS[kpi.dataset].dateField);
  const lower = kpi.higherIsBetter === false;
  const labelCls = big ? "text-[15px]" : "text-[13px]";
  const numCls = big ? D.numBig : D.num;
  const secBar = (b) => {
    const width = smax ? Math.round((b.value / smax) * 100) : 0;
    return (<div key={b.label} className="flex items-center gap-2">
      <span className="text-[11px] shrink-0 truncate" style={{ width: 96, color: T.sub }} title={b.label}>{b.label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${width}%`, height: "100%", background: T.accent }} /></div>
      <div className="text-[11px] text-right shrink-0" style={{ width: 74, fontVariantNumeric: "tabular-nums", color: T.ink }}>{fmt(b.value, kpi.format)}</div>
    </div>);
  };
  return (<div className={`rounded-xl ${D.cardPad} flex flex-col gap-3 h-full`} style={{ background: T.card, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`${labelCls} font-medium truncate`} style={{ color: T.sub }}>{kpi.label}</span>
        <span className="text-[8px] font-bold px-1 py-0.5 rounded tracking-wider shrink-0" style={{ color: live ? T.accent : T.faint, background: live ? T.accentSoft : "transparent", border: live ? "none" : `1px solid ${T.border}` }}>{live ? "LIVE" : "SNAPSHOT"}</span>
      </div>
      {result.variance != null && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ color, background: result.status === "good" ? T.accentSoft : "transparent" }}>{result.variance >= 0 ? "+" : ""}{(result.variance * 100).toFixed(0)}%</span>}</div>
    {result.unattributable
      ? (<><div className={`${numCls} font-bold leading-none tracking-tight`} style={{ color: T.faint }}>n/a</div>
          <span className="text-[11px]" style={{ color: T.faint }}>Not tracked per rep in this data</span></>)
      : (<><div className={`${numCls} font-bold leading-none tracking-tight`} style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}><CountNum value={result.value} format={kpi.format} /></div>
    {result.subtitle && <span className="text-[12px] font-medium" style={{ color: T.sub, marginTop: -1 }}>{result.subtitle}</span>}
    {result.target != null ? (<div className="flex flex-col gap-1.5">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: T.track }}><div className="h-full rounded-full" style={{ width: `${(pct || 0) * 100}%`, background: color }} /></div>
      <span className="text-[11px]" style={{ color: T.faint }}>{result.progress != null ? `${(result.progress * 100).toFixed(0)}% of ` : ""}{fmt(result.target, kpi.format)} target</span></div>)
      : result.companyWide ? <span className="text-[11px]" style={{ color: T.faint }}>Company-wide · no rep split</span>
      : <span className="text-[11px]" style={{ color: T.faint }}>No target set</span>}
    {showSpark && <div className="pt-1"><Sparkline data={spark} color={result.status === "bad" ? T.bad : T.accent} /></div>}
    {sections && sections.length > 0 && (<div className="flex flex-col gap-3 pt-2 mt-1" style={{ borderTop: `1px solid ${T.border}` }}>
      {sections.map((sec) => (
        <div key={sec.label} className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase" style={{ color: T.faint, letterSpacing: "0.06em" }}>{sec.label}</span>
          {sec.items.map(secBar)}
        </div>))}
      {breakout && breakout.overlapNote && <div className="text-[10px] leading-snug" style={{ color: T.faint }}>Each deal is credited to everyone who touched it (owner/VP, AM &amp; follow-up), so sections overlap and don't sum to the headline.</div>}
    </div>)}
    {items && items.length > 0 && (<div className="flex flex-col gap-2 pt-2 mt-1" style={{ borderTop: `1px solid ${T.border}` }}>
      {items.slice(0, 12).map((b) => {
        const hasT = !custom && b.target != null && b.target > 0;
        const hit = hasT ? (lower ? b.value <= b.target : b.value >= b.target) : null;
        const barColor = hasT ? (hit ? T.good : T.bad) : T.accent;
        const width = hasT ? Math.min(100, Math.round((b.value / b.target) * 100)) : (bmax ? Math.round((b.value / bmax) * 100) : 0);
        return (<div key={b.label} className="flex items-center gap-2">
          <span className="text-[11px] shrink-0 truncate" style={{ width: 84, color: T.sub }} title={b.label}>{b.label}</span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${width}%`, height: "100%", background: barColor }} /></div>
          <div className="text-right shrink-0" style={{ width: 74 }}>
            <div className="text-[11px] leading-tight" style={{ fontVariantNumeric: "tabular-nums", color: T.ink }}>{fmt(b.value, kpi.format)}</div>
            {hasT && <div className="text-[9px] leading-none" style={{ color: T.faint }}>/ {fmt(b.target, kpi.format)}</div>}
          </div>
        </div>);
      })}
    </div>)}</>)}</div>);
}
function Panel({ title, children, collapsible }) {
  const [open, setOpen] = useState(true); // default expanded — a PDF export always captures full content
  if (!collapsible) return (<div className="rounded-xl p-4" style={{ background: T.card, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
    <h3 className="text-[13px] font-semibold mb-3" style={{ color: T.sub }}>{title}</h3>{children}</div>);
  return (<div className="rounded-xl p-4" style={{ background: T.card, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
    <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between" style={{ cursor: "pointer" }}>
      <h3 className="text-[13px] font-semibold" style={{ color: T.sub }}>{title}</h3>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }}><path d="M6 9l6 6 6-6" stroke={T.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <div className="mt-3">{children}</div>}</div>);
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
      <li>Ten workbooks are wired: Opportunities (Pt 1 &amp; 2), Pipeline, Activities (appointments), Marketing (lead volume), Leads (per-rep claims), Tasks (calls), Transactions, Speed to Lead, and Context (directory). Date filtering is active on every dataset that carries a date column.</li>
      {freshness && freshness.length > 0 && <li><b>Data current through:</b> {freshness.map((f) => `${f.label} ${fmtD(f.date)}`).join("  ·  ")}. Workbooks sync on different schedules, so very recent windows (Today/Yesterday) can look sparse for a source that hasn't caught up — e.g. calls typically lag a day or two.</li>}
      {mode === "google" && diagnostics.map((d) => <li key={d.dataset} style={{ color: T.warn }}>⧗ {d.dataset}: {d.note}</li>)}
    </ul></div>);
}

const stlHasTime = (v) => /\d\s*:\s*\d/.test(String(v || "")); // true only if a clock time is present
function stlRows(store, range) {
  // normalize + tag scenario, priority, bucket, elapsed; apply period filter on start.
  const out = []; const noTime = {}; // scenario -> count of rows dropped for a date-only start
  (store.speed_to_lead || []).forEach((r) => {
    const scenario = stlScenario(r.tab);
    const startRaw = stlStartRaw(r, scenario);
    // A date-only start (no clock time) can't be placed in a time-of-day bucket or timed accurately
    // (it would anchor to midnight). Drop it and report the count instead of fabricating an elapsed.
    if (!stlHasTime(startRaw)) { noTime[scenario] = (noTime[scenario] || 0) + 1; return; }
    const start = parseDateTime(startRaw), claim = parseDateTime(r.claimed);
    if (!start || !claim) return;
    const elapsed = (claim - start) / 1000; // seconds
    if (elapsed < 0 || elapsed > 30 * 86400) return; // drop negatives + absurd outliers (>30d)
    if (range && (start < range.start || start > range.end)) return; // period filter on START
    out.push({ scenario, priority: stlPriority(r.icp, r.source), bucket: stlBucket(startRaw),
      source: String(r.source || "").trim() || "(unset)", elapsed });
  });
  out.noTime = noTime; // attached for the view to surface
  return out;
}
function stlAgg(rows) { // pooled avg + median across the given rows
  const v = rows.map((r) => r.elapsed).filter((n) => n >= 0);
  return { n: v.length, avg: v.length ? mean(v) : null, med: v.length ? median(v) : null };
}
function StlHero({ title, caption, rows, big, target }) {
  const a = stlAgg(rows);
  const newLeads = big ? stlAgg(rows.filter((r) => /new leads/i.test(String(r.scenario)))) : null; // "New Leads" scenario only
  const hitGoal = target != null && a.med != null ? a.med <= target : null;
  const groupMed = (key, order) => {
    const m = {}; rows.forEach((r) => { const k = r[key] || "(unset)"; (m[k] = m[k] || []).push(r.elapsed); });
    let items = Object.entries(m).map(([label, arr]) => ({ label, value: median(arr), avg: mean(arr), n: arr.length }));
    if (order) items = items.sort((x, y) => order.indexOf(x.label) - order.indexOf(y.label));
    else items = items.sort((x, y) => y.value - x.value); // longest on top
    return items;
  };
  const scen = groupMed("scenario", null), prio = groupMed("priority", ["High", "Low"]), chan = groupMed("source", null);
  const globalMax = Math.max(1, ...[...scen, ...prio, ...chan].map((i) => i.value)); // one scale across the whole hero
  const THIN = 3; // fewer than this many leads = not enough to trust
  const Row = ({ label, value, avg, n }) => {
    const thin = n < THIN;
    return (<div className="flex items-center gap-3" style={{ opacity: thin ? 0.45 : 1 }}>
      <div className="text-[12px] shrink-0 truncate" style={{ width: big ? 168 : 128, color: T.sub }} title={label}>{label} <span style={{ color: T.faint }}>({plural(n, "lead")})</span></div>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${Math.round((value / globalMax) * 100)}%`, height: "100%", background: thin ? T.faint : T.accent }} /></div>
      <div className="text-right shrink-0" style={{ width: 86, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        <div className="text-[12px]" style={{ fontVariantNumeric: "tabular-nums", color: T.ink }}>{fmtDur(value)}</div>
        <div className="text-[10px] leading-none" style={{ color: T.faint }}>avg {fmtDur(avg)}</div>
      </div>
    </div>);
  };
  const Section = ({ label, items }) => (
    <div><div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: T.faint }}>{label}</div>
      <div className="flex flex-col gap-1.5">{items.map((i) => <Row key={i.label} {...i} />)}</div></div>);
  return (
    <div className="rounded-xl p-5 flex flex-col gap-3" style={{ background: T.card, border: `1px solid ${T.border}` }}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium" style={{ color: T.sub }}>{title}</span>
        <span className="text-[8px] font-bold px-1 py-0.5 rounded tracking-wider" style={{ color: T.accent, background: T.accentSoft }}>LIVE</span>
      </div>
      <div className="flex items-end gap-3 flex-wrap">
        <div className="font-bold leading-none tracking-tight" style={{ fontSize: big ? 64 : 34, color: hitGoal == null ? T.ink : hitGoal ? T.good : T.bad, fontVariantNumeric: "tabular-nums" }}>{fmtDur(a.med)}</div>
        {newLeads && newLeads.n > 0 && (<div className="text-[13px] pb-1" style={{ color: T.sub }}>New Leads <span className="font-semibold" style={{ color: T.ink, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{fmtDur(newLeads.med)}</span> <span style={{ color: T.faint }}>· {plural(newLeads.n, "lead")} · median</span></div>)}
      </div>
      <div className="text-[11px]" style={{ color: T.faint }}>{caption}</div>
      <div className="text-[11px]" style={{ color: T.faint }}>median · avg {fmtDur(a.avg)} · {plural(a.n, "lead")}</div>
      {target != null && (<div className="text-[11px] font-medium" style={{ color: hitGoal ? T.good : T.bad }}>Goal ≤ {fmtDur(target)} · {a.med == null ? "—" : hitGoal ? "on track" : `over by ${fmtDur(a.med - target)}`}</div>)}
      {big && a.n > 0 && (<div className="flex flex-col gap-5 pt-3 mt-1" style={{ borderTop: `1px solid ${T.border}` }}>
        <Section label="By scenario" items={scen} />
        <Section label="By priority" items={prio} />
        <Section label="By channel" items={chan} />
        <div className="text-[10px]" style={{ color: T.faint }}>Bars show median time-to-claim (average beneath each), scaled to one shared axis. Greyed rows have fewer than {THIN} leads — too few to read into.</div>
      </div>)}
    </div>);
}
function SpeedToLeadView({ store, range, dir }) {
  const rows = useMemo(() => stlRows(store, range), [store, range]);
  const stlGoal = useMemo(() => { const t = (store.targets || []).find((x) => x.kpiId === "speed_to_lead" && x.scope === "Company"); const v = t ? num(t.value) : 0; return v > 0 ? v * 60 : null; }, [store]); // sheet value is minutes → seconds
  const b = (name) => rows.filter((r) => r.bucket === name);
  const noTime = rows.noTime || {};
  const noTimeMsg = Object.entries(noTime).filter(([, n]) => n > 0).map(([s, n]) => `${s} (${n})`).join(", ");
  // Avg talk time per inbound channel — company-wide (SToL hides Team/Rep), dated by the call's Created Date.
  const talk = useMemo(() => computeKpi(KPIS.avg_talk_time_channel, store, dir, ALL_ORG, range, range), [store, dir, range]);
  const talkBreak = useMemo(() => { const it = KPIS.avg_talk_time_channel.customBreakout(talk.rows || []).filter((x) => x.value > 0); return it.length ? { items: it, custom: true } : null; }, [talk]);
  return (
    <div className="flex flex-col gap-5">
      {noTimeMsg && (<div className="rounded-xl p-3 text-[12px]" style={{ background: T.warnSoft, border: `1px solid ${T.warn}33`, color: T.ink }}>
        <b style={{ color: T.warn }}>Excluded — no claim clock:</b> {noTimeMsg}. These scenarios have a date-only start timestamp in the sync (no time of day), so response time can't be measured. Add a time component to that column's Salesforce/Coefficient export to enable them.</div>)}
      <StlHero big target={stlGoal} title="Speed to Lead — Accountable Window" caption="Median time from lead in → claimed · weekdays 10am–7pm, the scored window" rows={b("primary")} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StlHero title="Blended" caption="All leads, all windows & channels — context, not scored" rows={rows} />
        <StlHero title="Out of Window" caption="Weekdays outside 10am–7pm — context, not scored" rows={b("outwindow")} />
        <StlHero title="Weekend" caption="Saturday & Sunday — context, not scored" rows={b("weekend")} />
      </div>
      <div>
        <SubHead label="Inbound talk time" note="avg call duration by channel · dated by the call's Created Date · company-wide" />
        <div className="mt-3" style={{ maxWidth: 460 }}>
          <KpiCard kpi={KPIS.avg_talk_time_channel} result={talk} breakout={talkBreak} spark={null} />
        </div>
      </div>
    </div>);
}

const CARD_TIERS = {
  lagging: ["closed_revenue", "deals_closed", "avg_deal", "pipeline_forecast", "arip_dealreview", "rev_out_of_arip"],
  leading: ["opps_to_arip", "opps_created", "leads_claimed", "leads_deaded", "appointments", "appts_attended", "show_rate", "avg_icp_per_appt", "contracts_sent", "opps_assigned", "opps_deaded", "calls", "talk_time", "qcs"],
};
// The two "revenue moved into stage" tiles on the Transactions tab. Rendered in their own strip with the
// record-type toggles (front-end / back-end) that filter only these two, and fed skip-imputed Buyer ARIP rows.
const TX_FLOW_TILES = ["rev_to_buyer_arip", "rev_to_under_contract"];
const isFrontEndRT = (r) => /front.?end/i.test(String(r.recordType ?? ""));
const isBackEndRT = (r) => /back.?end/i.test(String(r.recordType ?? ""));
function CardGrid({ ids, results, breakouts, sparks, big }) {
  const min = big ? D.minBig : D.min;
  return <div className="grid" style={{ gap: D.gridGap, gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}>{ids.map((id) => <KpiCard key={id} kpi={KPIS[id]} result={results[id]} breakout={breakouts[id]} spark={sparks[id]} big={big} />)}</div>;
}
function SubHead({ label, note }) {
  return (<div className="flex items-baseline gap-2 mt-1">
    <span className="text-[11px] font-semibold uppercase" style={{ color: T.faint, letterSpacing: "0.08em" }}>{label}</span>
    <span className="text-[11px]" style={{ color: T.faint, opacity: 0.65 }}>{note}</span>
  </div>);
}
// At-a-glance strip: a few headline numbers with a trailing-12mo trend arrow, above the full grid.
// Print-safe (static). items: [{ label, value, format, trend: 1 | -1 | 0 | null }].
function SummaryStrip({ items }) {
  return (<div className="rounded-xl p-4 flex flex-wrap gap-x-8 gap-y-4" style={{ background: T.card, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
    {items.map((it) => (
      <div key={it.label} className="flex flex-col gap-1" style={{ minWidth: 128 }}>
        <span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint, letterSpacing: "0.06em" }}>{it.label}</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[28px] font-bold leading-none tracking-tight" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}><CountNum value={it.value} format={it.format} /></span>
          {it.trend != null && it.trend !== 0 && <span className="text-[13px] font-semibold" style={{ color: it.trend > 0 ? T.good : T.bad }} title="vs. previous month">{it.trend > 0 ? "▲" : "▼"}</span>}
        </div>
      </div>))}
  </div>);
}
// Small-multiples: one tight sparkline per key metric for the selected rep. Shown only on single-rep scope.
function RepTrendStrip({ ids, sparks, results }) {
  const items = ids.map((id) => ({ id, kpi: KPIS[id], series: sparks[id], val: results[id] && results[id].value }))
    .filter((x) => x.kpi && x.series && x.series.length >= 2);
  if (!items.length) return null;
  return (<Panel collapsible title="Rep trends · trailing 12 months">
    <div className="grid gap-x-6 gap-y-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
      {items.map(({ id, kpi, series, val }) => (
        <div key={id} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] truncate" style={{ color: T.sub }} title={kpi.label}>{kpi.label}</span>
            <span className="text-[13px] font-semibold shrink-0" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{fmt(val, kpi.format)}</span>
          </div>
          <Sparkline data={series} />
        </div>))}
    </div>
  </Panel>);
}
// Role-aware appointment stats. Setter axis = "Created By"; attendee axis = "Assigned".
// scored = has a real outcome; met = attended (appointment met, not no-show/missed).
function apptStats(store, dir, range) {
  // Attended + Show Rate run off Start date. scored = show-rate denominator (excl. cancelled/rescheduled); met = attended (Met only).
  // LP-routed appts (Assigned = Listing Partner) go to their own bucket L, kept out of the AM/FU (setter) and VP (attendee) axes.
  const rows = applyFilters(store.appointments_attended || [], DATASETS.appointments_attended, ALL_ORG, range, dir);
  const key = (v) => String(v ?? "").trim();
  const scored = (o) => !apptExcluded(o.outcome);
  const met = (o) => apptAttended(o.outcome);
  const S = {}, A = {}, L = {};
  rows.forEach((o) => {
    const setter = key(o.createdBy), att = key(o.rep), sc = scored(o), mt = met(o);
    if (o.lpAssigned) {
      if (att) { const e = L[att] = L[att] || { rep: att, total: 0, scored: 0, met: 0, by: {} }; e.total++; if (sc) e.scored++; if (mt) e.met++;
        if (setter) { const b = e.by[setter] = e.by[setter] || { label: setter, total: 0, scored: 0, met: 0 }; b.total++; if (sc) b.scored++; if (mt) b.met++; } }
      return;
    }
    if (setter) { const e = S[setter] = S[setter] || { rep: setter, total: 0, scored: 0, met: 0, by: {} }; e.total++; if (sc) e.scored++; if (mt) e.met++;
      if (att) { const b = e.by[att] = e.by[att] || { label: att, total: 0, scored: 0, met: 0 }; b.total++; if (sc) b.scored++; if (mt) b.met++; } }
    if (att) { const e = A[att] = A[att] || { rep: att, total: 0, scored: 0, met: 0, by: {} }; e.total++; if (sc) e.scored++; if (mt) e.met++;
      if (setter) { const b = e.by[setter] = e.by[setter] || { label: setter, total: 0, scored: 0, met: 0 }; b.total++; if (sc) b.scored++; if (mt) b.met++; } }
  });
  return { S, A, L, rows };
}
function ApptCard({ title, bigText, caption, items, kind }) {
  const max = kind === "count" ? Math.max(1, ...items.map((i) => i.value)) : 1;
  return (<div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: T.card, border: `1px solid ${T.border}` }}>
    <div className="flex items-center gap-1.5">
      <span className="text-[13px] font-medium truncate" style={{ color: T.sub }}>{title}</span>
      <span className="text-[8px] font-bold px-1 py-0.5 rounded tracking-wider shrink-0" style={{ color: T.accent, background: T.accentSoft }}>LIVE</span>
    </div>
    <div className="text-[34px] font-bold leading-none tracking-tight" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{bigText}</div>
    <span className="text-[11px]" style={{ color: T.faint }}>{caption}</span>
    {items.length > 0 ? (<div className="flex flex-col gap-2 pt-2 mt-1" style={{ borderTop: `1px solid ${T.border}` }}>
      {items.slice(0, 8).map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span className="text-[11px] shrink-0 truncate" style={{ width: 96, color: T.sub }} title={it.label}>{it.label}</span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${kind === "count" ? Math.round((it.value / max) * 100) : Math.round((it.pct || 0) * 100)}%`, height: "100%", background: T.accent }} /></div>
          <div className="text-[11px] text-right shrink-0" style={{ width: 52, fontVariantNumeric: "tabular-nums", color: T.ink }}>{kind === "count" ? it.value.toLocaleString() : (it.pct == null ? "—" : (it.pct * 100).toFixed(0) + "%")}</div>
        </div>))}
    </div>) : <span className="text-[11px]" style={{ color: T.faint }}>No appointments in scope</span>}
  </div>);
}
// Canonical appointment-outcome order + colors for the breakout donuts.
function outcomeMeta() {
  return [
    ["Appointment Met", T.accent],
    ["(blank)", "#64748b"],
    ["No Show", "#f87171"],
    ["Appointment Missed", "#ef4444"],
    ["Attended, No Show", "#fb923c"],
    ["Rescheduled", "#fbbf24"],
    ["Cancelled", "#94a3b8"],
  ];
}
function tallyOutcomes(rows) { const m = {}; rows.forEach((r) => { const o = String(r.outcome || "").trim() || "(blank)"; m[o] = (m[o] || 0) + 1; }); return m; }
function Donut({ data, size = 116, thickness = 15 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2, C = 2 * Math.PI * r; let off = 0;
  return (<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.track} strokeWidth={thickness} />
    <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
      {total > 0 && data.filter((d) => d.value > 0).map((d, i) => { const len = (d.value / total) * C;
        const seg = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={thickness} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} strokeLinecap="butt" />;
        off += len; return seg; })}
    </g>
    <text x="50%" y="47%" textAnchor="middle" dominantBaseline="central" style={{ fill: T.ink, fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{total.toLocaleString()}</text>
    <text x="50%" y="63%" textAnchor="middle" dominantBaseline="central" style={{ fill: T.faint, fontSize: 9, letterSpacing: "0.06em" }}>APPTS</text>
  </svg>);
}
function OutcomeDonutCard({ title, tally, big }) {
  const meta = outcomeMeta();
  const data = meta.map(([label, color]) => ({ label, color, value: tally[label] || 0 }));
  const total = data.reduce((s, d) => s + d.value, 0);
  const present = data.filter((d) => d.value > 0);
  return (<div className="rounded-xl p-4" style={{ background: T.card, border: `1px solid ${T.border}` }}>
    <div className="flex items-center gap-1.5 mb-3">
      <span className={`${big ? "text-[14px]" : "text-[13px]"} font-medium truncate`} style={{ color: T.sub }}>{title}</span>
      <span className="text-[8px] font-bold px-1 py-0.5 rounded tracking-wider shrink-0" style={{ color: T.accent, background: T.accentSoft }}>LIVE</span>
    </div>
    {total > 0 ? (<div className="flex items-center gap-4">
      <Donut data={data} size={big ? 132 : 112} thickness={big ? 17 : 14} />
      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
        {present.map((d) => (<div key={d.label} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
          <span className="text-[11px] truncate flex-1" style={{ color: T.sub }} title={d.label}>{d.label}</span>
          <span className="text-[11px] tabular-nums shrink-0" style={{ color: T.ink }}>{d.value.toLocaleString()}</span>
          <span className="text-[11px] tabular-nums shrink-0 text-right" style={{ width: 40, color: T.faint }}>{(d.value / total * 100).toFixed(0)}%</span>
        </div>))}
      </div>
    </div>) : <span className="text-[11px]" style={{ color: T.faint }}>No appointments in scope</span>}
  </div>);
}
// Horizontal bars of avg ICP per group (appointment type / subject). Bars scale to the group max so
// differences read clearly; each row shows the average (0–7) and the appointment count.
function AvgIcpBars({ items }) {
  if (!items || !items.length) return <div className="text-[12px]" style={{ color: T.faint }}>No scored appointments in scope.</div>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (<div className="flex flex-col gap-2">{items.map((o) => (
    <div key={o.label} className="flex items-center gap-3">
      <div className="text-[12px] shrink-0 truncate" style={{ width: 176, color: T.sub }} title={o.label}>{o.label} <span style={{ color: T.faint }}>({o.n})</span></div>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${Math.round((o.value / max) * 100)}%`, height: "100%", background: T.accent }} /></div>
      <div className="text-[12px] text-right shrink-0" style={{ width: 40, fontVariantNumeric: "tabular-nums", color: T.ink }}>{o.value.toFixed(1)}</div>
    </div>))}</div>);
}
function ApptOutcomeBreakout({ groups }) {
  const anyGroup = groups.am + groups.vp + groups.lp;
  return (<div className="flex flex-col gap-4 mt-1">
    <SubHead label="Outcome breakout" note="every appointment by disposition · attended axis (Start date)" />
    <OutcomeDonutCard big title="All appointments — combined" tally={groups.combinedTally} />
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
      {groups.amTotal > 0 && <OutcomeDonutCard title="Acquisition Managers — appts they set" tally={groups.amTally} />}
      {groups.vpTotal > 0 && <OutcomeDonutCard title="Vice Presidents — appts assigned" tally={groups.vpTally} />}
      {groups.lpTotal > 0 && <OutcomeDonutCard title="Listing Partners — appts assigned" tally={groups.lpTally} />}
    </div>
  </div>);
}
function ApptRoleSection({ store, dir, org, range, part = "both" }) {
  const { S, A, L, rows } = useMemo(() => apptStats(store, dir, range), [store, dir, range]);
  const inDir = useMemo(() => directorySet(dir), [dir]);
  const isVPrep = (rep) => /vice\s*president|\bvp\b/i.test(String(dir.byRep[String(rep).trim()]?.role || ""));
  const scope = repsInScope(dir, org);
  const inScope = (rep) => (!scope || scope.has(rep)) && (!inDir || inDir.has(rep));
  const outcomes = useMemo(() => {
    const role = (n) => String(dir.byRep[String(n).trim()]?.role || "");
    const isAMFU = (n) => /acqu|follow.?up/i.test(role(n));
    const isVP = (n) => /vice\s*president|\bvp\b/i.test(role(n));
    const core = rows.filter((r) => !r.lpAssigned);
    const combined = rows.filter((r) => inScope(String(r.createdBy).trim()) || inScope(String(r.rep).trim()));
    const am = core.filter((r) => isAMFU(r.createdBy) && inScope(String(r.createdBy).trim()));
    const vp = core.filter((r) => isVP(r.rep) && inScope(String(r.rep).trim()));
    const lp = rows.filter((r) => r.lpAssigned && inScope(String(r.rep).trim()));
    return { combinedTally: tallyOutcomes(combined),
      amTally: tallyOutcomes(am), amTotal: am.length,
      vpTally: tallyOutcomes(vp), vpTotal: vp.length,
      lpTally: tallyOutcomes(lp), lpTotal: lp.length };
  }, [rows, dir, scope]);
  const single = org.rep !== "All";
  const vpScope = isVpScope(dir, org);
  const lpScope = !!(scope && scope.size && [...scope].every((r) => isLProle(dir.byRep[r]?.role, dir.byRep[r]?.team)));
  const noOrg = org.team === "All" && org.rep === "All" && org.role === "All" && org.department === "All" && org.company === "All";
  const rateOf = (e) => (e.scored ? e.met / e.scored : null);

  const groupCard = (members, metric, groupLabel, noun, keyp) => {
    const totMet = members.reduce((s, e) => s + e.met, 0), totScored = members.reduce((s, e) => s + e.scored, 0);
    if (metric === "rate") {
      const items = members.map((e) => ({ label: e.rep, pct: rateOf(e) })).filter((x) => x.pct != null).sort((a, b) => b.pct - a.pct);
      return <ApptCard key={keyp} title={`Show Rate — ${groupLabel}`} bigText={totScored ? (totMet / totScored * 100).toFixed(1) + "%" : "—"} caption={`Met ÷ scheduled · excl. cancelled&rescheduled · per ${noun}`} items={items} kind="rate" />;
    }
    const items = members.map((e) => ({ label: e.rep, value: e.met })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    return <ApptCard key={keyp} title={`Appts Attended — ${groupLabel}`} bigText={totMet.toLocaleString()} caption={`Attended (Met) · per ${noun}`} items={items} kind="count" />;
  };
  const singleCard = (e, metric, breakoutNoun, keyp) => {
    const by = Object.values(e.by).filter((b) => !inDir || inDir.has(b.label));
    if (metric === "rate") {
      const items = by.map((b) => ({ label: b.label, pct: b.scored ? b.met / b.scored : null })).filter((x) => x.pct != null).sort((a, b) => b.pct - a.pct);
      return <ApptCard key={keyp} title="Show Rate" bigText={e.scored ? (e.met / e.scored * 100).toFixed(1) + "%" : "—"} caption={`Met ÷ scheduled · excl. cancelled&rescheduled · per ${breakoutNoun}`} items={items} kind="rate" />;
    }
    const items = by.map((b) => ({ label: b.label, value: b.met })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    return <ApptCard key={keyp} title="Appts Attended" bigText={e.met.toLocaleString()} caption={`Attended (Met) · per ${breakoutNoun}`} items={items} kind="count" />;
  };

  let cards = [];
  if (single) {
    const rep = String(org.rep).trim();
    if (vpScope) { const e = A[rep] || { rep, scored: 0, met: 0, by: {} }; cards = [singleCard(e, "rate", "setter", "sr"), singleCard(e, "count", "setter", "aa")]; }
    else { const e = S[rep] || { rep, scored: 0, met: 0, by: {} }; cards = [singleCard(e, "rate", "closer", "sr"), singleCard(e, "count", "closer", "aa")]; }
  } else if (vpScope) {
    const m = Object.values(A).filter((e) => inScope(e.rep) && isVPrep(e.rep));
    cards = [groupCard(m, "rate", "Vice Presidents", "VP", "sr"), groupCard(m, "count", "Vice Presidents", "VP", "aa")];
  } else if (lpScope) {
    const m = Object.values(L).filter((e) => inScope(e.rep));
    cards = [groupCard(m, "rate", "Listing Partners", "LP", "sr"), groupCard(m, "count", "Listing Partners", "LP", "aa")];
  } else if (!noOrg) {
    const m = Object.values(S).filter((e) => inScope(e.rep) && !isVPrep(e.rep));
    cards = [groupCard(m, "rate", "Acquisition Managers", "AM", "sr"), groupCard(m, "count", "Acquisition Managers", "AM", "aa")];
  } else {
    const am = Object.values(S).filter((e) => inScope(e.rep) && !isVPrep(e.rep));
    const vp = Object.values(A).filter((e) => inScope(e.rep) && isVPrep(e.rep));
    const lp = Object.values(L).filter((e) => inScope(e.rep));
    cards = [groupCard(am, "rate", "Acquisition Managers", "AM", "sr-am"), groupCard(vp, "rate", "Vice Presidents", "VP", "sr-vp"),
      groupCard(am, "count", "Acquisition Managers", "AM", "aa-am"), groupCard(vp, "count", "Vice Presidents", "VP", "aa-vp")];
    if (lp.length) cards.push(groupCard(lp, "rate", "Listing Partners", "LP", "sr-lp"), groupCard(lp, "count", "Listing Partners", "LP", "aa-lp"));
  }
  return (<div className="flex flex-col gap-4">
    {part !== "breakout" && <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(248px, 1fr))" }}>{cards}</div>}
    {part !== "rate" && <ApptOutcomeBreakout groups={outcomes} />}
  </div>);
}

function ListingPartnerView({ store, dir, range, lp }) {
  const inR = (d) => { if (!range) return true; const t = parseDate(d); return !!(t && t >= range.start && t <= range.end); };
  // Listing pipeline (snapshot — these tabs carry no date), matched to this partner by tab name.
  const pipe = (store.listing_pipeline || []).filter((r) => nameMatch(lp, tabLP(r.sourceTab)));
  const SIGNED = /signed listing|on market|under contract|closed won/i; // signed-listing milestone or beyond
  const signedRev = pipe.filter((r) => SIGNED.test(String(r.stage || ""))).reduce((s, r) => s + num(r.forecast), 0);
  const pipeByStage = (() => { const m = {}; pipe.forEach((r) => { const k = String(r.stage || "").trim() || "(unset)"; m[k] = (m[k] || 0) + num(r.forecast); });
    return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value); })();
  // Closed revenue via the Listing Partner column on closed deals, date-gated.
  const closed = (store.closed_opps || []).filter((r) => nameMatch(lp, r.listingPartner) && inR(r.closeDate));
  const closedRev = closed.reduce((s, r) => s + num(r.revenue), 0);
  const closedByMonth = (() => { const m = {}; closed.forEach((r) => { const k = monthKey(r.closeDate); if (k) m[k] = (m[k] || 0) + num(r.revenue); });
    return Object.entries(m).sort().slice(-12).map(([label, value]) => ({ label, value })); })();
  // Appointments assigned to this partner (they're the closer), date-gated; setter = Created By.
  const appts = (store.listing_appts || []).filter((r) => nameMatch(lp, r.rep) && inR(r.date));
  const isMet = (a) => /met/i.test(String(a.outcome || "")) && !/no show|missed/i.test(String(a.outcome || ""));
  const scored = appts.filter((a) => { const o = String(a.outcome || "").trim(); return o && !/^no outcome$/i.test(o); });
  const attended = scored.filter(isMet).length;
  const showRate = scored.length ? attended / scored.length : 0;
  const cnt = (rows, keyFn) => { const m = {}; rows.forEach((r) => { const k = String(keyFn(r) || "").trim() || "(unset)"; m[k] = (m[k] || 0) + 1; });
    const tot = rows.length || 1; return Object.entries(m).map(([label, count]) => ({ label, count, pct: count / tot })).sort((a, b) => b.count - a.count); };
  const card = (label, value, format, dataset) => ({ kpi: { id: label, label, format, dataset }, result: { value, target: null, progress: null, variance: null, status: "none", rows: [] } });
  const cards = [
    card("Forecasted Rev · Signed Listing", signedRev, "currency", "listing_pipeline"),
    card("Closed Revenue", closedRev, "currency", "closed_opps"),
    card("Appointments Attended", attended, "number", "listing_appts"),
    card("Appt Show Rate", showRate, "percent", "listing_appts"),
  ];
  const empty = (t) => <div className="text-[12px]" style={{ color: T.faint }}>{t}</div>;
  return (<div className="flex flex-col gap-5">
    <div className="text-[12px]" style={{ color: T.faint }}>Listing Partner view · <span style={{ color: T.sub }}>{lp}</span> — deal metrics track signed listings; appointments are scored on those assigned to {lp}, broken out by who set them.</div>
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
      {cards.map((c) => <KpiCard key={c.kpi.id} kpi={c.kpi} result={c.result} breakout={null} spark={null} />)}
      <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: T.card, border: `1px dashed ${T.border}` }}>
        <span className="text-[13px] font-medium" style={{ color: T.sub }}>Deals to Signed Listing</span>
        <span className="text-[13px]" style={{ color: T.faint }}>Pending your report — will wire in when it lands.</span>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <Panel title={`Appointment outcomes — ${lp}`}>{appts.length ? <Bars items={cnt(appts, (a) => a.outcome)} /> : empty("No appointments in range.")}</Panel>
      <Panel title={`Who set the appointments — ${lp}`}>{appts.length ? <Bars items={cnt(appts, (a) => a.createdBy)} tint={T.chart[2]} /> : empty("No appointments in range.")}</Panel>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <Panel title={`Closed revenue by month — ${lp}`}>{closedByMonth.length ? <MoneyBars items={closedByMonth} fmtVal={(v) => fmt(v, "currency")} /> : empty("No closed revenue in range.")}</Panel>
      <Panel title={`Listing pipeline by stage — ${lp}`}>{pipeByStage.length ? <MoneyBars items={pipeByStage} tint={T.chart[1]} fmtVal={(v) => fmt(v, "currency")} /> : empty("No listing pipeline found for this partner.")}</Panel>
    </div>
  </div>);
}
// ── DISPOSITIONS ─────────────────────────────────────────────────────────────────────────────────────
// Config-driven so new stages/statuses drop in without touching the view. Confirmed with JP:
//   • Active = opps being marketed to buyers (Pre Marketing / Delayed Marketing / Marketing)
//   • Pre Closing folds into Closed/successful; Deals w/ Issues gets its own Watchlist bucket
const DISPO_ACTIVE_STAGES = ["Pre Marketing", "Delayed Marketing", "Marketing"];
const DISPO_OUTCOME_BUCKETS = [
  { key: "closed", label: "Closed / Successful", tone: "good", stages: ["Closed Won", "Closed With Escrow", "Closed in Accounting Reconciliation", "Pre Closing"] },
  { key: "uc",     label: "Under Contract",      tone: "good", stages: ["Under Contract"] },
  { key: "arip",   label: "Buyer ARIP",          tone: "good", stages: ["Buyer ARIP"] },
  { key: "watch",  label: "Watchlist · Deals w/ Issues", tone: "warn", stages: ["Deals w/ Issues"] },
  { key: "dead",   label: "Dead",                tone: "bad",  stages: ["Dead"] },
];
// Current campaign-member status ordered as the dispositions funnel (buyer journey).
const DISPO_STATUS_FUNNEL = ["New", "Sent", "Responded", "Interested", "Follow-Up Required", "Contact Attempted",
  "Confirmed Walkthrough", "Can't Attend Walkthrough", "Walkthrough Attended - New", "Walkthrough Attended - Interested",
  "Walkthrough Attended - Offer Made", "Walkthrough Attended - Not Interested", "Not Interested", "Prospect"];
// Cumulative "ever-reached" milestones from the campaign-member checkboxes (sparse now, backfills over time).
const DISPO_CUMULATIVE = [
  { key: "cbInterested", label: "Interested" },
  { key: "cbConfirmed",  label: "Confirmed Walkthrough" },
  { key: "cbWalkNew",    label: "Walkthrough Attended" },
  { key: "cbOffer",      label: "Offer Made" },
];
const OFFER_STATUS = "Walkthrough Attended - Offer Made";
// Milestone ladder for the per-campaign live feed. rank orders the funnel; a member's "reached" level =
// max(current-status rank, highest checked-checkbox rank), so reached counts are monotonic/inclusive
// (reaching Offer implies Interested) even while the newer checkbox fields are still backfilling.
const DISPO_MILESTONES = [
  { rank: 1, key: "cbInterested", label: "Interested" },
  { rank: 2, key: "cbConfirmed",  label: "Confirmed WT" },
  { rank: 3, key: "cbWalkNew",    label: "WT Attended" },
  { rank: 4, key: "cbOffer",      label: "Offer Made" },
];
const dispoCurRank = (st) => { st = String(st ?? "").trim();
  if (st === OFFER_STATUS) return 4;
  if (/^Walkthrough Attended/.test(st)) return 3;
  if (st === "Confirmed Walkthrough") return 2;
  if (st === "Interested") return 1; return 0; };

function DispoStat({ label, value, sub, tag }) {
  return (
    <div className="rounded-xl p-4" style={{ background: T.card, border: `1px solid ${T.border}` }}>
      <div className="flex items-center gap-2">
        <div className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>{label}</div>
        {tag && <DispoTag kind={tag} />}
      </div>
      <div className="text-[26px] font-bold leading-tight mt-1" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: T.sub }}>{sub}</div>}
    </div>);
}
// Tags every metric with the lens it uses, so it's unambiguous which numbers move when the date picker changes.
function DispoTag({ kind }) {
  const dated = kind === "dated";
  return (
    <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded" title={dated ? "Follows the date filter (by opportunity close date)" : "Live snapshot — current state as of the latest sync; not affected by the date filter"}
      style={{ background: dated ? T.accentSoft : T.track, color: dated ? T.accent : T.faint, whiteSpace: "nowrap" }}>
      {dated ? "date-filtered" : "as of now"}</span>);
}
function DispoBars({ items, tint }) {
  const max = Math.max(1, ...items.map((x) => x.value));
  const color = (it) => it.tone === "good" ? T.pos || T.accent : it.tone === "bad" ? (T.neg || T.warn) : it.tone === "warn" ? T.warn : (tint || T.accent);
  if (!items.length) return <div className="text-[13px] py-6 text-center" style={{ color: T.sub }}>No records.</div>;
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3">
          <div className="text-[12px] shrink-0" style={{ color: T.sub, width: 210, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={it.label}>{it.label}</div>
          <div className="flex-1 h-[18px] rounded" style={{ background: T.track, position: "relative", minWidth: 40 }}>
            <div style={{ position: "absolute", inset: 0, width: `${(it.value / max) * 100}%`, background: color(it), borderRadius: 4, minWidth: it.value > 0 ? 3 : 0 }} />
          </div>
          <div className="text-[12px] text-right shrink-0" style={{ color: T.ink, width: 62, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{it.value.toLocaleString()}</div>
        </div>))}
    </div>);
}

function DispositionsView({ store, range, dir }) {
  const rows = store.dispositions || [];
  const s = (v) => String(v ?? "").trim();
  const activeSet = new Set(DISPO_ACTIVE_STAGES);
  const active = useMemo(() => rows.filter((r) => activeSet.has(s(r.stage))), [rows]);
  const distinctOpps = (rs) => new Set(rs.map((r) => s(r.oid)).filter(Boolean)).size;

  const activeCampaigns = useMemo(() => distinctOpps(active), [active]);
  const offersAll = useMemo(() => rows.filter((r) => s(r.memberStatus) === OFFER_STATUS).length, [rows]);
  const ucOpps = useMemo(() => distinctOpps(rows.filter((r) => s(r.stage) === "Under Contract")), [rows]);

  const outcome = useMemo(() => DISPO_OUTCOME_BUCKETS.map((b) => {
    const set = new Set(b.stages);
    return { label: b.label, tone: b.tone, value: distinctOpps(rows.filter((r) => set.has(s(r.stage)))) };
  }).filter((x) => x.value > 0), [rows]);

  const funnel = useMemo(() => {
    const cnt = {}; active.forEach((r) => { const k = s(r.memberStatus) || "(blank)"; cnt[k] = (cnt[k] || 0) + 1; });
    return DISPO_STATUS_FUNNEL.filter((k) => cnt[k]).map((k) => ({ label: k, value: cnt[k] }));
  }, [active]);

  const cumulative = useMemo(() => DISPO_CUMULATIVE
    .map((c) => ({ label: c.label, value: active.filter((r) => s(r[c.key]) === "1").length }))
    .filter((x) => x.value > 0), [active]);

  const sources = useMemo(() => {
    const cnt = {};
    rows.forEach((r) => { let v = s(r.source); if (!v) return; if (/^curb\s*hero$/i.test(v)) v = "Curb Hero"; cnt[v] = (cnt[v] || 0) + 1; });
    return Object.entries(cnt).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  // DATE-DRIVEN lens. Dispositions has no close date of its own, so we join to the Closed Opps report on the
  // stable Opportunity ID and filter by its Close Date — the one metric here that responds to the date picker.
  const inRange = (d) => { if (!range) return true; const t = parseDate(d); return !!(t && t >= range.start && t <= range.end); };
  const dispoOids = useMemo(() => new Set(rows.map((r) => s(r.oid)).filter(Boolean)), [rows]);
  const closeMap = useMemo(() => { const m = new Map(); (store.closed_opps || []).forEach((r) => { const id = s(r.id); if (id) m.set(id, r); }); return m; }, [store]);
  const closedInRange = useMemo(() => {
    let n = 0, rev = 0; const byType = {};
    dispoOids.forEach((id) => { const c = closeMap.get(id); if (c && inRange(c.closeDate)) { n++; rev += num(c.revenue); const t = s(c.txType) || "(unset)"; byType[t] = (byType[t] || 0) + 1; } });
    return { n, rev, byType: Object.entries(byType).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value) };
  }, [dispoOids, closeMap, range]);
  const spanLabel = range ? `${iso(range.start)} → ${iso(range.end)}` : "all time";

  // Per-campaign live feed (active campaigns only). Each milestone shows current · reached, where reached is
  // inclusive: member's reached level = max(current-status rank, highest checked checkbox rank).
  const feed = useMemo(() => {
    const g = new Map();
    for (const r of active) {
      const name = s(r.campName) || s(r.campId); if (!name) continue;
      let o = g.get(name);
      if (!o) { o = { name, members: 0, stage: s(r.stage), cur: [0, 0, 0, 0], reached: [0, 0, 0, 0] }; g.set(name, o); }
      o.members++;
      const cr = dispoCurRank(r.memberStatus);
      let rr = cr;
      DISPO_MILESTONES.forEach((m) => { if (s(r[m.key]) === "1") rr = Math.max(rr, m.rank); });
      if (cr >= 1) o.cur[cr - 1]++;
      for (let k = 1; k <= 4; k++) if (rr >= k) o.reached[k - 1]++;
    }
    return [...g.values()].sort((a, b) => b.members - a.members);
  }, [active]);

  if (!rows.length) return (
    <div className="rounded-xl p-4 text-[13px]" style={{ background: T.warnSoft, border: `1px solid ${T.warn}33`, color: T.ink }}>
      No Dispositions data loaded yet — check that the "Opportunities &amp; Campaigns x YTD" tab is present in the Dispositions workbook and the Sheets API key is set.</div>);

  return (
    <div className="flex flex-col gap-5" id="dispositions-view">
      <div className="rounded-xl p-3.5 text-[12px] leading-relaxed" style={{ background: T.track, color: T.sub }}>
        <b style={{ color: T.ink }}>Dispositions</b> tracks buyer campaigns — the marketing of each opportunity to a pool of buyers, and where every campaign member sits in the buyer journey. Two lenses live on this tab, tagged on each metric:
        <span className="inline-block mx-1"><DispoTag kind="snapshot" /></span> = live state right now (ignores the date filter),
        <span className="inline-block mx-1"><DispoTag kind="dated" /></span> = follows the date filter, by opportunity <b>close date</b>. Active-campaign health is inherently a "right now" question, so it stays a snapshot; closed volume is the metric that moves with the date window. "Active" = opportunities in <b>Pre-Marketing, Delayed Marketing, or Marketing</b>.
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DispoStat label="Active Campaigns" value={activeCampaigns.toLocaleString()} sub="opps being marketed (Pre-Mkt / Mkt)" tag="snapshot" />
        <DispoStat label="Active Buyer Pool" value={active.length.toLocaleString()} sub="members on active campaigns" tag="snapshot" />
        <DispoStat label="Offers Made" value={offersAll.toLocaleString()} sub="members at offer-made · all campaigns" tag="snapshot" />
        <DispoStat label="Under Contract" value={ucOpps.toLocaleString()} sub="opps currently under contract" tag="snapshot" />
      </div>

      <Panel title={`Closed opportunities — ${spanLabel}`}>
        <div className="flex items-start gap-2 flex-wrap mb-3"><DispoTag kind="dated" /></div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div><div className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>Deals Closed</div>
            <div className="text-[26px] font-bold" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{closedInRange.n.toLocaleString()}</div></div>
          <div><div className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>Closed Revenue</div>
            <div className="text-[26px] font-bold" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{fmt(closedInRange.rev, "currency")}</div></div>
          <div className="col-span-2 md:col-span-1"><div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: T.faint }}>By transaction type</div>
            {closedInRange.byType.length ? <DispoBars items={closedInRange.byType} tint={T.chart ? T.chart[3] : T.accent} /> : <div className="text-[12px]" style={{ color: T.sub }}>—</div>}</div>
        </div>
        <div className="text-[11px] mt-3" style={{ color: T.faint }}>Dispositions opportunities whose <b>close date</b> falls in the selected window — the one figure on this tab driven by the date filter. Joined from the Closed Opps report on Opportunity ID (Dispositions carries no close date of its own). Change the date range up top to move this panel.</div>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Panel title="Current opportunity states">
          <div className="mb-3"><DispoTag kind="snapshot" /></div>
          <DispoBars items={outcome} />
          <div className="text-[11px] mt-3" style={{ color: T.faint }}>Where every disposition opportunity stands <b>right now</b>, by stage — one count per distinct opportunity. Under Contract / Buyer ARIP / Dead have no close date, so they're shown as current state rather than date-filtered. Pre-Closing folds into Closed; Deals w/ Issues is the Watchlist.</div>
        </Panel>
        <Panel title="Member source">
          <div className="mb-3"><DispoTag kind="snapshot" /></div>
          <DispoBars items={sources} tint={T.chart ? T.chart[2] : T.accent} />
          <div className="text-[11px] mt-3" style={{ color: T.faint }}>How each buyer entered the campaign — Reverse Prospect, Taproot, Curb Hero, Showing Time Request. Sparse today: most members carry no source yet, so treat this as directional until the field backfills.</div>
        </Panel>
      </div>

      <Panel title="Active campaigns — current member status">
        <div className="mb-3"><DispoTag kind="snapshot" /></div>
        <DispoBars items={funnel} tint={T.accent} />
        <div className="text-[11px] mt-3" style={{ color: T.faint }}>Where the live buyer pool sits <b>this moment</b>, across active (Pre-Marketing / Marketing) campaigns — each member counted once at their current status. Read it as the top-of-funnel-to-offer shape of the active book.</div>
      </Panel>

      <Panel title="Active campaigns — cumulative milestones reached">
        <div className="mb-3"><DispoTag kind="snapshot" /></div>
        <DispoBars items={cumulative} tint={T.chart ? T.chart[1] : T.accent} />
        <div className="text-[11px] mt-3" style={{ color: T.faint }}>How many members <b>ever hit</b> each milestone — from the status checkboxes, so it counts people who've since moved on. This is true campaign health (throughput), independent of where members sit now. The checkbox fields are newly added, so these fill in over time.</div>
      </Panel>

      <Panel title="Active campaigns — live feed">
        <div className="mb-3"><DispoTag kind="snapshot" /></div>
        {feed.length ? (() => {
          const maxR = DISPO_MILESTONES.map((_, i) => Math.max(1, ...feed.map((f) => f.reached[i])));
          return (<>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 720 }}>
                <thead><tr style={{ color: T.faint }} className="text-[11px] uppercase tracking-wide">
                  <th className="py-2 px-2 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>Campaign</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Members</th>
                  {DISPO_MILESTONES.map((m) => (
                    <th key={m.label} className="py-2 px-2 text-right whitespace-nowrap" style={{ borderBottom: `1px solid ${T.border}` }}>{m.label}</th>))}
                </tr></thead>
                <tbody>{feed.map((f) => (
                  <tr key={f.name} style={{ color: T.ink }}>
                    <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, fontWeight: 600, maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={f.name}>{f.name}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", color: T.sub }}>{f.members.toLocaleString()}</td>
                    {DISPO_MILESTONES.map((m, i) => (
                      <td key={m.label} className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", ...(heatBg(f.reached[i], maxR[i], false) || {}) }}>
                        <span style={{ fontWeight: 700 }}>{f.cur[i].toLocaleString()}</span>
                        <span style={{ color: T.faint }}> · </span>
                        <span style={{ color: T.sub }}>{f.reached[i].toLocaleString()}</span>
                      </td>))}
                  </tr>))}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] mt-3" style={{ color: T.faint }}>Each cell is <b style={{ color: T.ink }}>at status now</b> · <b>ever reached</b> (inclusive — reaching a later milestone counts toward every earlier one, and folds in the status checkboxes as they backfill). Active campaigns only, refreshes each sync.</div>
          </>);
        })() : <div className="text-[13px] py-8 text-center" style={{ color: T.sub }}>No active campaigns.</div>}
      </Panel>
    </div>);
}

function ExecutiveDashboard({ store, dir, org: rawOrg, range, rangeFwd, view }) {
  // Marketing & Speed-to-Lead hide Team/Rep, so they compute company-wide regardless of what was selected elsewhere.
  const org = useMemo(() => scopeOrgForView(rawOrg, view), [rawOrg, view]);
  const [txStageMetric, setTxStageMetric] = useState("arip_close"); // which stage transition the per-rep table shows
  const [txExclFlips, setTxExclFlips] = useState(false); // Transactions stage panels: pull out front/back-end + Fix & Flip
  const [txRmFront, setTxRmFront] = useState(false); // TX flow tiles: drop Purchase ~ Front-End record type
  const [txRmBack, setTxRmBack] = useState(false);   // TX flow tiles: drop Purchase ~ Back-End record type
  const [stageLens, setStageLens] = useState("close"); // merged stage panel: "close" (resolved rate) | "advance"
  const [txTimeTab, setTxTimeTab] = useState("aripclose"); // merged timing panel: "aripclose" | "bystage" | "byrep"
  const [apptTab, setApptTab] = useState("showrate"); // merged Sales appointments panel: showrate | funnel | outcomes | breakout
  const [txSub, setTxSub] = useState("coordination"); // Transactions view sub-tabs: coordination | dispositions
  const isMktView = view === "marketing";
  const isTxView = view === "transactions";
  const inDir = useMemo(() => directorySet(dir), [dir]); // directory membership gate for per-rep tables
  const orgFiltered = org.company !== "All" || org.department !== "All" || org.team !== "All" || org.role !== "All" || org.rep !== "All";
  const showVpMetrics = !orgFiltered || isVpScope(dir, org); // VP-only KPIs: company roll-up (All) + VP drilldowns; hidden for AM/Follow-Up scopes
  const showAmFuMetrics = !orgFiltered || isAmFuScope(dir, org); // AM/Follow-Up-only KPIs: company roll-up + AM/FU drilldowns; hidden for VP scopes
  const allCards = ["closed_revenue", "deals_closed", "avg_deal", "pipeline_forecast", "opps_created", "appointments", "appts_attended", "show_rate", "avg_icp_per_appt", "opps_to_arip", "arip_dealreview", "arip_pullthrough", "rev_out_of_arip", "rev_to_buyer_arip", "rev_to_under_contract", "contracts_sent", "leads", "leads_claimed", "leads_deaded", "leads_call_center", "leads_texting", "leads_website", "leads_direct_mail", "leads_ppl", "reactivated_leads", "mkt_opps_created", "avg_lead_icp", "opps_assigned", "opps_deaded", "calls", "talk_time", "qcs", "live_transfers_attempted", "live_transfers_connected"];
  const cards = isTxView ? ["deals_closed", "closed_revenue", "avg_deal", "pipeline_forecast", "arip_pullthrough", "rev_out_of_arip", "rev_to_buyer_arip", "rev_to_under_contract"]
    : allCards.filter((id) => {
        if (isMktView) return KPIS[id].domain === "marketing";
        if (KPIS[id].domain === "marketing") return false;
        if (KPIS[id].txOnly) return false; // Transactions-tab-only tiles
        if (KPIS[id].vpOnly && !showVpMetrics) return false; // VP-only metrics: shown at company level + VP scope only
        if (KPIS[id].amFuOnly && !showAmFuMetrics) return false; // AM/Follow-Up-only metrics
        return true;
      });
  const salesLagging = CARD_TIERS.lagging.filter((id) => KPIS[id] && (!KPIS[id].vpOnly || showVpMetrics) && (!KPIS[id].amFuOnly || showAmFuMetrics));
  const salesLeading = CARD_TIERS.leading.filter((id) => KPIS[id] && (!KPIS[id].vpOnly || showVpMetrics) && (!KPIS[id].amFuOnly || showAmFuMetrics));
  const CALL_IDS = ["calls", "talk_time", "qcs"];
  const salesLeadingActivity = salesLeading.filter((id) => !CALL_IDS.includes(id));
  const salesLeadingCall = salesLeading.filter((id) => CALL_IDS.includes(id));
  // Rows feeding the two "revenue moved into stage" tiles. Apply the front-/back-end record-type toggles,
  // then for Buyer ARIP impute an entry for every opp that reached Under Contract WITHOUT ever logging a
  // Buyer ARIP transition (front-end purchases legitimately skip it; wholesale skips are usually stage-hygiene)
  // — the imputed row carries the opp's UC date + forecast so it lands in the same window and counts once
  // (dedupeLatest collapses any multi-UC opp). UC tile gets the plain record-type-filtered rows.
  const txStageRows = useMemo(() => {
    const uc = (store.stage_history || []).filter((r) => !(txRmFront && isFrontEndRT(r)) && !(txRmBack && isBackEndRT(r)));
    const nvById = {};
    uc.forEach((r) => { const id = r.id; if (id) (nvById[id] = nvById[id] || new Set()).add(String(r.newValue ?? "").trim()); });
    const imputed = [];
    uc.forEach((r) => { if (String(r.newValue ?? "").trim() !== "Under Contract") return; const id = r.id;
      if (id && nvById[id] && !nvById[id].has("Buyer ARIP")) imputed.push({ ...r, newValue: "Buyer ARIP", __imputed: true }); });
    return { uc, ba: uc.concat(imputed) };
  }, [store, txRmFront, txRmBack]);
  const storeFor = (id) => id === "rev_to_buyer_arip" ? { ...store, stage_history: txStageRows.ba }
    : id === "rev_to_under_contract" ? { ...store, stage_history: txStageRows.uc } : store;
  const results = useMemo(() => Object.fromEntries(allCards.map((id) => [id, computeKpi(KPIS[id], storeFor(id), dir, org, KPIS[id].forwardDate ? rangeFwd : range, rangeFwd)])), [store, dir, org, range, rangeFwd, txStageRows]);
  const teamOf = (rep) => dir.byRep[String(rep ?? "").trim()]?.team || null;
  const breakouts = useMemo(() => {
    const out = {};
    const LAGGING = new Set(CARD_TIERS.lagging);
    const tRows = store.targets || [];
    const repTarget = (kpi, label) => {
      if (!kpi.targetKey) return null;
      const hit = tRows.find((t) => t.kpiId === kpi.targetKey && t.scope === "Rep" && String(t.scopeValue).trim() === label);
      if (!hit) return null;
      const base = num(hit.value);
      if (!base) return null; // blank Column F -> no per-rep target (drops the "/ 0" line)
      return kpi.targetType === "rate" ? base : base * businessMonthsInRange(rangeFwd.start, rangeFwd.end);
    };
    cards.forEach((id) => {
      const kpi = KPIS[id], ds = DATASETS[kpi.dataset], res = results[id];
      if (!res || res.unattributable) { out[id] = null; return; }
      // Always-on custom breakout (e.g. avg talk time split by inbound channel) — not rep-based, shows at every scope.
      if (kpi.customBreakout) { const items = kpi.customBreakout(res.rows).filter((x) => x.value > 0); out[id] = items.length ? { items, custom: true } : null; return; }
      if (kpi.breakoutBy && org.rep !== "All") { // single-rep only (e.g. QC 3+/5+/10+ tiers). At team/All scope, fall through to the per-person breakout below.
        const custom = kpi.breakoutBy(res.rows).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
        if (custom.length) { out[id] = { items: custom, custom: true }; return; }
      }
      if (ds.companyScope || !(ds.repField || ds.repFields)) { out[id] = null; return; }
      if (org.rep !== "All") { out[id] = null; return; } // single rep: the mini-bar just repeats the headline number — drop it (custom breakouts above still render)
      let primary = kpi.breakoutRep || ds.repField || (ds.repFields && ds.repFields[0]);
      if (!primary) { out[id] = null; return; }
      // When a team/role/rep is filtered and the dataset carries the role fields, break out by
      // THAT role's field so the split shows the selected team's people — VPs under a VP filter
      // (owner), AMs under an AM filter (acqManager), Follow-Up under theirs — instead of the
      // hardcoded axis. Bars are also restricted to reps actually in scope (see gate below).
      const scope = repsInScope(dir, org);
      if (orgFiltered && ds.repFields) {
        let rf = null;
        if (org.team !== "All" || org.role !== "All") rf = creditRole(org).field;
        else if (org.rep !== "All") {
          const rl = String(dir.byRep[String(org.rep).trim()]?.role || "");
          rf = /vice\s*president|\bvp\b/i.test(rl) ? "owner" : /acqu/i.test(rl) ? "acqManager" : /follow.?up/i.test(rl) ? "followUp" : null;
        }
        if (rf && ds.repFields.includes(rf)) primary = rf;
      }
      // On the unfiltered All view, EVERY rep-attributed tile gets a TEAM-sectioned breakout: reps are
      // grouped under their Context-directory team. Multi-credit datasets (repFields) credit each deal to
      // everyone who touched it — those sections overlap and don't sum to the headline (noted in-card);
      // single-credit datasets tie out, with any blank/off-roster remainder folded into one line.
      if (!orgFiltered) {
        const multi = !!ds.repFields;
        const FIELDS = ds.repFields || [primary]; // primary = breakoutRep || repField
        const valOf = (rows) => kpi.compute ? kpi.compute(rows) : kpi.agg(kpi.qualify ? rows.filter(kpi.qualify) : rows);
        const buckets = {}; // rep -> rows[] (dedupe roles within one row for multi-credit)
        res.rows.forEach((row) => {
          new Set(FIELDS.map((f) => String(row[f] ?? "").trim()).filter(Boolean)).forEach((r) => (buckets[r] = buckets[r] || []).push(row));
        });
        const OFF = "Off-roster / former members"; // reps not in the Context directory: de-identified + aggregated
        const grouped = {};
        const offRows = new Set(), offReps = new Set();
        Object.entries(buckets).forEach(([rep, rows]) => {
          const team = dir.byRep[rep]?.team;
          if (!team) { offReps.add(rep); rows.forEach((r) => offRows.add(r)); return; } // aggregate, don't name
          const value = valOf(rows);
          if (!(value > 0)) return;
          (grouped[team] = grouped[team] || []).push({ label: rep, value });
        });
        const offArr = [...offRows];
        const offValue = offArr.length ? valOf(offArr) : 0;
        if (offValue > 0) { const n = offReps.size; grouped[OFF] = [{ label: `${n} ${n === 1 ? "person" : "people"}`, value: offValue }]; }
        // Section order: alphabetical by team, Off-roster last.
        const secLabels = Object.keys(grouped).sort((a, b) => (a === OFF ? 1 : b === OFF ? -1 : a.localeCompare(b)));
        const sections = secLabels.map((label) => ({ label, items: grouped[label].sort((x, y) => y.value - x.value) }));
        // Additive single-credit metrics must tie to the headline — fold any blank-attribution remainder in.
        const additive = kpi.agg && !kpi.compute && ["number", "currency", "minutes", "duration"].includes(kpi.format);
        if (!multi && additive && res.value != null) {
          const shown = sections.reduce((s, sec) => s + sec.items.reduce((a, x) => a + x.value, 0), 0);
          const rem = res.value - shown;
          if (rem > 0.5) sections.push({ label: "Unassigned", items: [{ label: "No rep on record", value: rem }] });
        }
        out[id] = sections.length ? { sections, custom: false, overlapNote: multi } : null;
        return;
      }
      const groups = {};
      const inScope = (r) => scope ? scope.has(r) : !(inDir && !inDir.has(r));
      res.rows.forEach((row) => {
        if (ds.repFields) { // multi-role: credit the row to every scoped rep it touches, matching the headline's OR-match
          new Set(ds.repFields.map((f) => String(row[f] ?? "").trim()).filter(Boolean))
            .forEach((r) => { if (inScope(r)) (groups[r] = groups[r] || []).push(row); });
        } else {
          const r = String(row[primary] ?? "").trim();
          if (r && inScope(r)) (groups[r] = groups[r] || []).push(row);
        }
      });
      const items = Object.entries(groups).map(([label, rows]) => ({ label,
        value: kpi.compute ? kpi.compute(rows) : kpi.agg(kpi.qualify ? rows.filter(kpi.qualify) : rows), target: repTarget(kpi, label) }))
        .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
      // On the All view, additive count/sum breakouts must tie to the headline. Rows whose breakout
      // rep is blank or off-roster are dropped from the named bars above, so fold that leftover into
      // one de-identified remainder line — the parts then sum to the total.
      const additive = kpi.agg && !kpi.compute && ["number", "currency", "minutes"].includes(kpi.format);
      if (!orgFiltered && additive && res.value != null) {
        const shown = items.reduce((s, x) => s + x.value, 0);
        const rem = res.value - shown;
        if (rem > 0.5) items.push({ label: "Off-roster / unassigned", value: rem });
      }
      out[id] = items.length ? { items, custom: false } : null;
    });
    return out;
  }, [cards, results, store, range, rangeFwd, dir, inDir, orgFiltered]);
  const sparks = useMemo(() => {
    const out = {};
    cards.forEach((id) => {
      const kpi = KPIS[id], ds = DATASETS[kpi.dataset];
      if (!kpi.agg || ds.companyScope || !ds.dateField) { out[id] = null; return; }
      const src0 = id === "rev_to_buyer_arip" ? txStageRows.ba : id === "rev_to_under_contract" ? txStageRows.uc : (store[kpi.dataset] || []);
      const rows = applyFilters(src0, ds, org, null, dir);
      const src = kpi.qualify ? rows.filter(kpi.qualify) : rows;
      const m = {}; src.forEach((r) => { const k = monthKey(r[ds.dateField]); if (k) (m[k] = m[k] || []).push(r); });
      const series = Object.entries(m).sort().map(([label, rs]) => ({ label, value: kpi.agg(rs) })).slice(-12); // trailing 12 mo, preset-independent
      out[id] = series.length >= 2 ? series : null;
    });
    return out;
  }, [cards, store, org, dir, txStageRows]);
  // Month-over-month direction from the trailing spark series (last point vs the one before).
  const trendOf = (id) => { const s = sparks[id]; if (!s || s.length < 2) return null;
    const a = s[s.length - 2].value, b = s[s.length - 1].value; return b > a ? 1 : b < a ? -1 : 0; };
  const apptFunnel = useMemo(() => {
    const scoped = applyFilters(store.appt_funnel || [], DATASETS.appt_funnel, org, null, dir); // org gate only; each leg dated separately below
    const inR = (d) => { if (!range) return true; const t = parseDate(d); return !!(t && t >= range.start && t <= range.end); };
    const hasApptDate = scoped.some((r) => r.date); // appointment Created Date present in the sync?
    // Appointment leg — dated by appointment Created Date; falls back to all-time if that column isn't synced.
    const apptRows = hasApptDate ? scoped.filter((r) => inR(r.date)) : scoped;
    const byType = {}; const opps = new Set();
    apptRows.forEach((r) => { const t = String(r.apptType || "").trim() || "(unset)"; byType[t] = (byType[t] || 0) + 1; if (r.name) opps.add(r.name); });
    // ARIP leg — dated by Arip Date.
    const aripOpps = new Set();
    scoped.forEach((r) => { if (Number(r.flag) === 1 && r.name && inR(r.aripDate)) aripOpps.add(r.name); });
    const total = apptRows.length || 1;
    const items = Object.entries(byType).map(([label, count]) => ({ label, count, pct: count / total })).sort((a, b) => b.count - a.count);
    return { appts: apptRows.length, uniqueOpps: opps.size, arips: aripOpps.size, conv: opps.size ? aripOpps.size / opps.size : 0, items, dated: hasApptDate };
  }, [store, org, range, dir]);

  const byMonth = useMemo(() => { const m = {};
    applyFilters(store.closed_opps || [], DATASETS.closed_opps, org, null, dir)
      .forEach((o) => { const k = monthKey(o.closeDate); if (k) m[k] = (m[k] || 0) + num(o.revenue); });
    return Object.entries(m).sort().map(([k, v]) => ({ label: k, value: v })).slice(-12); }, [store, org, dir]);
  const byStage = useMemo(() => { const m = {};
    const SHORT = { "Closed in Accounting Reconciliation": "Closed · Acct Recon", "Investment Committee (IC)": "Investment Cmte", "Closed Won": "Closed Won", "Buyer ARIP": "Buyer ARIP", "Pre Closing": "Pre Closing", "Deals w/ Issues": "Deals w/ Issues" };
    applyFilters(store.pipeline || [], DATASETS.pipeline, org, null, dir)
      .forEach((o) => { const s = String(o.stage || "").trim(); if (s) m[s] = (m[s] || 0) + num(o.forecast); });
    let arr = Object.entries(m).map(([label, value]) => ({ label: SHORT[label] || label, value })).sort((a, b) => b.value - a.value);
    if (arr.length > 9) { const head = arr.slice(0, 9), tail = arr.slice(9); head.push({ label: `Other (${tail.length})`, value: tail.reduce((s, x) => s + x.value, 0) }); arr = head; }
    return arr; }, [store, org, dir]);
  const byCloseMonth = useMemo(() => { const m = {};
    applyFilters(store.pipeline || [], DATASETS.pipeline, org, null, dir)
      .forEach((o) => { const k = monthKey(o.closeDate); if (k) m[k] = (m[k] || 0) + num(o.forecast); });
    return Object.entries(m).sort().map(([k, v]) => ({ label: k, value: v })).slice(-12); }, [store, org, dir]);
  const drillLabel = org.rep !== "All" ? org.rep : org.team !== "All" ? org.team : org.company !== "All" ? org.company : "All reps";
  const leaderboard = useMemo(() => {
    const scope = repsInScope(dir, org);
    const RF = DATASETS.closed_opps.repFields; // owner/VP + AM + AM2 + follow-up
    const by = {};
    results.closed_revenue.rows.forEach((o) => {
      new Set(RF.map((f) => String(o[f] ?? "").trim()).filter(Boolean)).forEach((k) => { // dedupe roles within one deal
        if (scope ? !scope.has(k) : (inDir && !inDir.has(k))) return; // scope when filtered; else directory gate
        (by[k] = by[k] || { owner: k, rev: 0, deals: 0 }); by[k].rev += num(o.revenue); by[k].deals += 1;
      });
    });
    return Object.values(by).map((x) => ({ ...x, team: dir.byRep[x.owner]?.team, avg: x.deals ? x.rev / x.deals : 0 })).sort((a, b) => b.rev - a.rev);
  }, [results.closed_revenue.rows, dir, org, inDir]);
  const scorecard = useMemo(() => {
    const oppRows  = applyFilters(store.opps_created || [], DATASETS.opps_created, ALL_ORG, range, dir);
    const callRows = applyFilters(store.calls || [],        DATASETS.calls,        ALL_ORG, range, dir);
    const apptSetRows = applyFilters(store.appointments || [], DATASETS.appointments, ALL_ORG, range, dir);            // Set → Created Date
    const apptAttRows = applyFilters(store.appointments_attended || [], DATASETS.appointments_attended, ALL_ORG, range, dir); // Attended/Show Rate → Start
    const assignedRows = applyFilters(store.opps_assigned || [], DATASETS.opps_assigned, ALL_ORG, range, dir);
    const deadedRows = applyFilters(store.opps_deaded || [], DATASETS.opps_deaded, ALL_ORG, range, dir);
    const aripRows = applyFilters(store.arip || [], DATASETS.arip, ALL_ORG, range, dir);
    const enteredRows = applyFilters(store.arip_entered || [], DATASETS.arip_entered, ALL_ORG, range, dir);
    const key = (v) => String(v ?? "").trim();
    const M = {};
    const ensure = (k) => (M[k] = M[k] || { rep: k, oppsCreated: 0, oppsAssigned: 0, oppsDeaded: 0, oppsArip: 0, aripReview: 0, minutes: 0, qcs: 0, apptsSet: 0, setMet: 0, setSched: 0, apptsAssigned: 0, attended: 0, attSched: 0 });
    oppRows.forEach((r) => { const k = key(r.createdBy); if (k) ensure(k).oppsCreated += 1; });
    assignedRows.forEach((r) => { const k = key(r.rep); if (k) ensure(k).oppsAssigned += 1; });
    deadedRows.forEach((r) => { const k = key(r.rep); if (k) ensure(k).oppsDeaded += 1; });
    enteredRows.forEach((r) => { const roles = new Set([r.owner, r.acqManager, r.acqManager2, r.followUp].map(key).filter(Boolean)); roles.forEach((k) => ensure(k).oppsArip += 1); });
    aripRows.forEach((r) => { if (String(r.newValue).trim() === "Deal Review" && Number(r.outArip) === 1) { const k = key(r.rep); if (k) ensure(k).aripReview += 1; } });
    callRows.forEach((r) => { const k = key(r.rep); if (!k) return; const e = ensure(k); e.minutes += num(r.durationMin); if (isQC(r)) e.qcs += 1; });
    apptSetRows.forEach((r) => { const s = key(r.createdBy); if (s) ensure(s).apptsSet += 1; });        // Set = created in window (all outcomes)
    apptAttRows.forEach((r) => {
      if (r.lpAssigned) return;                                                                          // LP-routed appts are pulled out of AM/VP rate
      const sched = !apptExcluded(r.outcome), att = apptAttended(r.outcome);                             // Start in window
      const s = key(r.createdBy); if (s) { const e = ensure(s); if (sched) e.setSched += 1; if (att) e.setMet += 1; }
      const a = key(r.rep);       if (a) { const e = ensure(a); e.apptsAssigned += 1; if (sched) e.attSched += 1; if (att) e.attended += 1; }
    });
    const scope = repsInScope(dir, org);
    const isVP = (role) => /vice\s*president|\bvp\b/i.test(String(role || ""));
    return Object.values(M)
      .filter((x) => scope ? scope.has(x.rep) : (!inDir || inDir.has(x.rep)))
      .map((x) => { const role = dir.byRep[x.rep]?.role, vp = isVP(role);
        const attendeePrimary = vp || (x.apptsSet === 0 && x.apptsAssigned > 0);
        const denom = attendeePrimary ? x.attSched : x.setSched, numer = attendeePrimary ? x.attended : x.setMet;
        return { ...x, team: dir.byRep[x.rep]?.team, role, vp, attendeePrimary, shownAttended: attendeePrimary ? x.attended : x.setMet, rate: denom ? numer / denom : null }; })
      .sort((a, b) => b.oppsCreated - a.oppsCreated || b.minutes - a.minutes);
  }, [store, dir, org, range, inDir]);
  const outcomeMix = useMemo(() => {
    const rows = applyFilters(store.appointments_attended || [], DATASETS.appointments_attended, org, range, dir);
    const m = {}; rows.forEach((r) => { const o = String(r.outcome || "").trim() || "(blank)"; m[o] = (m[o] || 0) + 1; });
    const total = rows.length || 1;
    return { total: rows.length, items: Object.entries(m).map(([label, count]) => ({ label, count, pct: count / total })).sort((a, b) => b.count - a.count) };
  }, [store, org, range, dir]);
  // Avg ICP of appointments SET, broken out by appointment type (Event Type) and by subject. Scoped by
  // org + period (Created Date) like the tile; only appts carrying a numeric ISA ICP count. Subjects are
  // normalized (trailing " - Name" stripped) so near-duplicates collapse into real consultation types.
  const apptIcp = useMemo(() => {
    const rows = applyFilters(store.appointments || [], DATASETS.appointments, org, range, dir)
      .filter((r) => r.icp != null && r.icp !== "" && !isNaN(Number(r.icp)));
    const grp = (keyFn) => { const m = {}; rows.forEach((r) => { const k = keyFn(r); (m[k] = m[k] || []).push(Number(r.icp)); });
      return Object.entries(m).map(([label, arr]) => ({ label, value: mean(arr), n: arr.length })).sort((a, b) => b.n - a.n); };
    const normSub = (s) => { const x = String(s ?? "").trim().replace(/\s*-\s*[^-]+$/, ""); return x || "(unspecified)"; };
    return { byType: grp((r) => String(r.eventType ?? "").trim() || "(unspecified)"),
      bySubject: grp((r) => normSub(r.subject)).slice(0, 8),
      overall: rows.length ? mean(rows.map((r) => Number(r.icp))) : null, n: rows.length };
  }, [store, org, range, dir]);
  const mktLeadsBySource  = useMemo(() => breakdown(applyFilters(store.leads || [], DATASETS.leads, org, range, dir), (r) => r.source), [store, org, range, dir]);
  const mktLeadsBySegment = useMemo(() => breakdown(applyFilters(store.leads || [], DATASETS.leads, org, range, dir), (r) => r.segment), [store, org, range, dir]);
  const mktOppsBySource   = useMemo(() => breakdown(applyFilters(store.mkt_opps || [], DATASETS.mkt_opps, org, range, dir), (r) => r.source), [store, org, range, dir]);
  const mktOppsBySegment  = useMemo(() => breakdown(applyFilters(store.mkt_opps || [], DATASETS.mkt_opps, org, range, dir), (r) => r.segment), [store, org, range, dir]);
  const apptsSegBySource = useMemo(() => breakdown(applyFilters(store.appts_seg || [], DATASETS.appts_seg, org, range, dir), (r) => r.source), [store, org, range, dir]);
  const apptsSegBySegment = useMemo(() => {
    const rows = applyFilters(store.appts_seg || [], DATASETS.appts_seg, org, range, dir);
    const order = ["Core", "Secondary", "Exploratory"]; const m = { Core: 0, Secondary: 0, Exploratory: 0 }; let blank = 0;
    rows.forEach((r) => { const s = String(r.segment || "").trim(); if (order.includes(s)) m[s] += 1; else blank += 1; });
    const named = order.reduce((a, k) => a + m[k], 0) || 1;
    return { items: order.map((k) => ({ label: k, value: m[k], pct: m[k] / named })), blank, total: rows.length };
  }, [store, org, range, dir]);
  const oppsSegPct = useMemo(() => {
    const rows = applyFilters(store.mkt_opps || [], DATASETS.mkt_opps, org, range, dir);
    const order = ["Core", "Secondary", "Exploratory"]; const m = { Core: 0, Secondary: 0, Exploratory: 0 }; let blank = 0;
    rows.forEach((r) => { const s = String(r.segment || "").trim(); if (order.includes(s)) m[s] += 1; else blank += 1; });
    const named = order.reduce((a, k) => a + m[k], 0) || 1;
    return { items: order.map((k) => ({ label: k, value: m[k], pct: m[k] / named })), blank, total: rows.length };
  }, [store, org, range, dir]);
  const inClose = (d) => { if (!range) return true; const t = parseDate(d); return !!(t && t >= range.start && t <= range.end); };
  const inCloseFwd = (d) => { if (!rangeFwd) return true; const t = parseDate(d); return !!(t && t >= rangeFwd.start && t <= rangeFwd.end); };
  const txByType = useMemo(() => {
    const rows = applyFilters(store.pipeline || [], DATASETS.pipeline, org, null, dir).filter((o) => inCloseFwd(o.closeDate));
    const m = {};
    rows.forEach((o) => { const t = String(o.txType || "").trim() || "(unset)"; const closed = /closed|escrow|owned/i.test(String(o.stage || ""));
      const e = m[t] = m[t] || { type: t, deals: 0, forecast: 0, net: 0, closed: 0, open: 0 };
      e.deals += 1; e.forecast += num(o.forecast); e.net += num(o.netRev); closed ? e.closed++ : e.open++; });
    const arr = Object.values(m).sort((a, b) => b.forecast - a.forecast);
    const totDeals = arr.reduce((s, x) => s + x.deals, 0) || 1, totFc = arr.reduce((s, x) => s + x.forecast, 0) || 1, totNet = arr.reduce((s, x) => s + x.net, 0);
    return { rows: arr.map((x) => ({ ...x, avg: x.deals ? x.forecast / x.deals : 0, pctDeals: x.deals / totDeals, pctFc: x.forecast / totFc })),
      totals: { deals: totDeals, forecast: totFc, net: totNet, avg: totFc / totDeals } };
  }, [store, org, rangeFwd, dir]);
  const txMedians = useMemo(() => {
    const rows = applyFilters(store.tx_duration || [], DATASETS.tx_duration, org, null, dir).filter((r) => inClose(r.closeDate));
    const m = {};
    rows.forEach((r) => { const t = String(r.txType || "").trim() || "(unset)"; (m[t] = m[t] || []).push(num(r.duration)); });
    return Object.entries(m).map(([label, arr]) => ({ label, value: median(arr), closed: arr.filter((n) => n > 0).length, total: arr.length }))
      .filter((x) => x.total > 0).sort((a, b) => a.value - b.value);
  }, [store, org, range, dir]);
  // Median duration for every TX_STAGE_DURATIONS transition × transaction type, over deals that CLOSED in
  // the selected period. Each cell is computed only over rows where both endpoint dates are present, so a
  // deal contributes to one transition and not another depending on which stage dates it has. Transitions
  // with no data anywhere in scope are dropped so the table stays tight.
  const txStageMatrix = useMemo(() => {
    const scoped = applyFilters(store.tx_duration || [], DATASETS.tx_duration, org, null, dir); // org gate only, no period
    const rows = scoped.filter((r) => inClose(r.closeDate)); // period-filtered — drives values/counts
    const ORDER = ["Assignment", "Novation", "Fix & Flip"];
    // Columns come from every transaction type this scope has (period-independent), so a type with no closes
    // in the selected period still shows its column (all "—") instead of silently disappearing.
    const types = [...new Set(scoped.map((r) => String(r.txType || "").trim()).filter(Boolean))]
      .sort((a, b) => { const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b); });
    const cell = (subset, m) => { const vals = subset.map((r) => daysBetween(r[m.from], r[m.to])).filter((n) => n != null);
      return { median: vals.length ? median(vals) : null, avg: vals.length ? mean(vals) : null, n: vals.length }; };
    const byType = {}; types.forEach((t) => { byType[t] = rows.filter((r) => String(r.txType || "").trim() === t); });
    const metrics = TX_STAGE_DURATIONS.map((m) => ({ ...m, all: cell(rows, m),
      cells: Object.fromEntries(types.map((t) => [t, cell(byType[t], m)])) })).filter((m) => m.all.n > 0);
    return { types, metrics, total: rows.length };
  }, [store, org, range, dir]);
  // Same stage-transition durations, but broken out per rep × transaction type for every transition, so the
  // Transactions view can show a cross-rep comparison for one transition at a time (picker-driven). A deal is
  // credited to every rep who touched it (owner/VP, AM, AM2, follow-up) — matching the leaderboard/scorecard —
  // so a rep's median is over the deals they were on. Reps restricted to the current directory scope.
  const txStageByRep = useMemo(() => {
    const scoped = applyFilters(store.tx_duration || [], DATASETS.tx_duration, org, null, dir);
    const rows = scoped.filter((r) => inClose(r.closeDate));
    const ORDER = ["Assignment", "Novation", "Fix & Flip"];
    const types = [...new Set(scoped.map((r) => String(r.txType || "").trim()).filter(Boolean))]
      .sort((a, b) => { const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b); });
    const RF = DATASETS.tx_duration.repFields; // owner/VP + AM + AM2 + follow-up
    const scope = repsInScope(dir, org);
    const inScopeRep = (r) => scope ? scope.has(r) : (!inDir || inDir.has(r));
    const perRep = {}; // rep -> rows[] (multi-credit; dedupe roles within a deal)
    rows.forEach((row) => { new Set(RF.map((f) => String(row[f] ?? "").trim()).filter(Boolean))
      .forEach((rep) => { if (inScopeRep(rep)) (perRep[rep] = perRep[rep] || []).push(row); }); });
    const cell = (subset, m) => { const vals = subset.map((r) => daysBetween(r[m.from], r[m.to])).filter((n) => n != null);
      return { median: vals.length ? median(vals) : null, avg: vals.length ? mean(vals) : null, n: vals.length }; };
    const byTransition = {};
    TX_STAGE_DURATIONS.forEach((m) => {
      byTransition[m.id] = Object.entries(perRep).map(([rep, rs]) => ({ rep, role: dir.byRep[rep]?.role,
        all: cell(rs, m), cells: Object.fromEntries(types.map((t) => [t, cell(rs.filter((r) => String(r.txType || "").trim() === t), m)])) }))
        .filter((x) => x.all.n > 0).sort((a, b) => (a.all.median ?? 1e9) - (b.all.median ?? 1e9) || b.all.n - a.all.n);
    });
    return { types, byTransition, total: rows.length };
  }, [store, org, range, dir, inDir]);
  // Stage conversion / probability — Report A (resolved close rate), Report B (adjacent advance %), and the
  // per-VP close-rate matrix. All anchored on first entry into a stage within the selected period; org/rep/dir
  // scoping is applied at load (range=null) and the period window is applied on the entry date inside the engine.
  const stageConv = useMemo(() => {
    const all = applyFilters(store.stage_history || [], DATASETS.stage_history, org, null, dir);
    const rows = txExclFlips ? all.filter((r) => !isExcludedRecord(r)) : all;
    const closedSet = new Set((store.closed_opps || []).map((r) => String(r.id ?? "").trim()).filter(Boolean)); // deals your Closed Opps report confirms as closed
    const agg = stageOppAgg(rows, closedSet);
    return { A: stageReportA(agg, range), B: stageReportB(agg, range), byVP: stageReportByVP(agg, range, dir), opps: agg.size };
  }, [store, org, range, dir, txExclFlips]);
  // Period movement (stage flow) — entries/exits and advance/revert/dead by core stage, keyed on transition
  // date so it reads cleanly on any window (even This Month), unlike the maturity-bound cohort close rates.
  const stageFlowData = useMemo(() => {
    const all = applyFilters(store.stage_history || [], DATASETS.stage_history, org, null, dir);
    const rows = txExclFlips ? all.filter((r) => !isExcludedRecord(r)) : all;
    return stageFlow(rows, range);
  }, [store, org, range, dir, txExclFlips]);
  // Total forecasted revenue of deals that moved to Under Contract in the period. Under-Contract entries come
  // from the stage-history (skip toggle respected); forecast $ is joined by Opportunity Name from the pipeline
  // forecast tab, falling back to closed-opp forecast. Deals not present in either forecast source contribute $0.
  const ucForecast = useMemo(() => {
    // Same source + logic as the "Forecasted Rev → Under Contract" tile: stage-history rows whose New Value
    // is Under Contract, dated by Edit Date within the window, deduped to the latest entry per opp, summing
    // the Total Forecasted Revenue column. (This panel additionally respects the front-end toggle, so at
    // "Exclude front-end" it can read below the tile, which always shows all record types.)
    const all = applyFilters(store.stage_history || [], DATASETS.stage_history, org, null, dir);
    const rows = (txExclFlips ? all.filter((r) => !isExcludedRecord(r)) : all)
      .filter((r) => String(r.newValue ?? "").trim() === "Under Contract");
    const inR = (d) => { if (!range) return true; const t = parseDate(d); return !!(t && t >= range.start && t <= range.end); };
    const dd = dedupeLatest(rows.filter((r) => inR(r.date)), "id", "date");
    return { total: dd.reduce((s, r) => s + num(r.forecast), 0), n: dd.length };
  }, [store, org, range, dir, txExclFlips]);
  // Revenue attributed to each VP, two ways: per assigned opp and per appointment. All from already-loaded
  // datasets. Opps assigned + closed revenue carry Opportunity Owner (the VP) directly; appointments are
  // attributed to a VP by joining the appt's Opportunity Name to that opp's owner (name→owner map built from
  // the full stage-history, ~99% match). Each source is date-filtered on its own date within the selected range.
  const vpAttribution = useMemo(() => {
    const isVP = (n) => /president|vp\b/i.test(dir?.byRep?.[n]?.role || "");
    const inR = (d) => { if (!range) return true; const t = parseDate(d); return !!(t && t >= range.start && t <= range.end); };
    const name2owner = {};
    [store.opps_created, store.pipeline, store.closed_opps, store.arip_entered, store.stage_history].forEach((dsRows) => {
      (dsRows || []).forEach((r) => { const nm = String(r.name ?? "").trim(), ow = String(r.owner ?? "").trim(); if (nm && ow && !(nm in name2owner)) name2owner[nm] = ow; });
    });
    const oppsAssigned = {}, seen = {};
    (store.opps_assigned || []).forEach((r) => { const ow = String(r.owner ?? "").trim(); if (!isVP(ow) || !inR(r.date)) return;
      const k = ow + "|" + r.id; if (r.id && seen[k]) return; if (r.id) seen[k] = 1; oppsAssigned[ow] = (oppsAssigned[ow] || 0) + 1; });
    const rev = {}, deals = {};
    (store.closed_opps || []).forEach((r) => { const ow = String(r.owner ?? "").trim(); if (!isVP(ow) || !inR(r.closeDate)) return;
      rev[ow] = (rev[ow] || 0) + num(r.revenue); deals[ow] = (deals[ow] || 0) + 1; });
    const apptN = {};
    (store.appointments || []).forEach((r) => { const ow = name2owner[String(r.name ?? "").trim()]; if (ow && isVP(ow) && inR(r.date)) apptN[ow] = (apptN[ow] || 0) + 1; });
    const vps = [...new Set([...Object.keys(oppsAssigned), ...Object.keys(rev), ...Object.keys(apptN)])].filter(isVP);
    return vps.map((vp) => ({ vp, oppsAssigned: oppsAssigned[vp] || 0, appts: apptN[vp] || 0, rev: rev[vp] || 0, deals: deals[vp] || 0,
      revPerAppt: apptN[vp] ? (rev[vp] || 0) / apptN[vp] : null, revPerAssigned: oppsAssigned[vp] ? (rev[vp] || 0) / oppsAssigned[vp] : null }))
      .sort((a, b) => b.rev - a.rev);
  }, [store, range, dir]);
  // Per-rep funnel conversion: Attended→ARIP and ARIP→Closed. Role-specific credit (JP spec):
  //   • Attended appt — VP credited for appts they ATTENDED (Assigned); AM/FU credited for appts they SET
  //     (Created By). One appt can credit both (AM set it, VP attended it) — different skills, not double count.
  //   • ARIPs & Closed — credited by the rep's own role field (VP=owner, AM=acq mgr/2, FU=follow-up).
  // Each count gated on its own event date within the range. Read on This Quarter / This Year (This Month is thin).
  const repConversion = useMemo(() => {
    const roleOf = (rep) => { const r = String(dir.byRep?.[rep]?.role || "");
      if (/vice\s*president|\bvp\b/i.test(r)) return "VP";
      if (/acqu/i.test(r)) return "AM";
      if (/follow.?up/i.test(r)) return "FU"; return null; };
    const inR = (d) => { if (!range) return true; const t = parseDate(d); return !!(t && t >= range.start && t <= range.end); };
    const OPP_FIELDS = [["owner", "VP"], ["acqManager", "AM"], ["acqManager2", "AM"], ["followUp", "FU"]];
    const aripSets = {};
    (store.stage_history || []).forEach((r) => { if (String(r.newValue ?? "").trim() !== "Arip" || !inR(r.date) || !r.id) return;
      OPP_FIELDS.forEach(([f, want]) => { const nm = String(r[f] ?? "").trim(); if (nm && roleOf(nm) === want) (aripSets[nm] = aripSets[nm] || new Set()).add(r.id); }); });
    const closedN = {};
    (store.closed_opps || []).forEach((r) => { if (!inR(r.closeDate)) return;
      OPP_FIELDS.forEach(([f, want]) => { const nm = String(r[f] ?? "").trim(); if (nm && roleOf(nm) === want) closedN[nm] = (closedN[nm] || 0) + 1; }); });
    const attN = {};
    (store.appointments_attended || []).forEach((r) => { if (r.lpAssigned || !apptAttended(r.outcome) || !inR(r.date)) return;
      const asg = String(r.rep ?? "").trim(), cb = String(r.createdBy ?? "").trim();
      if (roleOf(asg) === "VP") attN[asg] = (attN[asg] || 0) + 1;
      if (["AM", "FU"].includes(roleOf(cb))) attN[cb] = (attN[cb] || 0) + 1; });
    const roster = (dir.people || []).map((p) => p.rep).filter((rep) => roleOf(rep) && (!inDir || inDir.has(rep)));
    const ord = { VP: 0, AM: 1, FU: 2 };
    return roster.map((rep) => { const role = roleOf(rep), A = attN[rep] || 0, R = aripSets[rep] ? aripSets[rep].size : 0, C = closedN[rep] || 0;
      return { rep, role, attended: A, arips: R, closed: C, attToArip: A ? R / A : null, aripToClosed: R ? C / R : null }; })
      .filter((x) => x.attended > 0 || x.arips > 0 || x.closed > 0)
      .sort((a, b) => (ord[a.role] - ord[b.role]) || (b.closed - a.closed) || (b.arips - a.arips));
  }, [store, range, dir, inDir]);
  const isClosedStage = (s) => /closed|escrow|owned/i.test(String(s || ""));
  const mktPipeByChannel = useMemo(() => groupSum(applyFilters(store.pipeline || [], DATASETS.pipeline, org, null, dir).filter((o) => !isClosedStage(o.stage) && inCloseFwd(o.closeDate)),
    (r) => String(r.source || "").trim() || "(unset)", (r) => num(r.forecast)).sort((a, b) => b.value - a.value), [store, org, rangeFwd, dir]);
  const mktClosedByChannel = useMemo(() => groupSum(applyFilters(store.pipeline || [], DATASETS.pipeline, org, null, dir).filter((o) => isClosedStage(o.stage) && inClose(o.closeDate)),
    (r) => String(r.source || "").trim() || "(unset)", (r) => num(r.forecast)).sort((a, b) => b.value - a.value), [store, org, range, dir]);
  // ICP score → funnel-stage matrix (Marketing). ISA ICP isn't on stage_history, so join it from opps_created
  // by Opportunity ID, stamp onto each opp in the stage aggregation, then bucket by score. Company-wide (org
  // is already stripped to company scope on the Marketing view); the period is applied per stage inside the engine.
  const icpFunnel = useMemo(() => {
    const rows = applyFilters(store.stage_history || [], DATASETS.stage_history, org, null, dir);
    const closedSet = new Set((store.closed_opps || []).map((r) => String(r.id ?? "").trim()).filter(Boolean));
    const closeById = new Map();
    (store.closed_opps || []).forEach((r) => { const id = String(r.id ?? "").trim(); if (id && !closeById.has(id)) closeById.set(id, r); });
    // ISA ICP lookup, unioned across every opp-keyed tab that already carries it (first non-blank per
    // Opportunity ID), so a long-cycle opp missing from opps_created still gets its score instead of landing
    // in Unscored. Same join key, no duplicated columns anywhere. Note mkt_opps stores ISA ICP under its own
    // field (isaIcp) — its `icp` is Total ICP Score, a different scale — so read isaIcp there.
    const icpById = new Map();
    const addIcp = (rows, field) => (rows || []).forEach((r) => { const id = String(r.id ?? "").trim(); const v = r[field];
      if (id && !icpById.has(id) && v != null && String(v).trim() !== "") icpById.set(id, v); });
    addIcp(store.opps_created, "icp");
    addIcp(store.arip_entered, "icp");
    addIcp(store.arip_out, "icp");
    addIcp(store.mkt_opps, "isaIcp");
    const agg = stageOppAgg(rows, closedSet);
    agg.forEach((o, id) => { o.icp = icpById.get(id); });
    return icpScoreFunnel(agg, range, closeById);
  }, [store, org, range, dir]);

  if (view === "speedtolead") return <SpeedToLeadView store={store} range={range} dir={dir} />;
  const lpName = lpScopeName(dir, org); // single Listing Partner selected → swap to their card set
  if (lpName) return <ListingPartnerView store={store} dir={dir} range={range} lp={lpName} />;

  const txSubToggle = isTxView ? (
    <div className="inline-flex rounded-lg p-0.5 self-start" style={{ background: T.track }}>
      {[["coordination", "Transaction Coordination"], ["dispositions", "Dispositions"]].map(([v, l]) => (
        <button key={v} onClick={() => setTxSub(v)} className="text-[13px] font-medium px-3 py-1.5 rounded-md transition-colors whitespace-nowrap"
          style={{ background: txSub === v ? T.card : "transparent", color: txSub === v ? T.ink : T.sub, boxShadow: txSub === v ? "0 1px 2px rgba(0,0,0,0.06)" : "none" }}>{l}</button>))}
    </div>) : null;

  if (isTxView && txSub === "dispositions") return (
    <div className="flex flex-col gap-5">{txSubToggle}<DispositionsView store={store} range={range} dir={dir} /></div>);

  return (<div className="flex flex-col gap-5">
    {txSubToggle}
    {(!isTxView && !isMktView) ? (<>
      <SummaryStrip items={["closed_revenue", "pipeline_forecast", "deals_closed", "show_rate"].map((id) => ({
        label: KPIS[id].label, value: results[id] && results[id].value, format: KPIS[id].format, trend: trendOf(id) }))} />
      <SubHead label="Lagging indicators" note="results — what the team is ultimately measured on" />
      <CardGrid big ids={salesLagging} results={results} breakouts={breakouts} sparks={sparks} />
      <SubHead label="Leading indicators" note="activities that drive those results" />
      <CardGrid ids={salesLeadingActivity} results={results} breakouts={breakouts} sparks={sparks} />
      {salesLeadingCall.length > 0 && (<>
        <SubHead label="Call activity" note="dials, talk time & quality conversations" />
        <CardGrid ids={salesLeadingCall} results={results} breakouts={breakouts} sparks={sparks} />
      </>)}
      {org.rep !== "All" && <RepTrendStrip ids={["opps_to_arip", "opps_created", "appointments", "calls", "talk_time", "leads_claimed"]} sparks={sparks} results={results} />}
      {org.rep === "All" && vpAttribution.length > 0 && (() => {
        const maxRev = Math.max(1, ...vpAttribution.map((v) => v.rev));
        const maxRPA = Math.max(1, ...vpAttribution.map((v) => v.revPerAppt || 0));
        const maxRAO = Math.max(1, ...vpAttribution.map((v) => v.revPerAssigned || 0));
        return (
          <Panel title={`Revenue attributed by VP — ${drillLabel}`}>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 680 }}>
                <thead><tr style={{ color: T.faint }} className="text-[11px] uppercase tracking-wide">
                  <th className="py-2 px-2 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>VP</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Opps Assigned</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Appointments</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Closed Revenue</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Deals</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Rev / Appt</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Rev / Assigned Opp</th>
                </tr></thead>
                <tbody>{vpAttribution.map((v) => (
                  <tr key={v.vp} style={{ color: T.ink }}>
                    <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, fontWeight: 600, whiteSpace: "nowrap" }}>{v.vp}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{v.oppsAssigned.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{v.appts.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", fontWeight: 700, ...(heatBg(v.rev, maxRev, false) || {}) }}>{fmt(v.rev, "currency")}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{v.deals}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", ...(heatBg(v.revPerAppt, maxRPA, false) || {}) }}>{v.revPerAppt == null ? <span style={{ color: T.faint }}>—</span> : fmt(v.revPerAppt, "currency")}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", ...(heatBg(v.revPerAssigned, maxRAO, false) || {}) }}>{v.revPerAssigned == null ? <span style={{ color: T.faint }}>—</span> : fmt(v.revPerAssigned, "currency")}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] mt-3" style={{ color: T.faint }}><b>Revenue</b> is closed (realized) Total Forecasted Revenue on each VP's won deals in the period. <b>Rev / Appt</b> = that revenue ÷ the appointments on the VP's deals (each appointment tied to a VP by the deal it's on). <b>Rev / Assigned Opp</b> = that revenue ÷ opps assigned under the VP. Together they show how efficiently a VP turns assignments and appointments into closed revenue. Opps assigned &amp; appointments date on their own created dates; revenue on close date. Scoped to <b>{drillLabel}</b>.</div>
          </Panel>);
      })()}
      {org.rep === "All" && repConversion.length > 0 && (() => {
        const maxAA = Math.max(0.0001, ...repConversion.map((r) => r.attToArip || 0));
        const maxAC = Math.max(0.0001, ...repConversion.map((r) => r.aripToClosed || 0));
        return (
          <Panel title={`Conversion by rep — ${drillLabel}`}>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 620 }}>
                <thead><tr style={{ color: T.faint }} className="text-[11px] uppercase tracking-wide">
                  <th className="py-2 px-2 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>Rep</th>
                  <th className="py-2 px-2 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>Role</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Attended</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>ARIPs</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" style={{ borderBottom: `1px solid ${T.border}` }}>Attended → ARIP</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Deals Closed</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" style={{ borderBottom: `1px solid ${T.border}` }}>ARIP → Closed</th>
                </tr></thead>
                <tbody>{repConversion.map((r) => (
                  <tr key={r.rep} style={{ color: T.ink }}>
                    <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, fontWeight: 600, whiteSpace: "nowrap" }}>{r.rep}</td>
                    <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub }}>{r.role}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{r.attended.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{r.arips}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", fontWeight: 700, ...(heatBg(r.attToArip, maxAA, false) || {}) }}>{r.attToArip == null ? <span style={{ color: T.faint }}>—</span> : Math.round(r.attToArip * 100) + "%"}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{r.closed}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", fontWeight: 700, ...(heatBg(r.aripToClosed, maxAC, false) || {}) }}>{r.aripToClosed == null ? <span style={{ color: T.faint }}>—</span> : Math.round(r.aripToClosed * 100) + "%"}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] mt-3" style={{ color: T.faint }}>Two funnel conversions per rep. <b>Attended → ARIP</b> = the rep's ARIPs ÷ their attended appointments — how well they turn a met appointment into a signed contract. <b>ARIP → Closed</b> = deals closed ÷ ARIPs — how many signed deals actually close. Appointments are credited by role: <b>VPs</b> for appointments they <b>attended</b>, <b>AMs &amp; Follow-Ups</b> for appointments they <b>set</b>. Each count falls within the selected date range — <b>read this on This Quarter / This Year</b>; a one-month window is too thin to be meaningful. Scoped to <b>{drillLabel}</b>.</div>
          </Panel>);
      })()}
    </>) : isTxView ? (<>
      <CardGrid ids={cards.filter((id) => !TX_FLOW_TILES.includes(id))} results={results} breakouts={breakouts} sparks={sparks} />
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap px-1">
          <span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>Revenue moved into stage · record-type filters</span>
          <div className="flex gap-2">
            {[["Remove front-end", txRmFront, setTxRmFront], ["Remove back-end", txRmBack, setTxRmBack]].map(([label, on, set]) => (
              <button key={label} onClick={() => set((v) => !v)} className="text-[12px] font-medium px-3 py-1 rounded-md transition-colors whitespace-nowrap"
                style={{ background: on ? T.accentSoft : "transparent", color: on ? T.accent : T.sub, border: `1px solid ${on ? T.accent : T.border}` }}>{label}</button>))}
          </div>
        </div>
        <CardGrid ids={TX_FLOW_TILES} results={results} breakouts={breakouts} sparks={sparks} />
      </div>
    </>) : (
      <CardGrid ids={cards} results={results} breakouts={breakouts} sparks={sparks} />
    )}
    {isTxView ? (<>
      <Panel title={`Pipeline YTD · forecast by stage — ${drillLabel}`}>{byStage.length ? (<><div style={{ height: Math.max(300, byStage.length * 38) }}><ResponsiveContainer>
        <BarChart data={byStage} layout="vertical" margin={{ top: 0, right: 60, left: 10, bottom: 0 }} barCategoryGap={10}>
          <XAxis type="number" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: T.sub }} axisLine={false} tickLine={false} width={168} interval={0} />
          <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={T.accent} maxBarSize={22}><LabelList dataKey="value" position="right" formatter={(v) => "$" + Math.round(v / 1000) + "k"} style={{ fontSize: 11, fill: T.sub }} /></Bar>
        </BarChart></ResponsiveContainer></div>
        <div className="text-[11px] mt-2" style={{ color: T.faint }}>From the "YTD x Pipeline Forecast" report — Total Forecasted Revenue by stage (open + closed). Scoped to <b>{drillLabel}</b>.</div></>) : <div className="text-[13px] py-8 text-center" style={{ color: T.sub }}>No open pipeline for this scope in the selected period.</div>}
      </Panel>
      <Panel title={`Time between stages — ${drillLabel}`}>
        <div className="flex rounded-lg p-0.5 mb-3" style={{ background: T.track, border: `1px solid ${T.border}`, width: "fit-content" }}>
          {[["aripclose", "ARIP → Close"], ["bystage", "By stage"], ["byrep", "By rep"]].map(([v, l]) => (
            <button key={v} onClick={() => setTxTimeTab(v)} className="text-[12px] font-medium px-3 py-1 rounded-md transition-colors whitespace-nowrap"
              style={{ background: txTimeTab === v ? T.card : "transparent", color: txTimeTab === v ? T.ink : T.sub, boxShadow: txTimeTab === v ? "0 1px 2px rgba(0,0,0,0.06)" : "none" }}>{l}</button>))}
        </div>
        {txTimeTab === "aripclose" ? (<>
          {txMedians.length ? (<div className="flex flex-col gap-3 pt-1">
            {txMedians.map((x) => { const mx = Math.max(...txMedians.map((t) => t.value)) || 1; return (
              <div key={x.label} className="flex items-center gap-3">
                <div className="text-[15px] flex-1 min-w-0 truncate" style={{ color: T.ink }}>{x.label} <span style={{ color: T.faint }}>({x.closed} closed)</span></div>
                <div className="hidden sm:block flex-1 h-4 rounded-full overflow-hidden" style={{ background: T.track, maxWidth: 280 }}><div style={{ width: `${Math.round((x.value / mx) * 100)}%`, height: "100%", background: T.chart[1] }} /></div>
                <div className="text-[22px] sm:text-[26px] font-bold text-right shrink-0" style={{ fontVariantNumeric: "tabular-nums", color: T.ink }}>{Math.round(x.value)} <span className="text-[12px] font-normal" style={{ color: T.faint }}>days</span></div>
              </div>); })}
          </div>) : <div className="text-[13px] py-4 text-center" style={{ color: T.sub }}>No closed deals with an ARIP→Close duration for this scope yet.</div>}
          <div className="text-[11px] mt-4" style={{ color: T.faint }}>Median of "Duration ARIP to Closed" (days) across deals that <b>closed in the selected period</b>; still-open deals excluded. Scoped to <b>{drillLabel}</b>.</div>
        </>) : txTimeTab === "bystage" ? (<>
          {txStageMatrix.metrics.length ? (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 640 }}>
                <thead><tr style={{ color: T.faint }} className="text-[11px] uppercase tracking-wide">
                  <th className="py-2 px-2 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>Stage transition</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>All</th>
                  {txStageMatrix.types.map((t) => <th key={t} className="py-2 px-2 text-right whitespace-nowrap" style={{ borderBottom: `1px solid ${T.border}` }}>{t}</th>)}
                </tr></thead>
                <tbody>{txStageMatrix.metrics.map((m) => (
                  <tr key={m.id} style={{ color: T.ink }}>
                    <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, fontWeight: 600, whiteSpace: "nowrap" }}>{m.label}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{txDurCell(m.all)}</td>
                    {txStageMatrix.types.map((t) => (
                      <td key={t} className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{txDurCell(m.cells[t])}</td>))}
                  </tr>))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-[13px] py-4 text-center" style={{ color: T.sub }}>No closed deals with stage dates for this scope in the selected period.</div>}
          <div className="text-[11px] mt-3" style={{ color: T.faint }}>Each cell shows the <b>median</b> days between the two stage dates, with the <b>average</b> and deal count beneath, for deals that <b>closed in the selected period</b> (still-open deals excluded). Each metric is measured only over deals that have <b>both</b> stage dates populated, so the deal count varies by row. Scoped to <b>{drillLabel}</b>.</div>
        </>) : (<>
          {org.rep !== "All" ? (<div className="text-[13px] py-6 text-center" style={{ color: T.sub }}>Clear the Rep filter to <b>All reps</b> to compare time between stages per rep.</div>
          ) : (() => {
            const opts = TX_STAGE_DURATIONS.filter((m) => (txStageByRep.byTransition[m.id] || []).length);
            if (!opts.length) return <div className="text-[13px] py-4 text-center" style={{ color: T.sub }}>No closed deals with stage dates for this scope.</div>;
            const sel = opts.some((m) => m.id === txStageMetric) ? txStageMetric : opts[0].id;
            const reps = txStageByRep.byTransition[sel] || [];
            const selLabel = (TX_STAGE_DURATIONS.find((m) => m.id === sel) || {}).label;
            return (<>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>Transition</span>
                <select value={sel} onChange={(e) => setTxStageMetric(e.target.value)} className="text-sm rounded-md px-2.5 py-1.5 outline-none"
                  style={{ background: T.card, border: `1px solid ${T.border}`, color: T.ink }}>
                  {opts.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              {reps.length ? (
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                  <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 640 }}>
                    <thead><tr style={{ color: T.faint }} className="text-[11px] uppercase tracking-wide">
                      <th className="py-2 px-2 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>Rep</th>
                      <th className="py-2 px-2 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>Role</th>
                      <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>All</th>
                      {txStageByRep.types.map((t) => <th key={t} className="py-2 px-2 text-right whitespace-nowrap" style={{ borderBottom: `1px solid ${T.border}` }}>{t}</th>)}
                    </tr></thead>
                    <tbody>{reps.map((r) => (
                      <tr key={r.rep} style={{ color: T.ink }}>
                        <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, fontWeight: 600, whiteSpace: "nowrap" }}>{r.rep}</td>
                        <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, whiteSpace: "nowrap" }}>{r.role || "—"}</td>
                        <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{txDurCell(r.all)}</td>
                        {txStageByRep.types.map((t) => (
                          <td key={t} className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{txDurCell(r.cells[t])}</td>))}
                      </tr>))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-[13px] py-4 text-center" style={{ color: T.sub }}>No closed deals with these stage dates for this scope.</div>}
              <div className="text-[11px] mt-3" style={{ color: T.faint }}><b>{selLabel}</b> — median days (average &amp; deal count beneath) per rep, sorted fastest first, for deals that <b>closed in the selected period</b>. A deal is credited to everyone who touched it (owner/VP, AM &amp; follow-up), so a rep appears in every deal they were on. Pick another transition above. Scoped to <b>{drillLabel}</b>.</div>
            </>);
          })()}
        </>)}
      </Panel>
      <Panel title="Stage conversion & probability — how to read this">
        <ul className="flex flex-col gap-2 text-[12.5px] leading-snug" style={{ color: T.sub }}>
          <li><b style={{ color: T.ink }}>Resolved close rate</b> answers: of the deals that reached a stage, what share ended up closing? It counts only deals that have <i>finished playing out</i> — they either closed (a <b style={{ color: T.ink }}>Won</b>) or died / slid back to an earlier stage (a <b style={{ color: T.ink }}>Miss</b>). Deals still moving forward are set aside as <b style={{ color: T.ink }}>In-flight</b> and don't count yet. So "ARIP → Close 30%" means: of the ARIP deals that have resolved, 30% closed.</li>
          <li><b style={{ color: T.ink }}>Advance probability</b> answers: at each step, what share of deals made it to the next stage? Read top-to-bottom to see where deals fall out — the <b style={{ color: T.ink }}>lowest number is your biggest leak</b>. Switch between Close rate and Advance probability with the toggle on the panel.</li>
          <li><b style={{ color: T.ink }}>Forecast → Under Contract</b> (top-right) is the total forecasted revenue of deals that moved into Under Contract in the period — how much dollar value reached the contract stage.</li>
          <li>Every number is based on deals that <b style={{ color: T.ink }}>first entered a stage inside the date range selected up top</b>. A narrow range (like This Month) shows fewer deals — widen it for a fuller picture.</li>
        </ul>
      </Panel>
      <div className="flex items-center gap-3 flex-wrap px-1 -mt-1">
        <span className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>Record types</span>
        <div className="flex rounded-lg p-0.5" style={{ background: T.track, border: `1px solid ${T.border}` }}>
          {[["all", "All record types"], ["excl", "Exclude front-end"]].map(([v, l]) => {
            const active = (v === "excl") === txExclFlips;
            return (<button key={v} onClick={() => setTxExclFlips(v === "excl")} className="text-[12px] font-medium px-3 py-1 rounded-md transition-colors whitespace-nowrap"
              style={{ background: active ? T.card : "transparent", color: active ? T.ink : T.sub, boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none" }}>{l}</button>); })}
        </div>
        <span className="text-[11px]" style={{ color: T.faint }}>Deals that skip to Under Contract are assumed to have passed through Buyer ARIP.</span>
      </div>
      <Panel title={`Stage conversion — ${drillLabel}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex rounded-lg p-0.5" style={{ background: T.track, border: `1px solid ${T.border}` }}>
            {[["close", "Close rate"], ["advance", "Advance probability"]].map(([v, l]) => (
              <button key={v} onClick={() => setStageLens(v)} className="text-[12px] font-medium px-3 py-1 rounded-md transition-colors whitespace-nowrap"
                style={{ background: stageLens === v ? T.card : "transparent", color: stageLens === v ? T.ink : T.sub, boxShadow: stageLens === v ? "0 1px 2px rgba(0,0,0,0.06)" : "none" }}>{l}</button>))}
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide" style={{ color: T.faint }}>Forecast → Under Contract</div>
            <div className="text-[18px] font-bold leading-none" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{fmt(ucForecast.total, "currency")} <span className="text-[11px] font-normal" style={{ color: T.faint }}>· {ucForecast.n} {ucForecast.n === 1 ? "deal" : "deals"}</span></div>
          </div>
        </div>
        {stageLens === "close" ? (<>
          {stageConv.A.length ? (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 560 }}>
                <thead><tr style={{ color: T.faint }} className="text-[11px] uppercase tracking-wide">
                  <th className="py-2 px-2 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>Stage → Close</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Cohort</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Won</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Miss</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>In-flight</th>
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Close %</th>
                </tr></thead>
                <tbody>{stageConv.A.map((m) => (
                  <tr key={m.id} style={{ color: T.ink }}>
                    <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, fontWeight: 600, whiteSpace: "nowrap" }}>{m.label}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{m.cohort}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{m.win}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{m.miss}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.faint, fontVariantNumeric: "tabular-nums" }}>{m.inflight}</td>
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", fontWeight: 700, ...(heatBg(m.rate, 1, false) || {}) }}>{m.rate == null ? "—" : Math.round(m.rate * 100) + "%"}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-[13px] py-4 text-center" style={{ color: T.sub }}>No opps entered these stages in the selected period for this scope.</div>}
          <div className="text-[11px] mt-3" style={{ color: T.faint }}><b>Close %</b> = Won ÷ (Won + Miss) — resolved deals only. <b>In-flight</b> deals (currently at or ahead of the entry stage) are excluded from the %; a deal that reverted below where it entered, or is Dead, is a <b>Miss</b>. Closed Won / With Escrow / in Accounting Reconciliation all count as Won. Cohort = opps that <b>entered</b> the stage in the selected period (anchored on first entry). Widen the date range for fuller cohorts. Scoped to <b>{drillLabel}</b>.</div>
        </>) : (<>
          {stageConv.B.length ? (<div className="flex flex-col gap-3 pt-1">
            {stageConv.B.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <div className="text-[14px] flex-1 min-w-0 truncate" style={{ color: T.ink }}>{s.from} → {s.to} <span style={{ color: T.faint }}>({s.adv}/{s.base})</span></div>
                <div className="hidden sm:block flex-1 h-3 rounded-full overflow-hidden" style={{ background: T.track, maxWidth: 260 }}><div style={{ width: `${Math.round((s.rate || 0) * 100)}%`, height: "100%", background: T.chart[1] }} /></div>
                <div className="text-[18px] font-bold text-right shrink-0" style={{ width: 64, fontVariantNumeric: "tabular-nums", color: T.ink }}>{s.rate == null ? "—" : Math.round(s.rate * 100) + "%"}</div>
              </div>))}
          </div>) : <div className="text-[13px] py-4 text-center" style={{ color: T.sub }}>No opps entered these stages in the selected period for this scope.</div>}
          <div className="text-[11px] mt-3" style={{ color: T.faint }}>Of opps that reached each stage, the share that <b>ever reached the next core stage</b> (advancing or beyond) — the step-by-step probability of moving down the funnel. Anchored on entries in the selected period. Scoped to <b>{drillLabel}</b>.</div>
        </>)}
      </Panel>
      {(() => { const maxAdv = Math.max(0.0001, ...stageFlowData.map((s) => s.advPct || 0));
        const anyFlow = stageFlowData.some((s) => s.entered || s.left);
        return (
      <Panel title={`Stage flow this period · movement & leaks — ${drillLabel}`}>
        {anyFlow ? (
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 600 }}>
              <thead><tr style={{ color: T.faint }} className="text-[11px] uppercase tracking-wide">
                <th className="py-2 px-2 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>Stage</th>
                <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Entered</th>
                <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Left</th>
                <th className="py-2 px-2 text-right whitespace-nowrap" style={{ borderBottom: `1px solid ${T.border}` }}>Advanced</th>
                <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Reverted</th>
                <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Dead</th>
              </tr></thead>
              <tbody>{stageFlowData.map((s) => (
                <tr key={s.stage} style={{ color: T.ink }}>
                  <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, fontWeight: 600, whiteSpace: "nowrap" }}>{s.label}</td>
                  <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{s.entered}</td>
                  <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{s.left}</td>
                  <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", fontWeight: 700, ...(heatBg(s.advPct, maxAdv, false) || {}) }}>{s.left ? <>{s.adv}<span className="text-[10px]" style={{ color: T.faint }}> · {Math.round(s.advPct * 100)}%</span></> : <span style={{ color: T.faint }}>—</span>}</td>
                  <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", color: s.rev ? T.warn : T.faint }}>{s.left ? <>{s.rev}<span className="text-[10px]" style={{ color: T.faint }}> · {Math.round(s.revPct * 100)}%</span></> : "—"}</td>
                  <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", color: s.dead ? T.bad : T.faint }}>{s.left ? <>{s.dead}<span className="text-[10px]" style={{ color: T.faint }}> · {Math.round(s.deadPct * 100)}%</span></> : "—"}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        ) : <div className="text-[13px] py-4 text-center" style={{ color: T.sub }}>No stage movement in the selected period for this scope.</div>}
        <div className="text-[11px] mt-3" style={{ color: T.faint }}>This is <b>movement during the selected period</b>, not outcomes — so it reads cleanly on any window, even This Month. <b>Entered</b> = deals that moved into the stage; <b>Left</b> = deals that moved out. Of those that left: <b>Advanced</b> = moved forward or closed; <b>Reverted</b> = slipped back to an earlier stage; <b>Dead</b> = died. The stage with the highest Reverted/Dead is where deals are leaking <b>right now</b>. Counts stage transitions dated in the window. Scoped to <b>{drillLabel}</b>.</div>
      </Panel>); })()}
      <Panel title={`Transaction summary — ${drillLabel}`}>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr style={{ color: T.faint, textAlign: "right" }}>
            {["Transaction type", "Deals", "Open", "Closed", "Forecasted rev", "Net rev", "Avg (forecast)", "% deals", "% rev"].map((h, i) => (
              <th key={h} className="py-2 px-2 px-2" style={{ textAlign: i === 0 ? "left" : "right", borderBottom: `1px solid ${T.border}` }}>{h}</th>))}
          </tr></thead>
          <tbody>
            {txByType.rows.map((x) => (
              <tr key={x.type} style={{ color: T.ink }}>
                <td className="py-2 px-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{x.type}</td>
                <td className="py-2 px-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{x.deals}</td>
                <td className="py-2 px-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{x.open}</td>
                <td className="py-2 px-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{x.closed}</td>
                <td className="py-2 px-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{fmt(x.forecast, "currency")}</td>
                <td className="py-2 px-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{fmt(x.net, "currency")}</td>
                <td className="py-2 px-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums" }}>{fmt(x.avg, "currency")}</td>
                <td className="py-2 px-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{(x.pctDeals * 100).toFixed(0)}%</td>
                <td className="py-2 px-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, color: T.sub, fontVariantNumeric: "tabular-nums" }}>{(x.pctFc * 100).toFixed(0)}%</td>
              </tr>))}
            <tr style={{ color: T.ink, fontWeight: 700 }}>
              <td className="py-2 px-2 px-2">Total</td>
              <td className="py-2 px-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{txByType.totals.deals}</td>
              <td className="py-2 px-2 px-2 text-right" style={{ color: T.sub, fontVariantNumeric: "tabular-nums" }}>{txByType.rows.reduce((s, x) => s + x.open, 0)}</td>
              <td className="py-2 px-2 px-2 text-right" style={{ color: T.sub, fontVariantNumeric: "tabular-nums" }}>{txByType.rows.reduce((s, x) => s + x.closed, 0)}</td>
              <td className="py-2 px-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(txByType.totals.forecast, "currency")}</td>
              <td className="py-2 px-2 px-2 text-right" style={{ color: T.sub, fontVariantNumeric: "tabular-nums" }}>{fmt(txByType.totals.net, "currency")}</td>
              <td className="py-2 px-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(txByType.totals.avg, "currency")}</td>
              <td className="py-2 px-2 px-2 text-right" style={{ color: T.sub }}>100%</td>
              <td className="py-2 px-2 px-2 text-right" style={{ color: T.sub }}>100%</td>
            </tr>
          </tbody>
        </table></div>
        <div className="text-[11px] mt-3" style={{ color: T.faint }}>Deals with a <b>Close Date in the selected period</b>. Revenue uses <b>Total Forecasted Revenue</b>. Scoped to <b>{drillLabel}</b> — a single <b>rep</b> filter narrows this; team filters touch most deals (each has both an AM and a VP).</div>
      </Panel>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Panel title={`Deals by transaction type — ${drillLabel}`}><div style={{ height: 190 }}><ResponsiveContainer>
          <BarChart data={txByType.rows.map((x) => ({ label: x.type, value: x.deals }))} layout="vertical" margin={{ top: 0, right: 32, left: 10, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10, fill: T.faint }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: T.sub }} axisLine={false} tickLine={false} width={120} />
            <Tooltip cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}><LabelList dataKey="value" position="right" style={{ fontSize: 10, fill: T.sub }} />{txByType.rows.map((_, i) => <Cell key={i} fill={T.chart[i % T.chart.length]} />)}</Bar>
          </BarChart></ResponsiveContainer></div></Panel>
        <Panel title={`Forecasted revenue by transaction type — ${drillLabel}`}><div style={{ height: 190 }}><ResponsiveContainer>
          <BarChart data={txByType.rows.map((x) => ({ label: x.type, value: x.forecast }))} layout="vertical" margin={{ top: 0, right: 44, left: 10, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: T.sub }} axisLine={false} tickLine={false} width={120} />
            <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}><LabelList dataKey="value" position="right" formatter={(v) => "$" + Math.round(v / 1000) + "k"} style={{ fontSize: 9, fill: T.sub }} />{txByType.rows.map((_, i) => <Cell key={i} fill={T.accent} />)}</Bar>
          </BarChart></ResponsiveContainer></div></Panel>
      </div>
    </>) : isMktView ? (<>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Panel title="Leads by source"><Bars items={mktLeadsBySource.items} /></Panel>
        <Panel title="Leads by marketing segmentation"><Bars items={mktLeadsBySegment.items} tint={T.chart[1]} /></Panel>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Panel title="Opps created by source"><Bars items={mktOppsBySource.items} tint={T.chart[3]} /></Panel>
        <Panel title={`Opps created % by segment — ${drillLabel}`}><SegPctBars data={oppsSegPct} noun="opps" /></Panel>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Panel title={`Appts created by source — ${drillLabel}`}>{apptsSegBySource.items.length ? <Bars items={apptsSegBySource.items} tint={T.chart[2]} /> : <div className="text-[13px] py-4 text-center" style={{ color: T.sub }}>No appointments for this scope.</div>}</Panel>
        <Panel title={`Appts created % by segment — ${drillLabel}`}><SegPctBars data={apptsSegBySegment} noun="appts" /></Panel>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Panel title={`Forecasted pipeline by channel — ${drillLabel}`}>{mktPipeByChannel.length ? <MoneyBars items={mktPipeByChannel} tint={T.accent} fmtVal={(v) => fmt(v, "currency")} /> : <div className="text-[13px] py-4 text-center" style={{ color: T.sub }}>No open pipeline for this scope.</div>}</Panel>
        <Panel title={`Closed revenue by channel — ${drillLabel}`}>{mktClosedByChannel.length ? <MoneyBars items={mktClosedByChannel} tint={T.good} fmtVal={(v) => fmt(v, "currency")} /> : <div className="text-[13px] py-4 text-center" style={{ color: T.sub }}>No closed revenue for this scope.</div>}</Panel>
      </div>
      <Panel title="ICP score → funnel stage — company">
        {icpFunnel.rows.length ? (() => {
          const cols = ICP_FUNNEL_STAGES;
          const maxOf = {}; cols.forEach((c) => { maxOf[c.key] = Math.max(1, ...icpFunnel.rows.map((r) => r[c.key])); });
          return (<>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 560 }}>
                <thead><tr style={{ color: T.faint }} className="text-[11px] uppercase tracking-wide">
                  <th className="py-2 px-2 text-left" style={{ borderBottom: `1px solid ${T.border}` }}>ICP score</th>
                  {cols.map((c) => <th key={c.key} className="py-2 px-2 text-right whitespace-nowrap" style={{ borderBottom: `1px solid ${T.border}` }}>{c.label}</th>)}
                  <th className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}` }}>Total</th>
                </tr></thead>
                <tbody>{icpFunnel.rows.map((r) => (
                  <tr key={r.key} style={{ color: T.ink }}>
                    <td className="py-2 px-2" style={{ borderBottom: `1px solid ${T.border}`, fontWeight: 600, whiteSpace: "nowrap", color: r.key === "__ns" ? T.faint : T.ink }}>{r.label}</td>
                    {cols.map((c) => (
                      <td key={c.key} className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", ...(heatBg(r[c.key], maxOf[c.key], false) || {}) }}>{r[c.key] ? r[c.key].toLocaleString() : <span style={{ color: T.faint }}>—</span>}</td>))}
                    <td className="py-2 px-2 text-right" style={{ borderBottom: `1px solid ${T.border}`, fontVariantNumeric: "tabular-nums", color: T.sub, fontWeight: 600 }}>{r.total.toLocaleString()}</td>
                  </tr>))}
                  <tr style={{ color: T.ink, fontWeight: 700 }}>
                    <td className="py-2 px-2">Total</td>
                    {cols.map((c) => <td key={c.key} className="py-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{icpFunnel.totals[c.key].toLocaleString()}</td>)}
                    <td className="py-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{icpFunnel.totals.total.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="text-[11px] mt-3" style={{ color: T.faint }}>Each cell = opportunities that <b>reached that stage within the selected period</b> (Closed = confirmed won with a close date in the window), split by <b>ISA ICP Total Score</b>. ISA ICP is joined from the Opportunities workbook by Opportunity ID — stage history carries no ICP{icpFunnel.coverage != null ? <> · <b>{Math.round(icpFunnel.coverage * 100)}%</b> of these opps carry a synced ICP</> : null}. The <b>Unscored</b> row is opps with no ICP yet. Company-wide; moves with the Period filter.</div>
          </>);
        })() : <div className="text-[13px] py-8 text-center" style={{ color: T.sub }}>No opportunities reached these stages in the selected period.</div>}
      </Panel>
      <Panel title="Marketing view">
        <div className="text-[12px]" style={{ color: T.sub }}>Company-level lead-funnel metrics — leads and opps carry no individual rep, so only the Period filter applies. "Avg Lead ICP" is the mean Total Tier 1 ICP (0–7) across leads in the period. Spend/CPL isn't in the current sync, so cost-per-lead and ROAS aren't available yet.</div>
      </Panel>
    </>) : (<>
    <Panel collapsible title="Appointments">
      <div className="flex rounded-lg p-0.5 mb-3" style={{ background: T.track, border: `1px solid ${T.border}`, width: "fit-content" }}>
        {[["showrate", "Show Rate"], ["funnel", "Appt → ARIP"], ["outcomes", "Outcomes"], ["breakout", "Breakout"]].map(([v, l]) => (
          <button key={v} onClick={() => setApptTab(v)} className="text-[12px] font-medium px-3 py-1 rounded-md transition-colors whitespace-nowrap"
            style={{ background: apptTab === v ? T.card : "transparent", color: apptTab === v ? T.ink : T.sub, boxShadow: apptTab === v ? "0 1px 2px rgba(0,0,0,0.06)" : "none" }}>{l}</button>))}
      </div>
      {apptTab === "showrate" ? (<>
        <div className="text-[11px] mb-3" style={{ color: T.faint }}>Setters (AMs) are scored on the appointments they <b>set</b> that were met, broken out per closer; VPs on appointments <b>assigned</b> to them, broken out per setter. On the All view both groups are shown side by side.</div>
        <ApptRoleSection store={store} dir={dir} org={org} range={range} part="rate" />
      </>) : apptTab === "funnel" ? (<>
        <Bars items={apptFunnel.items} tint={T.chart[2]} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3" style={{ borderTop: `1px solid ${T.border}` }}>
          {[["Appts set", apptFunnel.appts.toLocaleString()], ["Unique opps", apptFunnel.uniqueOpps.toLocaleString()], ["ARIPs (in period)", apptFunnel.arips.toLocaleString()], ["Appt → ARIP", (apptFunnel.conv * 100).toFixed(1) + "%"]].map(([l, v]) => (
            <div key={l}><div className="text-[11px] uppercase tracking-wide" style={{ color: T.faint }}>{l}</div>
              <div className="text-[22px] font-bold leading-tight" style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{v}</div></div>))}
        </div>
        <div className="text-[11px] mt-2" style={{ color: T.faint }}>Scoped to <b>{drillLabel}</b>. {apptFunnel.dated ? <>Appts respect the period by <b>appointment Created Date</b>; ARIPs by <b>Arip Date</b>.</> : "Appointments carry no date in the export, so appt counts are all-time; ARIPs respect the selected period."}</div>
      </>) : apptTab === "outcomes" ? (<>
        <div className="text-[11px] mb-3" style={{ color: T.faint }}>{outcomeMix.total.toLocaleString()} appointments · Created Date in the selected period</div>
        <div className="flex flex-col gap-2">{outcomeMix.items.map((o) => (
          <div key={o.label} className="flex items-center gap-3">
            <div className="text-[12px] shrink-0" style={{ width: 150, color: T.sub }}>{o.label}</div>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: T.track }}><div style={{ width: `${Math.round(o.pct * 100)}%`, height: "100%", background: /met/i.test(o.label) ? T.good : /no show|missed/i.test(o.label) ? T.bad : T.chart[3] }} /></div>
            <div className="text-[12px] text-right shrink-0" style={{ width: 110, fontVariantNumeric: "tabular-nums", color: T.ink }}>{o.count.toLocaleString()} · {(o.pct * 100).toFixed(1)}%</div>
          </div>))}</div>
      </>) : (<div className="flex flex-col gap-4">
        <SubHead label="Avg ICP per appointment set" note={`ISA ICP Total Score · scored appts · Created Date in period${apptIcp.overall != null ? ` · overall ${apptIcp.overall.toFixed(1)}` : ""}`} />
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: T.card, border: `1px solid ${T.border}` }}>
            <span className="text-[12px] font-medium" style={{ color: T.sub }}>By appointment type</span>
            <AvgIcpBars items={apptIcp.byType} />
          </div>
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: T.card, border: `1px solid ${T.border}` }}>
            <span className="text-[12px] font-medium" style={{ color: T.sub }}>By subject</span>
            <AvgIcpBars items={apptIcp.bySubject} />
          </div>
        </div>
        <ApptRoleSection store={store} dir={dir} org={org} range={range} part="breakout" />
      </div>
      )}
    </Panel>
    {(
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <Panel collapsible title={`Deals · Close Date × Projected Rev — ${drillLabel}`}><div style={{ height: 260 }}><ResponsiveContainer>
        <BarChart data={byCloseMonth} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.track} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} width={48} />
          <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}><LabelList dataKey="value" position="top" formatter={(v) => "$" + Math.round(v / 1000) + "k"} style={{ fontSize: 10, fill: T.sub }} />{byCloseMonth.map((d, i) => <Cell key={i} fill={T.accent} />)}</Bar>
        </BarChart></ResponsiveContainer></div></Panel>
      <Panel collapsible title={`Deals · Stage × Projected Rev — ${drillLabel}`}><div style={{ height: 260 }}><ResponsiveContainer>
        <BarChart data={byStage} layout="vertical" margin={{ top: 0, right: 44, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.track} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: T.sub }} axisLine={false} tickLine={false} width={132} />
          <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}><LabelList dataKey="value" position="right" formatter={(v) => "$" + Math.round(v / 1000) + "k"} style={{ fontSize: 10, fill: T.sub }} />{byStage.map((_, i) => <Cell key={i} fill={T.chart[i % T.chart.length]} />)}</Bar>
        </BarChart></ResponsiveContainer></div></Panel>
    </div>
    )}
    <Panel collapsible title={`Closed revenue by month — ${drillLabel} (Total Forecasted Revenue · YTD)`}><div style={{ height: 200 }}><ResponsiveContainer>
      <BarChart data={byMonth} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={T.track} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: T.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} width={48} />
        <Tooltip formatter={(v) => fmt(v, "currency")} cursor={{ fill: T.track }} contentStyle={{ border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>{byMonth.map((d, i) => <Cell key={i} fill={d.value < 0 ? T.bad : T.good} />)}</Bar>
      </BarChart></ResponsiveContainer></div></Panel>
    <Panel collapsible title={`Team leaderboard (closed revenue) — ${drillLabel}`}>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 520 }}>
        <thead><tr style={{ color: T.faint }} className="text-left text-[11px] uppercase tracking-wide">
          <th className="pb-2 px-2 whitespace-nowrap font-medium">Rep</th><th className="pb-2 px-2 whitespace-nowrap font-medium">Team</th>
          <th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Closed Revenue</th><th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Deals</th><th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Avg Deal</th></tr></thead>
        <tbody>{leaderboard.length ? (() => { const mRev = Math.max(0, ...leaderboard.map((r) => r.rev)), mDeals = Math.max(0, ...leaderboard.map((r) => r.deals)); return leaderboard.map((row) => (<tr key={row.owner} style={{ borderTop: `1px solid ${T.border}`, color: T.ink }}>
          <td className="py-2 px-2 font-medium">{row.owner}</td><td className="py-2 px-2" style={{ color: T.sub }}>{row.team || "—"}</td>
          <td className="py-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums", color: row.rev < 0 ? T.bad : T.ink, ...heatBg(row.rev, mRev) }}>{fmt(row.rev, "currency")}</td>
          <td className="py-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums", ...heatBg(row.deals, mDeals) }}>{row.deals}</td>
          <td className="py-2 px-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(row.avg, "currency")}</td></tr>)); })()
          : (<tr><td colSpan={5} className="py-4 text-center text-[13px]" style={{ color: T.sub }}>No closed deals in this scope.</td></tr>)}</tbody>
      </table></div></Panel>
    <Panel collapsible title="Rep scorecard">
      <div className="text-[11px] mb-3" style={{ color: T.faint }}>Show Rate is role-aware — VPs &amp; closers (anyone who runs appointments) are scored on appointments attended ÷ appointments assigned to them; setters on appointments they set that were met ÷ appointments they set. The Attended column follows the same rule. Both AMs and VPs are listed. <span style={{ opacity: 0.8 }}>Cell shading is relative to the column high (Opps Deaded inverted — fewer is greener).</span></div>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 1080 }}>
        <thead><tr style={{ color: T.faint }} className="text-left text-[11px] uppercase tracking-wide">
          <th className="pb-2 px-2 whitespace-nowrap font-medium">Rep</th><th className="pb-2 px-2 whitespace-nowrap font-medium">Role</th>
          <th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Opps Created</th><th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Opps→ARIP</th><th className="pb-2 px-2 whitespace-nowrap font-medium text-right">ARIP→Review</th><th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Opps Assigned</th><th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Opps Deaded</th><th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Talk Time</th>
          <th className="pb-2 px-2 whitespace-nowrap font-medium text-right">QCs</th><th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Appts Set</th>
          <th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Attended</th><th className="pb-2 px-2 whitespace-nowrap font-medium text-right">Show Rate</th></tr></thead>
        <tbody>{(() => { const mx = (k) => Math.max(0, ...scorecard.map((r) => r[k] || 0)); const M = { oppsCreated: mx("oppsCreated"), oppsArip: mx("oppsArip"), aripReview: mx("aripReview"), oppsAssigned: mx("oppsAssigned"), oppsDeaded: mx("oppsDeaded"), minutes: mx("minutes"), qcs: mx("qcs"), apptsSet: mx("apptsSet"), shownAttended: mx("shownAttended"), rate: Math.max(0, ...scorecard.map((r) => r.rate || 0)) };
          const R = "py-2 px-2 text-right"; return scorecard.map((row) => (<tr key={row.rep} style={{ borderTop: `1px solid ${T.border}`, color: T.ink }}>
          <td className="py-2 px-2 font-medium">{row.rep}</td>
          <td className="py-2 px-2" style={{ color: T.sub }}>{row.role || "—"}</td>
          <td className={R} style={{ fontVariantNumeric: "tabular-nums", ...heatBg(row.oppsCreated, M.oppsCreated) }}>{row.oppsCreated.toLocaleString()}</td>
          <td className={R} style={{ fontVariantNumeric: "tabular-nums", ...heatBg(row.oppsArip, M.oppsArip) }}>{row.oppsArip.toLocaleString()}</td>
          <td className={R} style={{ fontVariantNumeric: "tabular-nums", ...heatBg(row.aripReview, M.aripReview) }}>{row.aripReview.toLocaleString()}</td>
          <td className={R} style={{ fontVariantNumeric: "tabular-nums", ...heatBg(row.oppsAssigned, M.oppsAssigned) }}>{row.oppsAssigned.toLocaleString()}</td>
          <td className={R} style={{ fontVariantNumeric: "tabular-nums", ...heatBg(row.oppsDeaded, M.oppsDeaded, true) }}>{row.oppsDeaded.toLocaleString()}</td>
          <td className={R} style={{ fontVariantNumeric: "tabular-nums", ...heatBg(row.minutes, M.minutes) }}>{fmt(row.minutes, "minutes")}</td>
          <td className={R} style={{ fontVariantNumeric: "tabular-nums", ...heatBg(row.qcs, M.qcs) }}>{row.qcs.toLocaleString()}</td>
          <td className={R} style={{ fontVariantNumeric: "tabular-nums", ...heatBg(row.apptsSet, M.apptsSet) }}>{row.apptsSet.toLocaleString()}</td>
          <td className={R} style={{ fontVariantNumeric: "tabular-nums", ...heatBg(row.shownAttended, M.shownAttended) }}>{row.shownAttended.toLocaleString()}</td>
          <td className={R} style={{ fontVariantNumeric: "tabular-nums", color: row.rate == null ? T.faint : T.ink, ...(row.rate == null ? {} : heatBg(row.rate, M.rate)) }}>{row.rate == null ? "—" : fmt(row.rate, "percent")}</td></tr>)); })()}</tbody>
      </table></div></Panel>
    </>)}
  </div>);
}

function LoadingScreen({ progress }) {
  const total = progress && progress.total ? progress.total : 0;
  const done = progress && progress.done ? progress.done : 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const label = (progress && progress.label) || "";
  const phase = !total ? "Connecting to Google Sheets" : pct >= 100 ? "Assembling your dashboard" : `Reading ${label || "workbooks"}`;
  return (
    <div className="flex flex-col items-center justify-center gap-7" style={{ minHeight: "60vh" }}>
      <style>{`@keyframes lhShimmer{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}@keyframes lhPulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
      <div className="flex flex-col items-center gap-1">
        <div className="text-[14px] font-semibold" style={{ color: T.ink }}>Loading your dashboard</div>
        <div className="text-[12px]" style={{ color: T.faint, animation: "lhPulse 1.6s ease-in-out infinite" }}>{phase}…</div>
      </div>
      <div className="text-[52px] font-bold leading-none tracking-tight" style={{ color: T.accent, fontVariantNumeric: "tabular-nums" }}>{pct}%</div>
      <div style={{ width: "min(560px, 82vw)" }}>
        <div className="rounded-full overflow-hidden" style={{ height: 12, background: T.track }}>
          <div className="h-full rounded-full relative overflow-hidden" style={{ width: `${Math.max(5, pct)}%`, background: T.accent, transition: "width .5s cubic-bezier(.4,0,.2,1)" }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent)", animation: "lhShimmer 1.4s linear infinite" }} />
          </div>
        </div>
        <div className="flex items-center justify-between mt-2.5">
          <span className="text-[12px]" style={{ color: T.sub }}>{total ? `Reading ${label}…` : "Starting up…"}</span>
          <span className="text-[12px]" style={{ color: T.faint, fontVariantNumeric: "tabular-nums" }}>{total ? `${done} of ${total} sources` : ""}</span>
        </div>
      </div>
    </div>);
}

// Embed mode — a headless-screenshot target for the hourly Slack ping. `?view=stl-embed`
// renders only the Speed-to-Lead hero cards on a plain background at fixed width, period pinned
// via `&period=` (default today), with no nav / filters / notes / footer. Generic on purpose:
// any other tile can get its own embed later by adding a branch here and in the embed return.
function readEmbed() {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  if (p.get("view") !== "stl-embed") return null;
  return { tile: "stl", period: p.get("period") || "today" };
}

export default function App() {
  const embed = readEmbed();
  const [st, setSt] = useState({ loading: true, error: null, store: null, dir: null, diagnostics: [], mode: "mock", progress: { done: 0, total: 0, label: "" } });
  const [org, setOrg] = useState({ company: "All", department: "All", team: "All", role: "All", rep: "All" });
  const [view, setView] = useState("sales");
  const [mode, setMode] = useState(() => embed ? "light" : ((typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"));
  T = THEMES[mode];
  const [density, setDensity] = useState("comfortable");
  D = DENSITIES[density] || DENSITIES.comfortable;
  const [date, setDate] = useState({ preset: embed ? embed.period : "this_month", start: "2026-01-01", end: iso(new Date()) });
  const range = useMemo(() => resolveRange(date.preset, date, new Date()), [date]);
  const rangeFwd = useMemo(() => resolveRange(date.preset, date, new Date(), true), [date]); // pipeline forecast spans the full selected period (deals close in the future)

  useEffect(() => { let alive = true;
    (async () => { try { const { store, diagnostics, mode } = await loadAll((p) => { if (alive) setSt((s) => ({ ...s, progress: p })); });
      if (alive) { const dir = buildDirectory(store); tagApptRoles(store, dir); setSt({ loading: false, error: null, store, dir, diagnostics, mode }); } }
      catch (e) { if (alive) setSt((s) => ({ ...s, loading: false, error: String(e.message || e) })); } })();
    return () => { alive = false; }; }, []);

  // Self-labeling subtitle: show the active rep/team scope so a printed/exported page is unambiguous.
  // Marketing & Speed-to-Lead ignore Team/Rep (company-wide), so we don't show a rep scope there.
  const scopeText = viewUsesRepFilter(view)
    ? (org.rep !== "All" ? org.rep : org.team !== "All" ? org.team : "All reps")
    : "Company";
  const periodText = (DATE_PRESETS.find(([v]) => v === date.preset) || [null, date.preset])[1];
  const shell = (body) => (<div className="min-h-screen w-full" style={{ background: T.canvas, ...FONT }}>
    <div className="px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${T.border}`, background: T.card }}>
      <div className="flex items-center gap-3"><div className="w-2 h-6 rounded-sm" style={{ background: T.accent }} />
        <div><div className="text-[15px] font-semibold" style={{ color: T.ink }}>Leverage Homes</div><div className="text-[11px]" style={{ color: T.faint }}>Executive Dashboard · <span style={{ color: T.sub }}>{scopeText}</span> · {periodText}</div></div></div>
      <div className="text-[11px] flex items-center gap-2" style={{ color: T.faint }}>
        <span className="px-2 py-0.5 rounded-full" style={{ background: st.mode === "google" ? T.accentSoft : T.track, color: st.mode === "google" ? T.good : T.sub }}>{st.mode === "google" ? "Live · Google Sheets" : "Sample data"}</span>
        <span className="hidden sm:inline">{iso(range.start)} → {iso(range.end)}</span>
        <button onClick={() => setDensity((d) => d === "compact" ? "comfortable" : "compact")} title={density === "compact" ? "Comfortable spacing" : "Compact spacing"}
          className="flex items-center justify-center rounded-md" style={{ height: 26, padding: "0 8px", border: `1px solid ${T.border}`, color: T.sub, background: T.card, fontSize: 11, fontWeight: 600 }}>{density === "compact" ? "Compact" : "Cozy"}</button>
        <ThemeToggle mode={mode} setMode={setMode} /></div></div>
    <div className="p-3 sm:p-6 max-w-[1200px] mx-auto" style={{ overflowX: "clip" }}>{body}</div></div>);

  // Bare screenshot surface: no chrome, fixed width, plain canvas background. Puppeteer waits for
  // #stl-embed-ready to appear (data loaded) then captures #stl-embed-root.
  if (embed) return (
    <div id="stl-embed-root" style={{ width: 1200, background: T.canvas, ...FONT, padding: 24, boxSizing: "border-box" }}>
      {st.loading
        ? <div id="stl-embed-loading" style={{ height: 220 }} />
        : st.error
          ? <div id="stl-embed-error" style={{ color: T.bad, fontSize: 13 }}>{st.error}</div>
          : <div id="stl-embed-ready">{embed.tile === "stl" && <SpeedToLeadView store={st.store} range={range} />}</div>}
    </div>
  );

  if (st.loading) return shell(<LoadingScreen progress={st.progress} />);
  if (st.error) return shell(<div className="rounded-xl p-4 text-sm" style={{ background: T.warnSoft, border: `1px solid ${T.warn}33`, color: T.ink }}>
    <div className="font-semibold mb-1" style={{ color: T.warn }}>Couldn’t load Google Sheets</div><div style={{ color: T.sub }}>{st.error}</div>
    <div className="mt-2" style={{ color: T.faint }}>Check the API key, that the Sheets API is enabled, and each workbook is shared “Anyone with the link → Viewer.”</div></div>);

  return shell(<>
    <div className="pb-2" style={{ position: "sticky", top: 0, zIndex: 30, background: T.canvas }}>
      <ViewToggle view={view} setView={setView} />
      <FilterBar org={org} setOrg={setOrg} date={date} setDate={setDate} dir={st.dir} view={view} />
    </div>
    <ExecutiveDashboard store={st.store} dir={st.dir} org={org} range={range} rangeFwd={rangeFwd} view={view} />
    <Notes diagnostics={st.diagnostics} mode={st.mode} freshness={st.store ? dataFreshness(st.store) : []} />
    <p className="text-[11px] mt-5" style={{ color: T.faint }}>Phase 3 · auto-tab-union model · {st.mode === "google" ? "live Sheets via public API key" : "sample data (set API_KEY to go live)"} · build 2026-09-01 · v2-features-r37 (Marketing ICP funnel: ISA ICP lookup now unions opps_created + arip_entered + arip_out + mkt_opps by Opportunity ID — first non-blank wins — so long-cycle opps get scored instead of landing in Unscored; no Sheets column changes)</p>
  </>);
}
