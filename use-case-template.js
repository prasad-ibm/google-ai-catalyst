'use strict';

/*
 * Use-case bulk-upload CSV template.
 *
 * Defines the canonical column set for the downloadable template and the 5
 * existing Intel use cases as example rows. Columns map to the use_cases table
 * identity fields plus the flat intake keys that server.js `mapUseCaseContexts()`
 * groups into the business_context / current_state / technical_context /
 * risk_compliance jsonb blobs — so a row authored from this template round-trips
 * straight through POST /api/use-cases (and the bulk-upload endpoint that reuses
 * the same field mapping).
 *
 * Example values are drawn faithfully from scripts/seed-intel.js.
 */

// Column order = CSV column order. `workspace_id` is intentionally NOT a
// template column: the bulk endpoint / import modal supplies it out-of-band
// (batch workspace_id or ?workspace_id=), so a blank per-row column was dead
// weight that only confused hand-editors. `stage` defaults to 'intake'.
const TEMPLATE_COLUMNS = [
  // use_cases identity
  'name',
  'department',
  'executive_sponsor',
  'submitted_by',
  'contact_email',
  'description',
  // business_context
  'driver',
  'value',
  'users',
  'align',
  'justif',
  // current_state
  'maturity',
  'spend',
  'volume',
  'pain',
  'tools',
  // technical_context
  'sources',
  'dataavail',
  'integrations',
  'realtime',
  'technotes',
  // risk_compliance
  'sensitivity',
  'autonomy',
  'pii',
  'audit',
  'adoption',
  'change',
  'delivery',
  'addnotes',
  // lifecycle
  'stage',
  // v2 lifecycle columns:
  //   status       = 'active' (in-pipeline, default) or 'completed' (delivered)
  //   delivered_at = YYYY-MM-DD delivery date; only meaningful when completed
  'status',
  'delivered_at',
];

