#!/usr/bin/env node
const { load, getStats } = require('./storage');

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString();
}

function main() {
  const command = process.argv[2];
  const history = load();
  
  if (history.runs.length === 0) {
    console.log('No test history found. Run tests with: npm run test:history');
    return;
  }
  
  if (command === 'list' || !command) {
    console.log('\n' + '='.repeat(70));
    console.log('TEST RUN HISTORY');
    console.log('='.repeat(70));
    
    const recent = history.runs.slice(-20).reverse();
    for (const run of recent) {
      const status = run.summary.fail > 0 ? '✖' : '✔';
      const git = run.git ? ` [${run.git.branch}:${run.git.commit}${run.git.dirty ? '*' : ''}]` : '';
      console.log(`${status} ${formatDate(run.timestamp)} | ${run.summary.pass}/${run.summary.tests} passed | ${formatDuration(run.duration_ms)}${git}`);
    }
    
    console.log('\n' + '-'.repeat(70));
    console.log('SUMMARY (Last 7 days)');
    console.log('-'.repeat(70));
    const stats = getStats(7);
    if (stats) {
      console.log(`Total runs: ${stats.runs}`);
      console.log(`Pass rate: ${stats.passRate}%`);
      console.log(`Avg duration: ${formatDuration(stats.avgDuration)}`);
    }
    console.log('='.repeat(70) + '\n');
    
  } else if (command === 'compare') {
    if (history.runs.length < 2) {
      console.log('Need at least 2 runs to compare');
      return;
    }
    
    const a = history.runs[history.runs.length - 2];
    const b = history.runs[history.runs.length - 1];
    
    console.log('\n' + '='.repeat(70));
    console.log('COMPARING LAST TWO RUNS');
    console.log('='.repeat(70));
    console.log(`\nRun A: ${formatDate(a.timestamp)}`);
    console.log(`Run B: ${formatDate(b.timestamp)}`);
    
    console.log('\nTest Counts:');
    console.log(`  Tests:   ${a.summary.tests} → ${b.summary.tests}`);
    console.log(`  Pass:    ${a.summary.pass} → ${b.summary.pass}`);
    console.log(`  Fail:    ${a.summary.fail} → ${b.summary.fail}`);
    console.log(`  Skip:    ${a.summary.skipped} → ${b.summary.skipped}`);
    
    console.log('\nDuration:');
    console.log(`  ${formatDuration(a.duration_ms)} → ${formatDuration(b.duration_ms)}`);
    
    const newFails = b.tests.filter(t => t.status === 'fail').map(t => t.name);
    const oldFails = a.tests.filter(t => t.status === 'fail').map(t => t.name);
    
    if (newFails.length > 0 || oldFails.length > 0) {
      console.log('\nFailures:');
      const added = newFails.filter(n => !oldFails.includes(n));
      const fixed = oldFails.filter(n => !newFails.includes(n));
      const persistent = newFails.filter(n => oldFails.includes(n));
      
      if (added.length > 0) {
        console.log('  New failures:');
        added.forEach(n => console.log(`    ✖ ${n}`));
      }
      if (fixed.length > 0) {
        console.log('  Fixed:');
        fixed.forEach(n => console.log(`    ✓ ${n}`));
      }
      if (persistent.length > 0) {
        console.log('  Persistent:');
        persistent.forEach(n => console.log(`    ⚠ ${n}`));
      }
    }
    console.log('='.repeat(70) + '\n');
    
  } else if (command === 'trend') {
    const days = parseInt(process.argv[3]) || 30;
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const recent = history.runs.filter(r => new Date(r.timestamp).getTime() > cutoff);
    
    console.log('\n' + '='.repeat(70));
    console.log(`TREND (Last ${days} days, ${recent.length} runs)`);
    console.log('='.repeat(70));
    
    const byDay = {};
    for (const run of recent) {
      const day = new Date(run.timestamp).toISOString().split('T')[0];
      if (!byDay[day]) {
        byDay[day] = { runs: 0, pass: 0, fail: 0, duration: 0 };
      }
      byDay[day].runs++;
      byDay[day].pass += run.summary.pass;
      byDay[day].fail += run.summary.fail;
      byDay[day].duration += run.duration_ms;
    }
    
    console.log('\nDate        | Runs | Pass Rate | Avg Duration');
    console.log('-'.repeat(50));
    
    Object.keys(byDay).sort().forEach(day => {
      const d = byDay[day];
      const total = d.pass + d.fail;
      const rate = total > 0 ? ((d.pass / total) * 100).toFixed(0) : 0;
      const avgDur = Math.round(d.duration / d.runs);
      console.log(`${day} | ${d.runs.toString().padStart(4)} | ${rate.padStart(9)}% | ${formatDuration(avgDur)}`);
    });
    console.log('='.repeat(70) + '\n');
    
  } else if (command === 'clear') {
    const fs = require('fs');
    const path = require('path');
    const { HISTORY_FILE } = require('./storage');
    if (fs.existsSync(HISTORY_FILE)) {
      fs.unlinkSync(HISTORY_FILE);
      console.log('Test history cleared');
    }
    
  } else {
    console.log('Usage:');
    console.log('  node test/history/view.js list     - Show recent runs');
    console.log('  node test/history/view.js compare  - Compare last two runs');
    console.log('  node test/history/view.js trend    - Show 30-day trend');
    console.log('  node test/history/view.js clear    - Clear history');
  }
}

main();
