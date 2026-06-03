// Postgres backend — the durable, managed-DB home for the corpus (recommended
// for production; lets the data live entirely off GitHub).
//
// Works with any managed Postgres (Neon, Supabase, RDS, Cloud SQL, …): set
// DATABASE_URL and CORPUS_BACKEND=postgres. `pg` is imported lazily so the file
// backend stays zero-dependency. One table, keyed by (kind, id), idempotent
// upserts — same GET→{items} / POST{items}→{appended} contract as the file
// backend, so nothing else in the stack changes.
//
// Schema (auto-created on first use):
//   create table corpus(
//     kind text not null, id text not null, data jsonb not null,
//     captured_at timestamptz not null default now(),
//     primary key (kind, id));

let _pool;
async function pool() {
  if (_pool) return _pool;
  const pg = await import("pg");
  const { Pool } = pg.default || pg;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Managed providers usually require TLS; disable verification unless told otherwise.
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  });
  await _pool.query(`create table if not exists corpus(
    kind text not null, id text not null, data jsonb not null,
    captured_at timestamptz not null default now(),
    primary key (kind, id))`);
  return _pool;
}

export function makePostgresBackend() {
  return {
    name: "postgres",
    async read(kind) {
      const p = await pool();
      const r = await p.query("select data from corpus where kind = $1 order by captured_at", [kind]);
      return r.rows.map(row => row.data);
    },
    async append(kind, items) {
      const p = await pool();
      let appended = 0;
      for (const it of items) {
        if (!it || !it.id) continue;
        const ts = it.capturedAt || it.ts || null;
        const r = await p.query(
          `insert into corpus(kind, id, data, captured_at)
           values ($1, $2, $3, coalesce($4::timestamptz, now()))
           on conflict (kind, id) do nothing`,
          [kind, String(it.id), it, ts]
        );
        appended += r.rowCount;
      }
      const c = await p.query("select count(*)::int as n from corpus where kind = $1", [kind]);
      return { appended, total: c.rows[0].n };
    },
  };
}