// The 5 Intel use cases, mapped from scripts/seed-intel.js into the flat
// template columns. Every column is populated so the file doubles as a guide.
const TEMPLATE_ROWS = [
  {
    name: 'AskHR',
    department: 'HR',
    executive_sponsor: 'CHRO',
    submitted_by: 'HR Digital Team',
    contact_email: 'askhr@intel.com',
    description: 'Conversational AI self-service for HR queries — policies, benefits, leave, payroll — integrated with the HCM system. Reduces HR helpdesk volume 60–70%; employees get instant answers without raising a ticket.',
    driver: 'Employee experience + cost-to-serve',
    value: '60–70% helpdesk deflection',
    users: '110,000 employees',
    align: 'Enterprise self-service (top AI priority)',
    justif: 'Est. annual value $8.5M; 42k monthly tickets deflected',
    maturity: 'Manual HR helpdesk + ticketing',
    spend: '$12,000,000/yr',
    volume: '42,000 tickets/mo',
    pain: 'High manual effort',
    tools: 'HCM ticketing system',
    sources: 'HCM, policy docs, benefits KB',
    dataavail: 'Readily available & clean',
    integrations: 'Gemini for Google Workspace; Agentspace',
    realtime: 'No',
    technotes: 'Native connectors; low complexity',
    sensitivity: 'Medium',
    autonomy: 'Advisory',
    pii: 'true',
    audit: 'Yes',
    adoption: 'High',
    change: 'Low',
    delivery: 'Adopt (start simple)',
    addnotes: 'PII redaction layer verified before GA',
    stage: 'intake',
  },
  {
    name: 'Contract Leakage',
    department: 'Procurement',
    executive_sponsor: 'CPO',
    submitted_by: 'Procurement Analytics',
    contact_email: 'procurement@intel.com',
    description: 'AI identifies where contracted terms — pricing, rebates, SLAs, payment terms — are not being enforced in actual POs and invoices. Recovers 2–5% of contract value that leaks silently through non-compliance.',
    driver: 'Margin recovery',
    value: '2–5% contract value recovered',
    users: 'Procurement + AP',
    align: 'Margin recovery (top AI priority)',
    justif: 'Est. annual value $22M; currently <5% of contracts audited',
    maturity: 'Manual spot-audit of contracts vs POs',
    spend: '$4,000,000/yr',
    volume: '<5% of contracts covered',
    pain: 'Very high manual effort',
    tools: 'ERP + spreadsheets',
    sources: 'ERP POs/invoices, contract repository',
    dataavail: 'Available across systems',
    integrations: 'AppSheet / Agentspace + Vertex AI + Document AI + BigQuery',
    realtime: 'No (batch + API)',
    technotes: 'Cross-system reconciliation; medium complexity',
    sensitivity: 'High',
    autonomy: 'Supervised',
    pii: 'false',
    audit: 'Yes',
    adoption: 'Medium',
    change: 'Medium',
    delivery: 'Extend (scale smart)',
    addnotes: 'Human approval on all recovery actions; SOX control sign-off',
    stage: 'intake',
  },
  {
    name: 'Demand Forecasting & Supply Chain Planning',
    department: 'Supply Chain',
    executive_sponsor: 'COO',
    submitted_by: 'Supply Chain Planning',
    contact_email: 'supplychain@intel.com',
    description: 'Enriches integrated business planning with external signals — weather, macro, competitor pricing. 15–25% inventory reduction; 10–15% service level improvement over static statistical models.',
    driver: 'Working capital + service level',
    value: '15–25% inventory reduction',
    users: 'Planning org',
    align: 'Supply-chain resilience (top AI priority)',
    justif: 'Est. annual value $35M; baseline forecast MAPE ~28%',
    maturity: 'Statistical forecast in planning suite',
    spend: '$6,000,000/yr',
    volume: 'Enterprise IBP demand plan',
    pain: 'High manual effort; low accuracy',
    tools: 'Integrated business planning suite',
    sources: 'IBP demand history, external signals, BigQuery',
    dataavail: 'Available; external ingestion effort',
    integrations: 'Vertex AI Forecasting + BigQuery ML',
    realtime: 'Yes (API + streaming)',
    technotes: 'Custom forecasting models; high complexity',
    sensitivity: 'Medium',
    autonomy: 'Supervised',
    pii: 'false',
    audit: 'Yes',
    adoption: 'Medium',
    change: 'Medium',
    delivery: 'Build (engineer it)',
    addnotes: 'Phase-1 pilot on two product lines; go/no-go on measured MAPE lift',
    stage: 'intake',
  },
  {
    name: 'Predictive Asset Maintenance',
    // Canonical taxonomy has no 'Assets Maintenance'; asset-maintenance is a
    // Manufacturing function. Non-canonical values null out on import.
    department: 'Manufacturing',
    executive_sponsor: 'VP Manufacturing',
    submitted_by: 'Reliability Engineering',
    contact_email: 'reliability@intel.com',
    description: 'Fuses IoT sensor data with maintenance history to predict failure windows and auto-generate work orders with parts and resource plans. 25–40% unplanned downtime reduction.',
    driver: 'Uptime + OEE',
    value: '25–40% unplanned downtime reduction',
    users: 'Maintenance + Ops',
    align: 'Asset uptime (top AI priority)',
    justif: 'Est. annual value $48M; baseline 6.2% unplanned downtime',
    maturity: 'Time-based preventive maintenance',
    spend: '$9,000,000/yr',
    volume: 'Fleet-wide equipment',
    pain: 'High manual effort; reactive',
    tools: 'CMMS + preventive schedules',
    sources: 'IoT sensors (Pub/Sub), maintenance history',
    dataavail: 'Available; sensor data quality varies',
    integrations: 'Vertex AI + Pub/Sub + BigQuery + Cloud Functions',
    realtime: 'Yes (streaming)',
    technotes: 'Predictive models on streaming IoT; high complexity',
    sensitivity: 'Medium',
    autonomy: 'Supervised',
    pii: 'false',
    audit: 'Yes',
    adoption: 'Medium',
    change: 'Medium',
    delivery: 'Build (engineer it)',
    addnotes: 'Supervisor approval on auto work orders until precision >90% on pilot line',
    stage: 'intake',
  },
  {
    name: 'Quality Defect Prediction & Root Cause Analysis',
    // Canonical 'Quality' (was 'Manufacturing / Quality', which nulled on import).
    department: 'Quality',
    executive_sponsor: 'VP Quality',
    submitted_by: 'Quality Engineering',
    contact_email: 'quality@intel.com',
    description: 'Correlates QM inspection results with production parameters to predict defect batches before completion. 20–35% reduction in quality-related scrap and rework cost.',
    driver: 'Yield + scrap cost',
    value: '20–35% scrap/rework reduction',
    users: 'Quality + Production',
    align: 'Yield/quality (top AI priority)',
    justif: 'Est. annual value $40M; baseline scrap 3.8%',
    maturity: 'Post-hoc inspection + manual RCA',
    spend: '$7,500,000/yr',
    volume: 'All production batches',
    pain: 'High manual effort; late detection',
    tools: 'QM inspection + MES',
    sources: 'QM inspection, MES process params, BigQuery',
    dataavail: 'Available; MES integration effort',
    integrations: 'Vertex AI + BigQuery ML + Looker',
    realtime: 'Yes (batch + streaming)',
    technotes: 'Defect prediction + RCA models; high complexity',
    sensitivity: 'Medium',
    autonomy: 'Advisory',
    pii: 'false',
    audit: 'Yes',
    adoption: 'Medium',
    change: 'Medium',
    delivery: 'Build (engineer it)',
    addnotes: 'Advisory-only phase 1; no automated batch holds until 3 months ground-truth validation',
    stage: 'intake',
  },
  {
    // v2 EXAMPLE: a COMPLETED / delivered use case. Set status='completed' and
    // delivered_at to the go-live date. A completed row auto-defaults its stage
    // to 'panel' when stage is left blank, and surfaces in the Dashboard's
    // 2026 'Delivered' storyline rather than the active pipeline.
    name: 'Automated Invoice Matching (DELIVERED EXAMPLE)',
    department: 'Finance',
    executive_sponsor: 'CFO',
    submitted_by: 'Finance Automation Team',
    contact_email: 'ap-automation@intel.com',
    description: 'Three-way PO/GRN/invoice matching with Document AI. Delivered to production Q1 2026; ~85% of invoices now auto-matched without touch.',
    driver: 'Cost-to-serve + cycle time',
    value: '85% touchless match rate',
    users: '600 AP + procurement staff',
    align: 'Finance operational excellence',
    justif: 'Realized $4.1M annual savings; 9-day → 2-day cycle',
    maturity: 'Delivered — live in production',
    spend: '$5,200,000/yr (pre-automation)',
    volume: '1.2M invoices/yr',
    pain: 'Manual matching backlog',
    tools: 'ERP + legacy OCR',
    sources: 'ERP, supplier portal, PO/GRN tables',
    dataavail: 'Readily available & clean',
    integrations: 'Document AI; BigQuery; ERP connector',
    realtime: 'No',
    technotes: 'Delivered on Document AI + reconciliation service',
    sensitivity: 'Medium',
    autonomy: 'Automated w/ exception review',
    pii: 'true',
    audit: 'Yes',
    adoption: 'High',
    change: 'Low',
    delivery: 'Build (engineer it)',
    addnotes: 'Delivered example row — shows how to mark a completed use case.',
    stage: 'panel',
    status: 'completed',
    delivered_at: '2026-03-15',
  },
];

