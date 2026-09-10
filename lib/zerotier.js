'use strict';

/**
 * ZeroTier controller for the Web-CCTV Network page.
 * All commands use execFile (never a shell with user input). Network IDs are
 * restricted to ZeroTier's 16-hex format before reaching the command line.
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const NETWORK_ID_RE = /^[0-9a-fA-F]{16}$/;
const CLI_PATHS = ['/usr/sbin/zerotier-cli', '/usr/bin/zerotier-cli', '/usr/local/bin/zerotier-cli'];

function run(file, args = [], timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const output = String(stdout || stderr || '').trim();
      if (err) return reject(new Error(output || err.message));
      resolve(output);
    });
  });
}

function findCli() {
  return CLI_PATHS.find(p => fs.existsSync(p)) || null;
}

function fetchInstaller(url = 'https://install.zerotier.com/', redirects = 4) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000, headers: { 'User-Agent': 'WebCCTV-ZeroTier-Installer' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Terlalu banyak pengalihan installer'));
        return resolve(fetchInstaller(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Installer ZeroTier gagal diunduh: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 1024 * 1024) req.destroy(new Error('Installer terlalu besar'));
        else chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('Waktu unduh installer habis')));
    req.on('error', reject);
  });
}

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function createZeroTierService() {
  let busy = false;
  let lastError = null;

  async function status() {
    const cli = findCli();
    const base = {
      supported: process.platform === 'linux',
      installed: Boolean(cli),
      busy,
      online: false,
      node_id: null,
      version: null,
      networks: [],
      last_error: lastError,
    };
    if (!cli) return base;
    try {
      const info = parseJson(await run(cli, ['-j', 'info']), {});
      const networks = parseJson(await run(cli, ['-j', 'listnetworks']), []);
      base.online = String(info.online ?? info.status ?? '').toUpperCase() === 'ONLINE' || info.online === true;
      base.node_id = info.address || null;
      base.version = info.version || null;
      base.networks = (Array.isArray(networks) ? networks : []).map(n => ({
        id: String(n.nwid || n.id || ''),
        name: String(n.name || ''),
        status: String(n.status || ''),
        type: String(n.type || ''),
        device: String(n.portDeviceName || n.device || ''),
        mac: String(n.mac || ''),
        assigned_addresses: Array.isArray(n.assignedAddresses) ? n.assignedAddresses.map(String) : [],
        allow_managed: n.allowManaged !== false,
        allow_global: n.allowGlobal === true,
        allow_default: n.allowDefault === true,
        allow_dns: n.allowDNS === true,
      }));
      lastError = null;
      base.last_error = null;
    } catch (err) {
      lastError = err.message;
      base.last_error = lastError;
    }
    return base;
  }

  async function install() {
    if (process.platform !== 'linux') throw new Error('Instalasi otomatis ZeroTier hanya tersedia di Linux/Armbian.');
    if (findCli()) return { already_installed: true, ...(await status()) };
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
      throw new Error('Web-CCTV harus berjalan sebagai root untuk memasang ZeroTier otomatis.');
    }
    if (busy) throw new Error('Proses ZeroTier lain masih berjalan.');
    busy = true;
    lastError = null;
    const tmp = path.join(os.tmpdir(), `webcctv-zerotier-install-${process.pid}.sh`);
    try {
      const script = await fetchInstaller();
      const text = script.toString('utf8');
      if (script.length < 500 || !/ZeroTier|zerotier/i.test(text)) throw new Error('Isi installer ZeroTier tidak valid.');
      fs.writeFileSync(tmp, script, { mode: 0o700 });
      await run('/bin/bash', [tmp], 5 * 60 * 1000);
      try { await run('/bin/systemctl', ['enable', '--now', 'zerotier-one'], 30000); } catch {}
      if (!findCli()) throw new Error('Instalasi selesai tetapi zerotier-cli tidak ditemukan.');
      return { success: true, ...(await status()) };
    } catch (err) {
      lastError = err.message;
      throw err;
    } finally {
      busy = false;
      try { fs.unlinkSync(tmp); } catch {}
    }
  }

  async function join(networkId) {
    const id = String(networkId || '').trim().toLowerCase();
    if (!NETWORK_ID_RE.test(id)) throw new Error('Network ID harus tepat 16 karakter heksadesimal.');
    const cli = findCli();
    if (!cli) throw new Error('ZeroTier belum terpasang. Klik Pasang ZeroTier terlebih dahulu.');
    if (busy) throw new Error('Proses ZeroTier lain masih berjalan.');
    busy = true;
    try {
      const output = await run(cli, ['join', id], 20000);
      if (!/OK|200/i.test(output)) throw new Error(output || 'Permintaan bergabung ditolak ZeroTier.');
      await new Promise(resolve => setTimeout(resolve, 800));
      return { success: true, network_id: id, ...(await status()) };
    } finally { busy = false; }
  }

  async function leave(networkId) {
    const id = String(networkId || '').trim().toLowerCase();
    if (!NETWORK_ID_RE.test(id)) throw new Error('Network ID tidak valid.');
    const cli = findCli();
    if (!cli) throw new Error('ZeroTier belum terpasang.');
    if (busy) throw new Error('Proses ZeroTier lain masih berjalan.');
    busy = true;
    try {
      const output = await run(cli, ['leave', id], 20000);
      if (!/OK|200/i.test(output)) throw new Error(output || 'Gagal keluar dari jaringan ZeroTier.');
      return { success: true, network_id: id, ...(await status()) };
    } finally { busy = false; }
  }

  return { status, install, join, leave, validateNetworkId: id => NETWORK_ID_RE.test(String(id || '')) };
}

module.exports = { createZeroTierService, NETWORK_ID_RE };
