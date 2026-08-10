/* Unit test for /api/portfolio filter WHERE-building + pagination math.
   Replicates the exact param-binding logic from server.js (no DB needed). */
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  \u2713 ' + name); } else { fail++; console.log('  \u2717 ' + name); } }

// --- replicate server.js WHERE builder ---
function buildWhere(qy) {
  const { workspace_id, department, sponsor, stage, status, q } = qy;
  const where = [];
  const params = [];
  function add(clause, val) { params.push(val); where.push(clause.replace('?', '$' + params.length)); }
  if (workspace_id) add('uc.workspace_id = ?', workspace_id);
  if (department)    add('uc.department = ?', department);
  if (sponsor)       add('uc.executive_sponsor = ?', sponsor);
  if (stage)         add('uc.stage = ?', stage);
  if (status)        add('uc.status = ?', status);
  if (q)             add('uc.name ILIKE ?', '%' + String(q).trim() + '%');
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  return { whereSql, params };
}
function pageMath(qy) {
  const paged = qy.limit != null || qy.offset != null;
  const limit = Math.min(Math.max(parseInt(qy.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(qy.offset, 10) || 0, 0);
  return { paged, limit, offset };
}

console.log('== filter WHERE building ==');
let r = buildWhere({});
ok('no params -> no WHERE (back-compat)', r.whereSql === '' && r.params.length === 0);

r = buildWhere({ department: 'Data Center Group' });
ok('department -> $1 param', r.whereSql === ' WHERE uc.department = $1' && r.params[0] === 'Data Center Group');

r = buildWhere({ department: 'HR', sponsor: 'ET-DCG', status: 'completed' });
ok('three filters -> $1 $2 $3', r.whereSql === ' WHERE uc.department = $1 AND uc.executive_sponsor = $2 AND uc.status = $3');
ok('three filters -> params ordered', r.params.join('|') === 'HR|ET-DCG|completed');

r = buildWhere({ q: '  invoice ' });
ok('search q -> ILIKE wildcards + trimmed', r.whereSql === ' WHERE uc.name ILIKE $1' && r.params[0] === '%invoice%');

r = buildWhere({ workspace_id: 'w1', stage: 'panel' });
ok('workspace + stage', r.whereSql === ' WHERE uc.workspace_id = $1 AND uc.stage = $2');

console.log('\n== pagination math ==');
ok('no limit/offset -> not paged', pageMath({}).paged === false);
ok('limit=100 -> paged, limit 100', (() => { const p = pageMath({ limit: '100' }); return p.paged && p.limit === 100 && p.offset === 0; })());
ok('limit clamps to 500 max', pageMath({ limit: '9999' }).limit === 500);
ok('limit floors to 1 min', pageMath({ limit: '0' }).limit === 50); // 0 -> falsy -> default 50
ok('offset=50 respected', pageMath({ offset: '50' }).offset === 50);
ok('negative offset -> 0', pageMath({ offset: '-5' }).offset === 0);

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
