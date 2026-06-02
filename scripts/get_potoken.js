/**
 * Get a PO Token by calling the bgutil-ytdlp-pot-provider's /get_pot HTTP
 * endpoint. The GitHub Action (and docker-compose) is responsible for
 * starting the provider container. This script just waits for it, then
 * POSTs to the endpoint and parses the response.
 *
 * Token generation is local (Botguard JS challenge via bgutils-js); it does
 * NOT scrape a YouTube video page, so it works from CI runners whose IP
 * YouTube has flagged for the web player.
 *
 * Output (stdout): { "potoken": "...", "visitorData": "..." | null, "expiresAt": "ISO" }
 *
 * Required env:
 *   POT_PROVIDER_URL  - base URL of the running provider (default http://127.0.0.1:4416)
 *   PROXY             - optional HTTP/HTTPS proxy for the provider's upstream call
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PROVIDER_URL = (process.env.POT_PROVIDER_URL || 'http://127.0.0.1:4416').replace(/\/+$/, '');
const PING_URL = `${PROVIDER_URL}/ping`;
const GET_POT_URL = `${PROVIDER_URL}/get_pot`;

const READY_TIMEOUT_MS = 60000;
const READY_POLL_MS = 1000;
const GET_POT_TIMEOUT_MS = 180000; // first call can take a while (Botguard challenge + mint)

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

function postJson(targetUrl, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const payload = Buffer.from(JSON.stringify(body), 'utf8');

    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'Accept': 'application/json',
      },
      timeout: timeoutMs,
    }, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`POST ${targetUrl} returned HTTP ${res.statusCode}: ${chunks}`));
        }
        try {
          resolve(JSON.parse(chunks));
        } catch (e) {
          reject(new Error(`Failed to parse response JSON: ${e.message}\nBody: ${chunks}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callGetPot() {
  // First /get_pot call may be slow (Botguard challenge + minter creation
  // + YouTube /att/get fetch). Retry a couple of times to ride out transient
  // upstream errors from YouTube's bot checks on CI IPs.
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.error(`[get_potoken] POST /get_pot (attempt ${attempt}/${maxAttempts}) ...`);
      return await postJson(GET_POT_URL, { bypass_cache: true }, GET_POT_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      console.error(`[get_potoken] attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxAttempts) {
        const wait = attempt * 10; // 10s, 20s
        console.error(`[get_potoken] retrying in ${wait}s ...`);
        await sleep(wait * 1000);
      }
    }
  }
  throw lastErr;
}

async function main() {
  try {
    console.error(`[get_potoken] Waiting for bgutil provider at ${PING_URL} ...`);
    const ready = await waitForServer(PING_URL, READY_TIMEOUT_MS);
    if (!ready) throw new Error(`bgutil provider not reachable at ${PING_URL} within ${READY_TIMEOUT_MS}ms`);

    console.error(`[get_potoken] Provider ready. Requesting PO Token from ${GET_POT_URL} ...`);

    const session = await callGetPot();

    if (!session || !session.poToken) {
      throw new Error(`Provider response missing poToken. Got: ${JSON.stringify(session)}`);
    }

    const out = {
      potoken: session.poToken,
      visitorData: session.contentBinding || null,
      expiresAt: session.expiresAt
        ? new Date(session.expiresAt).toISOString()
        : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    };

    process.stdout.write(JSON.stringify(out));
    process.stdout.write('\n');
    process.exit(0);
  } catch (err) {
    console.error(`[get_potoken] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
