import { createServer } from 'http';
import { existsSync, appendFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const CSV_PATH = path.join(__dirname, '..', 'local-submissions.csv');

function toCsvRow(values) {
  return values.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',');
}

function appendSubmission(data) {
  const keys = Object.keys(data).filter((key) => !key.startsWith('__'));
  if (!existsSync(CSV_PATH)) {
    writeFileSync(CSV_PATH, `${toCsvRow(['timestamp', ...keys])}\n`);
  }
  appendFileSync(CSV_PATH, `${toCsvRow([new Date().toISOString(), ...keys.map((key) => data[key])])}\n`);
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-adobe-form-hostname');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/submit') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { data } = JSON.parse(body);
        appendSubmission(data || {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ body: {} }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Local form submission server listening on http://localhost:${PORT}/submit`);
  // eslint-disable-next-line no-console
  console.log(`Submissions are appended to ${CSV_PATH}`);
});
