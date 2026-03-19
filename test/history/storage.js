const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(process.cwd(), '.test-history.json');
const MAX_HISTORY = 100;

function load() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (!data.runs) data.runs = [];
      return data;
    }
  } catch (e) {
    console.error('Warning: Could not load test history:', e.message);
  }
  return { runs: [] };
}

function save(history) {
  if (history.runs.length > MAX_HISTORY) {
    history.runs = history.runs.slice(-MAX_HISTORY);
  }
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (e) {
    console.error('Warning: Could not save test history:', e.message);
  }
}

function addRun(run) {
  const history = load();
  history.runs.push({
    id: new Date().toISOString(),
    ...run
  });
  save(history);
  return history;
}

function getLastRun() {
  const history = load();
  return history.runs.length > 0 ? history.runs[history.runs.length - 1] : null;
}

function getPreviousRun(currentId) {
  const history = load();
  const currentIndex = history.runs.findIndex(r => r.id === currentId);
  if (currentIndex > 0) {
    return history.runs[currentIndex - 1];
  }
  return null;
}

function getStats(days = 7) {
  const history = load();
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const recent = history.runs.filter(r => new Date(r.timestamp).getTime() > cutoff);
  
  if (recent.length === 0) return null;
  
  const totalTests = recent.reduce((sum, r) => sum + (r.summary?.tests || 0), 0);
  const totalPassed = recent.reduce((sum, r) => sum + (r.summary?.pass || 0), 0);
  const totalFailed = recent.reduce((sum, r) => sum + (r.summary?.fail || 0), 0);
  const avgDuration = recent.reduce((sum, r) => sum + (r.duration_ms || 0), 0) / recent.length;
  
  return {
    runs: recent.length,
    totalTests,
    passRate: totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0,
    avgDuration: Math.round(avgDuration),
    failureRate: totalTests > 0 ? ((totalFailed / totalTests) * 100).toFixed(1) : 0
  };
}

module.exports = { load, save, addRun, getLastRun, getPreviousRun, getStats, HISTORY_FILE };
