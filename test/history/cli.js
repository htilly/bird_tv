#!/usr/bin/env node
const { runTestsWithHistory } = require('./runner');
const pattern = process.argv[2] || 'test/**/*.test.js';

runTestsWithHistory(pattern).then(({ code }) => {
  process.exit(code);
});
