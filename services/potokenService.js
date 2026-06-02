const { spawn } = require('child_process');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const storage = require('./storageService');

class PoTokenService {
  constructor() {
    this.providerProcess = null;
    this.lastHealthCheck = null;
    this.lastHealthStatus = false;
    this.healthCheckInterval = null;
  }

  async startProvider() {
    if (!config.potoken.autoStart) {
      logger.info('PO Token provider auto-start disabled');
      return;
    }

    try {
      const healthy = await this.healthCheck();
      if (healthy) {
        logger.success('PO Token provider already running');
        this.startHealthMonitor();
        return;
      }
    } catch (e) {
      // Not running
    }

    logger.info('Starting bgutil-ytdlp-pot-provider...');

    try {
      this.providerProcess = spawn('bgutil-ytdlp-pot-provider', [], {
        detached: false,
        stdio: 'pipe',
        windowsHide: true,
      });

      this.providerProcess.on('error', (err) => {
        logger.error(`PO Token provider failed to start: ${err.message}`);
        logger.info('Hint: run the provider as a separate container/process, or set POTOKEN_PROVIDER_AUTO_START=false');
        this.providerProcess = null;
        this.lastHealthStatus = false;
      });

      this.providerProcess.stdout?.on('data', (data) => {
        logger.info(`[POT-Provider] ${data.toString().trim()}`);
      });

      this.providerProcess.stderr?.on('data', (data) => {
        logger.warn(`[POT-Provider] ${data.toString().trim()}`);
      });

      this.providerProcess.on('exit', (code) => {
        logger.warn(`PO Token provider exited with code ${code}`);
        this.providerProcess = null;
        this.lastHealthStatus = false;
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));

      const healthy = await this.healthCheck();
      if (healthy) {
        logger.success('PO Token provider started successfully');
        this.startHealthMonitor();
      } else {
        logger.warn('PO Token provider may not be ready yet');
      }
    } catch (err) {
      logger.error('Failed to start PO Token provider:', err.message);
      logger.info('Install with: npm install -g bgutil-ytdlp-pot-provider');
    }
  }

  startHealthMonitor() {
    if (this.healthCheckInterval) return;
    this.healthCheckInterval = setInterval(async () => {
      await this.healthCheck();
    }, 30000);
  }

  async healthCheck() {
    try {
      const res = await axios.get(`${config.potoken.providerUrl}/ping`, { timeout: 3000 });
      this.lastHealthCheck = new Date();
      this.lastHealthStatus = res.status === 200;
      return this.lastHealthStatus;
    } catch (e) {
      this.lastHealthStatus = false;
      return false;
    }
  }

  getYtdlpArgs() {
    const args = [];
    if (storage.hasCookies()) {
      args.push('--cookies', storage.getCookiesPath());
    }

    const tokenData = storage.getPoToken();
    const visitorData = storage.getVisitorData();

    if (tokenData && tokenData.token) {
      const expiresAt = tokenData.expiresAt ? new Date(tokenData.expiresAt) : null;
      const isExpired = expiresAt && expiresAt < new Date();

      if (!isExpired) {
        let potArgs = `po_token=web.player+${tokenData.token}`;
        if (visitorData && visitorData.visitorData) {
          potArgs += `;visitor_data=${visitorData.visitorData}`;
        }
        args.push('--extractor-args', `youtubepot:${potArgs}`);
        return args;
      } else {
        logger.warn('Stored PO Token is expired, falling back to local provider');
      }
    }

    args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${config.potoken.providerUrl}`);
    return args;
  }

  async updateFromGithub(data) {
    const { potoken, visitorData, expiresAt } = data;
    if (!potoken) {
      throw new Error('Missing potoken field');
    }
    storage.savePoToken({ token: potoken, expiresAt });
    if (visitorData) {
      storage.saveVisitorData({ visitorData });
    }
    return { success: true, message: 'PO Token updated' };
  }

  getStatus() {
    const recent = this.lastHealthCheck
      ? (Date.now() - this.lastHealthCheck.getTime()) < 60000
      : false;
    return {
      providerRunning: this.lastHealthStatus && recent,
      providerProcessManaged: this.providerProcess !== null,
      lastHealthCheck: this.lastHealthCheck,
      hasStoredToken: storage.getPoToken() !== null,
      hasCookies: storage.hasCookies(),
    };
  }

  shutdown() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.providerProcess) {
      try { this.providerProcess.kill(); } catch {}
      this.providerProcess = null;
    }
  }
}

module.exports = new PoTokenService();
