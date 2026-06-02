const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

const TOKEN_FILE = path.join(config.dataDir, 'potoken.json');
const VISITOR_FILE = path.join(config.dataDir, 'visitor_data.json');

class StorageService {
  savePoToken(data) {
    try {
      const payload = { ...data, updatedAt: new Date().toISOString() };
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(payload, null, 2));
      logger.success('PO Token saved to storage');
      return true;
    } catch (err) {
      logger.error('Failed to save PO Token:', err.message);
      return false;
    }
  }

  getPoToken() {
    try {
      if (!fs.existsSync(TOKEN_FILE)) return null;
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    } catch (err) {
      logger.error('Failed to read PO Token:', err.message);
      return null;
    }
  }

  saveVisitorData(data) {
    try {
      const payload = { ...data, updatedAt: new Date().toISOString() };
      fs.writeFileSync(VISITOR_FILE, JSON.stringify(payload, null, 2));
      logger.success('Visitor data saved');
      return true;
    } catch (err) {
      logger.error('Failed to save visitor data:', err.message);
      return false;
    }
  }

  getVisitorData() {
    try {
      if (!fs.existsSync(VISITOR_FILE)) return null;
      return JSON.parse(fs.readFileSync(VISITOR_FILE, 'utf8'));
    } catch (err) {
      return null;
    }
  }

  saveCookies(content) {
    try {
      fs.writeFileSync(config.cookiesFile, content);
      logger.success(`Cookies saved to ${config.cookiesFile}`);
      return true;
    } catch (err) {
      logger.error('Failed to save cookies:', err.message);
      return false;
    }
  }

  hasCookies() {
    return fs.existsSync(config.cookiesFile) && fs.statSync(config.cookiesFile).size > 0;
  }

  getCookiesPath() {
    return config.cookiesFile;
  }
}

module.exports = new StorageService();
