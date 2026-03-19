const { spawn } = require('child_process');
const path = require('path');
const { addRun, getLastRun, getStats } = require('./storage');

async function runTestsWithHistory(pattern = 'test/**/*.test.js') {
  const startTime = Date.now();
  const tests = [];
  let currentSuite = [];
  let summary = { tests: 0, suites: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
  
  const args = ['--test', pattern];
  if (process.argv.includes('--watch')) {
    args.push('--watch');
  }
  
  const proc = spawn('node', args, {
    cwd: process.cwd(),
    env: { ...process.env, NODE_COLORS: '1' },
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });
  
  let stdout = '';
  let stderr = '';
  
  proc.stdout.on('data', (data) => {
    const str = data.toString();
    stdout += str;
    process.stdout.write(data);
    parseOutput(str);
  });
  
  proc.stderr.on('data', (data) => {
    stderr += data.toString();
    process.stderr.write(data);
  });
  
  function parseOutput(output) {
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes('ℹ tests')) {
        const match = line.match(/ℹ tests\s+(\d+)/);
        if (match) summary.tests = parseInt(match[1]);
      }
      if (line.includes('ℹ suites')) {
        const match = line.match(/ℹ suites\s+(\d+)/);
        if (match) summary.suites = parseInt(match[1]);
      }
      if (line.includes('ℹ pass')) {
        const match = line.match(/ℹ pass\s+(\d+)/);
        if (match) summary.pass = parseInt(match[1]);
      }
      if (line.includes('ℹ fail')) {
        const match = line.match(/ℹ fail\s+(\d+)/);
        if (match) summary.fail = parseInt(match[1]);
      }
      if (line.includes('ℹ skipped')) {
        const match = line.match(/ℹ skipped\s+(\d+)/);
        if (match) summary.skipped = parseInt(match[1]);
      }
      if (line.includes('ℹ todo')) {
        const match = line.match(/ℹ todo\s+(\d+)/);
        if (match) summary.todo = parseInt(match[1]);
      }
      if (line.includes('ℹ duration_ms')) {
        const match = line.match(/ℹ duration_ms\s+([\d.]+)/);
        if (match) summary.duration_ms = parseFloat(match[1]);
      }
      
      const testMatch = line.match(/^(✔|✖|⚠|ℹ)\s+(.+?)\s*\(([\d.]+)ms\)$/);
      if (testMatch) {
        const [, status, name, duration] = testMatch;
        tests.push({
          name: name.trim(),
          status: status === '✔' ? 'pass' : status === '✖' ? 'fail' : status === '⚠' ? 'skip' : 'todo',
          duration_ms: parseFloat(duration)
        });
      }
      
      const failMatch = line.match(/^test at\s+(.+):(\d+):(\d+)$/);
      if (failMatch) {
        const [, file, lineNum] = failMatch;
        const lastTest = tests[tests.length - 1];
        if (lastTest && lastTest.status === 'fail') {
          lastTest.file = file;
          lastTest.line = parseInt(lineNum);
        }
      }
    }
  }
  
  return new Promise((resolve) => {
    proc.on('close', (code) => {
      const duration_ms = Date.now() - startTime;
      
      const run = {
        timestamp: new Date().toISOString(),
        duration_ms,
        exitCode: code,
        summary,
        tests: tests.slice(-500),
        git: getGitInfo()
      };
      
      const previous = getLastRun();
      const history = addRun(run);
      
      console.log('\n' + '='.repeat(60));
      console.log('TEST HISTORY COMPARISON');
      console.log('='.repeat(60));
      
      if (previous) {
        printComparison(previous.summary, summary, previous.duration_ms, duration_ms);
      } else {
        console.log('No previous run to compare');
      }
      
      console.log('\n' + '-'.repeat(60));
      console.log('7-DAY STATISTICS');
      console.log('-'.repeat(60));
      const stats = getStats(7);
      if (stats) {
        console.log(`Runs: ${stats.runs}`);
        console.log(`Pass rate: ${stats.passRate}%`);
        console.log(`Avg duration: ${stats.avgDuration}ms`);
      } else {
        console.log('No runs in the last 7 days');
      }
      
      console.log('='.repeat(60) + '\n');
      
      resolve({ code, summary, history });
    });
  });
}

function getGitInfo() {
  const { execSync } = require('child_process');
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    return { branch, commit, dirty: status.length > 0 };
  } catch {
    return null;
  }
}

function printComparison(prev, curr, prevDur, currDur) {
  const diff = (a, b) => {
    const d = b - a;
    const sign = d > 0 ? '+' : '';
    return `${sign}${d}`;
  };
  
  const pct = (a, b) => {
    if (a === 0) return b > 0 ? '+∞' : '0';
    const d = ((b - a) / a * 100).toFixed(1);
    const sign = d > 0 ? '+' : '';
    return `${sign}${d}%`;
  };
  
  console.log('\nTest Counts:');
  console.log(`  Tests:   ${prev.tests} → ${curr.tests} (${diff(prev.tests, curr.tests)})`);
  console.log(`  Pass:    ${prev.pass} → ${curr.pass} (${diff(prev.pass, curr.pass)})`);
  console.log(`  Fail:    ${prev.fail} → ${curr.fail} (${diff(prev.fail, curr.fail)})`);
  console.log(`  Skip:    ${prev.skipped} → ${curr.skipped} (${diff(prev.skipped, curr.skipped)})`);
  
  console.log('\nDuration:');
  console.log(`  ${prevDur}ms → ${currDur}ms (${pct(prevDur, currDur)})`);
  
  if (prev.fail > 0 || curr.fail > 0) {
    console.log('\nFailure Change:');
    if (prev.fail < curr.fail) {
      console.log(`  ⚠️  ${curr.fail - prev.fail} new failure(s)`);
    } else if (prev.fail > curr.fail) {
      console.log(`  ✓ ${prev.fail - curr.fail} fixed`);
    }
  }
}

module.exports = { runTestsWithHistory };
