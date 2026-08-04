/* Dev static server: serves kanban.html + real assets with a stubbed /api
   returning fixture Intel data. Used for the screenshot verification. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 61000;

const PORTFOLIO = [
  { id: 'uc-1', name: 'Fraud Signal Triage', department: 'Risk & Compliance', stage: 'panel', feasibility_composite: 3.8, advisory_tier: 'Extend', verdict: 'GO' },
  { id: 'uc-2', name: 'Contract Summarizer', department: 'Legal', stage: 'panel', feasibility_composite: 4.2, advisory_tier: 'Scale', verdict: 'CONDITIONAL GO' },
  { id: 'uc-3', name: 'Shelf Vision QA', department: 'Retail Ops', stage: 'panel', feasibility_composite: 2.9, advisory_tier: 'Pilot', verdict: 'NO-GO' },
  { id: 'uc-4', name: 'Ticket Router', department: 'Customer Support', stage: 'feasibility', feasibility_composite: 3.1, advisory_tier: 'Pilot', verdict: null },
  { id: 'uc-5', name: 'Campaign Brief Gen', department: 'Marketing', stage: 'intake', feasibility_composite: null, advisory_tier: null, verdict: null },
  { id: 'uc-6', name: 'Sales Copilot', department: 'Sales', stage: 'bxt', feasibility_composite: 3.5, advisory_tier: 'Extend', verdict: null },
  { id: 'uc-7', name: 'Invoice Extractor', department: 'Finance', stage: 'advisory', feasibility_composite: 4.0, advisory_tier: 'Scale', verdict: null },
  { id: 'uc-8', name: 'HR Policy Assistant', department: 'People Ops', stage: 'summary', feasibility_composite: 3.6, advisory_tier: 'Extend', verdict: null },
];
const WORKSPACES = [{ id: 'ws-intel', name: 'Intel Corp' }, { id: 'ws-other', name: 'Acme' }];

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

http.createServer(function (req, res) {
  const url = req.url.split('?')[0];
  if (url.indexOf('/api/workspaces') === 0) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(WORKSPACES)); }
  if (url.indexOf('/api/portfolio') === 0) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(PORTFOLIO)); }
  if (url.indexOf('/api/') === 0) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ user: { email: 'demo@intel.com' } })); }
  const file = path.join(ROOT, url === '/' ? 'kanban.html' : url);
  fs.readFile(file, function (err, buf) {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(PORT, function () { console.log('kanban-serve on ' + PORT); });
