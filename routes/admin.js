const express = require('express');
const router = express.Router();
const potoken = require('../services/potokenService');
const storage = require('../services/storageService');

// POST /api/admin/potoken
router.post('/potoken', async (req, res, next) => {
  try {
    const result = await potoken.updateFromGithub(req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/admin/cookies
// Content-Type: text/plain with Netscape cookie file body
// OR Content-Type: application/json with { content: "..." }
router.post('/cookies', express.text({ limit: '10mb' }), (req, res) => {
  try {
    let content = '';
    if (typeof req.body === 'string') {
      content = req.body;
    } else if (req.body && req.body.content) {
      content = req.body.content;
    } else {
      return res.status(400).json({ success: false, error: 'No cookies content provided' });
    }
    if (!content) {
      return res.status(400).json({ success: false, error: 'Empty cookies content' });
    }

    const trimmed = content.trim();
    const looksLikeNetscape =
      trimmed.startsWith('# Netscape') ||
      trimmed.startsWith('# This file') ||
      trimmed.startsWith('# HTTP Cookie File');

    if (!looksLikeNetscape) {
      try {
        const json = JSON.parse(content);
        if (Array.isArray(json)) {
          content = '# Netscape HTTP Cookie File\n' + json.map((c) => {
            const domain = c.domain || c.host || '';
            const includeSubdomains = c.hostOnly ? 'FALSE' : 'TRUE';
            const path = c.path || '/';
            const secure = c.secure ? 'TRUE' : 'FALSE';
            const expiry = c.expirationDate ? Math.floor(c.expirationDate).toString() : '0';
            return [domain, includeSubdomains, path, secure, expiry, c.name, c.value].join('\t');
          }).join('\n');
        } else {
          return res.status(400).json({ success: false, error: 'Invalid JSON cookies format. Expected array.' });
        }
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid cookies format. Use Netscape format or JSON cookie export.' });
      }
    }

    const success = storage.saveCookies(content);
    res.json({ success, message: success ? 'Cookies updated' : 'Failed to save cookies' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/status
router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      ...potoken.getStatus(),
      potokenData: storage.getPoToken(),
      visitorData: storage.getVisitorData(),
    },
  });
});

// POST /api/admin/restart-provider
router.post('/restart-provider', async (req, res, next) => {
  try {
    if (potoken.providerProcess) {
      potoken.providerProcess.kill();
      potoken.providerProcess = null;
    }
    await potoken.startProvider();
    res.json({ success: true, message: 'Provider restart triggered' });
  } catch (err) { next(err); }
});

module.exports = router;
