#!/usr/bin/env node
import { loadEnv } from '../src/env.js';
import { RapidTextAI } from '../src/api.js';
import { createServer } from '../src/server.js';

loadEnv();
let client;
try {
  client = new RapidTextAI();
} catch (e) {
  // stdout is the protocol channel, so report on stderr and exit.
  console.error(`rapidtextai-mcp: ${e.message}`);
  process.exit(1);
}
createServer(client);
console.error('rapidtextai-mcp ready (stdio)');
