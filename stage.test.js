'use strict';

/* Unit test for the canonical stage model (stage.js). Run: node stage.test.js */

const assert = require('node:assert');
const { STAGES, ROI_MIN_STAGE, stageKey, stageRank, roiEligible } = require('./stage');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name); }
}

// Ordering is the documented pipeline.
ok('STAGES ordered as documented',
  STAGES.join(',') === 'intake,bxt,feasibility,advisory,summary,panel,approved');
ok('ROI_MIN_STAGE is summary', ROI_MIN_STAGE === 'summary');

// stageKey normalization.
ok('stageKey canonical passthrough', stageKey('feasibility') === 'feasibility');
ok('stageKey case-insensitive', stageKey('Panel') === 'panel');
ok('stageKey "Evaluation Summary" -> summary', stageKey('Evaluation Summary') === 'summary');
ok('stageKey "Executive Panel" -> panel', stageKey('Executive Panel') === 'panel');
ok('stageKey empty -> intake', stageKey('') === 'intake');
ok('stageKey null -> intake', stageKey(null) === 'intake');
ok('stageKey unknown -> intake', stageKey('zzz') === 'intake');

// Ranking monotonic.
ok('rank(intake) < rank(summary)', stageRank('intake') < stageRank('summary'));
ok('rank(summary) < rank(panel)', stageRank('summary') < stageRank('panel'));
ok('rank(panel) < rank(approved)', stageRank('panel') < stageRank('approved'));

// ROI eligibility gate — the crux of bug #6.
ok('intake NOT roi-eligible', roiEligible('intake') === false);
ok('bxt NOT roi-eligible', roiEligible('bxt') === false);
ok('feasibility NOT roi-eligible', roiEligible('feasibility') === false);
ok('advisory NOT roi-eligible', roiEligible('advisory') === false);
ok('summary IS roi-eligible', roiEligible('summary') === true);
ok('panel IS roi-eligible', roiEligible('panel') === true);
ok('approved IS roi-eligible', roiEligible('approved') === true);
ok('unknown/empty stage NOT roi-eligible', roiEligible('') === false && roiEligible(null) === false);

console.log('\n---------------------------------------------');
console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
console.log('---------------------------------------------');
assert.strictEqual(fail, 0, 'stage.test.js had failures');
process.exit(fail ? 1 : 0);
