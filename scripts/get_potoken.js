/**
 * Get a PO Token using the bgutil-ytdlp-pot-provider.
 * Called by the GitHub Action.
 * Output: JSON to stdout: { "potoken": "...", "visitorData": "..." }
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PROVIDER_PORT = 4416;
const TEST_VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

function extractJsonObject(output) {
  const start = output.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < output.length; i++) {
    const ch = output[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return output.slice(start, i + 1); }
  }
  return null;
}

function extractPotFromLogs(output) {
  const patterns = [
    /po[_\s]?token["']?\s*[:=]\s*["']?([A-Za-z0-9_\-=\.]+)/i,
    /"pot"\s*:\s*"([^"]+)"/i,
    /"poToken"\s*:\s*"([^"]+)"/i,
  ];
  for (const p of patterns) {
    const m = output.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractVisitorData(output) {
  const m = output.match(/"visitor[_-]?data"\s*:\s*"([^"]+)"/i);
  return m ? m[1] : null;
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode === 200 || res.statusCode === 404) resolve();
          else reject(new Error(`Status: ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(2000, () => req.destroy(new Error('Timeout')));
      });
      return true;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function getTokenViaProvider() {
  console.error('[get_potoken] Starting bgutil-ytdlp-pot-provider...');
  let provider;
  try {
    const globalRoot = execSync('npm root -g').toString().trim();
    const providerPath = path.join(globalRoot, 'bgutil-ytdlp-pot-provider');
    if (!fs.existsSync(providerPath)) {
      throw new Error('bgutil-ytdlp-pot-provider not installed globally');
    }

    provider = spawn('node', [path.join(providerPath, 'dist', 'cjs', 'server.js')], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    provider.stdout.on('data', (d) => process.stderr.write(`[provider] ${d}`));
    provider.stderr.on('data', (d) => process.stderr.write(`[provider-err] ${d}`));

    const ready = await waitForServer(`http://127.0.0.1:${PROVIDER_PORT}/ping`);
    if (!ready) throw new Error('Provider failed to start');

    console.error('[get_potoken] Provider ready. Generating token via yt-dlp...');

    const cmd = `yt-dlp -v --extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:${PROVIDER_PORT}" --dump-json --skip-download --no-warnings "${TEST_VIDEO}" 2>&1`;
    const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, shell: true });

    const jsonStr = extractJsonObject(output);
    if (!jsonStr) throw new Error('No JSON object found in yt-dlp output');
    const info = JSON.parse(jsonStr);

    let potoken = info.po_token || info.pot;
    let visitorData = info.visitor_data || info.visitorData;

    if (!potoken) potoken = extractPotFromLogs(output);
    if (!visitorData) visitorData = extractVisitorData(output);

    if (!potoken) throw new Error('Could not extract PO token from output');

    return { potoken, visitorData };
  } finally {
    if (provider) try { provider.kill(); } catch {}
  }
}

async function main() {
  try {
    const result = await getTokenViaProvider();
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    console.error('[get_potoken] Error:', err.message);
    process.exit(1);
  }
}

main();
