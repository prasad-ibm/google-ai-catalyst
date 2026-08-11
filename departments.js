'use strict';

/*
 * Canonical department taxonomy — the SINGLE server-side source of truth.
 *
 * This list MUST stay in lockstep with the intake authoring dropdown
 * (intake.html #f_dept) and the DEF-06 facet-merge behavior. The intake form
 * ships these same 14 options and enforces a non-empty selection (DEF-08);
 * the DEF-06 dynamic merge then appends any *extra* departments discovered in
 * /api/portfolio/facets to the dropdown.
 *
 * DEF-13: because the bulk-import endpoint did NO department validation, junk
 * values (e.g. "NotARealDept") were persisted, surfaced as a new facet
 * (departments 14 -> 15), and the DEF-06 merge then leaked that junk into the
 * intake dropdown as a spurious 15th option — a self-polluting loop. By
 * validating every bulk row's department against THIS list and coercing any
 * unrecognized value to null (which /api/portfolio/facets already excludes),
 * that loop is broken: unknown departments can never become a facet.
 *
 * intake-dept.test.js and bulk-upload-departments.test.js both assert their
 * canonical list matches these values, so any drift here fails a test.
 */
const CANONICAL_DEPARTMENTS = Object.freeze([
  'Human Resources',
  'Finance',
  'Procurement',
  'Supply Chain',
  'Data Center Group',
  'Manufacturing',
  'Quality',
  'Sales',
  'Marketing',
  'Legal',
  'IT',
  'Customer Support',
  'R&D',
  'Security',
]);

// Case-insensitive lookup: normalized-key -> canonical spelling.
const _byKey = new Map(
  CANONICAL_DEPARTMENTS.map((d) => [d.trim().toLowerCase(), d]),
);

/*
 * DEF-13 (aliases): common abbreviations / alternate spellings that bulk
 * imports frequently carry but which are NOT one of the 14 canonical strings.
 * These are consulted ONLY after the exact canonical match fails and BEFORE
 * returning null, so a spreadsheet full of "HR" / "IT dept" / "R & D" no longer
 * silently drops its department. Every alias maps to a canonical value, so the
 * DB still only ever stores one of the 14 — the self-polluting facet loop stays
 * closed. Keys are pre-normalized (trim + lowercase) to match the same
 * normalization resolveDepartment() applies to incoming values. Only
 * unambiguous aliases are included; anything genuinely unknown still -> null.
 */
const _byAlias = new Map(
  Object.entries({
    // Human Resources
    'hr': 'Human Resources',
    'human resource': 'Human Resources',
    // R&D
    'r & d': 'R&D',
    'rnd': 'R&D',
    'research & development': 'R&D',
    'research and development': 'R&D',
    // IT
    'information technology': 'IT',
    'it dept': 'IT',
    'i.t.': 'IT',
    // Security
    'infosec': 'Security',
    'information security': 'Security',
    // Customer Support
    'cust support': 'Customer Support',
    'customer service': 'Customer Support',
    'support': 'Customer Support',
    // Legal
    'legal dept': 'Legal',
    // Procurement
    'procure': 'Procurement',
    'purchasing': 'Procurement',
  }).map(([k, v]) => [k.trim().toLowerCase(), v]),
);

/*
 * Resolve an incoming department value against the canonical taxonomy.
 *
 * Returns the canonical spelling when `value` matches one of the 14
 * (case-insensitive, whitespace-trimmed). Otherwise returns null — including
 * for blank/empty input. Coercing unknown values to null (rather than hard-
 * rejecting the whole row) keeps a bulk import resilient while guaranteeing an
 * unrecognized department can never enter the DB and pollute the facet list.
 *
 * This mirrors the intake rule: the authoring dropdown only lets a user pick a
 * recognized department, so the bulk path likewise only persists recognized
 * departments.
 */
function resolveDepartment(value) {
  if (value == null) return null;
  const key = String(value).trim().toLowerCase();
  if (key === '') return null;
  // 1. Exact canonical match (case-insensitive, trimmed).
  if (_byKey.has(key)) return _byKey.get(key);
  // 2. Known unambiguous alias (e.g. 'hr' -> 'Human Resources').
  if (_byAlias.has(key)) return _byAlias.get(key);
  // 3. Genuinely unknown -> null (row imports with no department).
  return null;
}

// True iff `value` is one of the canonical departments (case-insensitive).
function isCanonicalDepartment(value) {
  return resolveDepartment(value) !== null;
}

module.exports = { CANONICAL_DEPARTMENTS, resolveDepartment, isCanonicalDepartment };
