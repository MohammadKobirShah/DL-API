/**
 * Get a PO Token by talking to an already-running bgutil-ytdlp-pot-provider.
 *
 * The GitHub Action (and docker-compose) is responsible for starting the
 * provider container. This script just waits for it, then runs yt-dlp
 * against a small test video using the bgutil extractor plugin, and parses
 * the resulting JSON for the PO Token + visitor data.
 *
 * Output (stdout): { "potoken": "...", "visitorData": "..." | null }
 *
 * Required env:
 *   POT_PROVIDER_URL  - base URL of the running provider (default http://127.0.0.1:4416)
 */

const { execSync } = require('child_process');
const http = require('http');

const PROVIDER_URL = (process.env.POT_PROVIDER_URL || 'http://127.0.0.1:4416').replace(/\/+$/, '');
const PING_URL = `${PROVIDER_URL}/ping`;
const TEST_VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

const READY_TIMEOUT_MS = 60000;
const READY_POLL_MS = 1000;

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

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => req.destroy(new Error('timeout')));
    };
    const retry = () => {
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(tick, READY_POLL_MS);
    };
    tick();
  });
}

async function main() {
  try {
    console.error(`[get_potoken] Waiting for bgutil provider at ${PING_URL} ...`);
    const ready = await waitForServer(PING_URL, READY_TIMEOUT_MS);
    if (!ready) throw new Error(`bgutil provider not reachable at ${PING_URL} within ${READY_TIMEOUT_MS}ms`);

    console.error('[get_potoken] Provider ready. Generating token via yt-dlp ...');

    const cmd = [
      'yt-dlp',
      '-v',
      `--extractor-args "youtubepot-bgutilhttp:base_url=${PROVIDER_URL}"`,
      '--dump-json',
      '--skip-download',
      '--no-warnings',
      `"${TEST_VIDEO}"`,
      '2>&1',
    ].join(' ');

    const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true });

    const jsonStr = extractJsonObject(output);
    if (!jsonStr) throw new Error('No JSON object found in yt-dlp output');

    const info = JSON.parse(jsonStr);
    const potoken = info.po_token || info.pot;
    const visitorData = info.visitor_data || info.visitorData || null;

    if (!potoken) throw new Error('Could not extract PO token from yt-dlp output');

    process.stdout.write(JSON.stringify({ potoken, visitorData }));
    process.stdout.write('\n');
    process.exit(0);
  } catch (err) {
    console.error(`[get_potoken] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