// RFC 4180 field escaping: wrap in double quotes when the value contains a
// comma, double quote, or newline; escape embedded double quotes by doubling.
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Build the full CSV: header row + one row per Intel example. CRLF line endings
// per RFC 4180 (Excel-friendly).
function buildTemplateCsv() {
  const lines = [];
  lines.push(TEMPLATE_COLUMNS.map(csvEscape).join(','));
  for (const row of TEMPLATE_ROWS) {
    lines.push(TEMPLATE_COLUMNS.map((col) => csvEscape(row[col])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/*
 * RFC 4180 CSV parser. Returns an array of row objects keyed by the header row.
 *
 * Handles:
 *   - quoted fields ("...") that may contain commas, CRLF/LF newlines
 *   - escaped double-quotes inside a quoted field ("" -> ")
 *   - CRLF, LF, or bare CR line endings
 *   - a trailing newline (ignored, no phantom empty row)
 *   - ragged rows: missing trailing columns become '' ; extra columns ignored
 *
 * The first non-empty record is treated as the header. Each subsequent record
 * becomes an object { <header>: <value>, ... } with values trimmed of
 * surrounding whitespace (unquoted). Unknown/extra columns beyond the header
 * count are dropped.
 */
function parseCsv(text) {
  if (text === null || text === undefined) return [];
  const str = String(text);

  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let i = 0;
  const n = str.length;
  let fieldStartedWithQuote = false;

  const pushField = () => {
    record.push(field);
    field = '';
    fieldStartedWithQuote = false;
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < n) {
    const ch = str[i];

    if (inQuotes) {
      if (ch === '"') {
        if (str[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      fieldStartedWithQuote = true;
      i += 1; continue;
    }
    if (ch === ',') { pushField(); i += 1; continue; }
    if (ch === '\r') {
      // CRLF or bare CR both end the record.
      pushRecord();
      if (str[i + 1] === '\n') i += 2; else i += 1;
      continue;
    }
    if (ch === '\n') { pushRecord(); i += 1; continue; }
    field += ch; i += 1;
  }
  // Flush the final field/record unless the input ended exactly on a newline
  // (in which case field==='' and record is empty -> skip the phantom row).
  if (field !== '' || record.length > 0 || fieldStartedWithQuote) {
    pushRecord();
  }

  // Drop fully-empty records (e.g. blank lines).
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (!nonEmpty.length) return [];

  const header = nonEmpty[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < nonEmpty.length; r++) {
    const cells = nonEmpty[r];
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      const raw = c < cells.length ? cells[c] : '';
      obj[key] = typeof raw === 'string' ? raw.trim() : raw;
    }
    out.push(obj);
  }
  return out;
}

module.exports = { TEMPLATE_COLUMNS, TEMPLATE_ROWS, buildTemplateCsv, csvEscape, parseCsv };
