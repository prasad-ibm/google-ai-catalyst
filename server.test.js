const { Client } = require('pg');
const url = process.env.DATABASE_URL || require('fs').readFileSync(__dirname+'/../.env','utf8').match(/DATABASE_URL=(.+)/)[1].trim();
(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await c.connect();
    const v = await c.query('SELECT version(), current_database(), current_user, now()');
    console.log('CONNECTED OK');
    console.log(v.rows[0].version.split(',')[0]);
    console.log('db =', v.rows[0].current_database, '| user =', v.rows[0].current_user);
    const t = await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1");
    console.log('existing public tables:', t.rows.map(r=>r.tablename).join(', ') || '(none)');
  } catch (e) {
    console.error('CONNECT FAILED:', e.message);
    process.exit(1);
  } finally { await c.end(); }
})();
