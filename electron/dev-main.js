const path = require('path');

process.env.TS_NODE_PROJECT =
  process.env.TS_NODE_PROJECT || path.join(__dirname, '..', 'tsconfig.electron.json');

require('ts-node/register/transpile-only');
require('./main');
