// Runs the dashboard without Electron: `npm run demo` (sample data) or
// `node src/dev-server.js --db path/to/file.db`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './core/store.js';
import { Engine } from './core/engine.js';
import { createServer } from './core/server.js';
import { seedDemo } from './core/demo.js';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const demo = args.includes('--demo');
const store = new Store(flag('--db') || ':memory:');
if (demo) seedDemo(store);
const engine = new Engine({ store, demo, version: 'dev' });
engine.start();
const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
const app = createServer({ engine, uiDir, port: Number(flag('--port') || 48321) });
const port = await app.listen();
console.log(`WDMTG dashboard: http://127.0.0.1:${port}/`);
