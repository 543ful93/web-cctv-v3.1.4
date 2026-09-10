/**
 * lib/dhcp.js — v2.9.20
 *
 * DHCP server mini untuk LAN CCTV memakai dnsmasq, supaya kamera yang dicolok
 * ke switch hub (yang tersambung ke port LAN STB) LANGSUNG mendapat IP tanpa
 * router/internet. Skema default sengaja dibuat tetap & sederhana agar tidak
 * bingung saat setting:
 *
 *   STB (gateway/LAN) : 192.168.77.1/24
 *   Kamera statis     : 192.168.77.2 – 192.168.77.99   (disarankan)
 *   Kamera via DHCP   : 192.168.77.100 – 192.168.77.200 (otomatis)
 *
 * Konfigurasi dnsmasq ditulis ke satu berkas drop-in sehingga tidak merusak
 * konfigurasi sistem lain. Jalur berkas bisa ditimpa lewat env DNSMASQ_CONF
 * (dipakai oleh uji otomatis).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const CONF_PATH = process.env.DNSMASQ_CONF || '/etc/dnsmasq.d/webcctv-lan.conf';

/** Skema IP default LAN CCTV — satu-satunya sumber kebenaran. */
const LAN_SCHEME = {
  subnet: '192.168.77',
  prefix: 24,
  stb_ip: '192.168.77.1',
  static_range: '192.168.77.2 – 192.168.77.99',
  dhcp_start: '192.168.77.100',
  dhcp_end: '192.168.77.200',
  lease: '12h',
};

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout) => resolve({ ok: !err, out: String(stdout || '').trim() }));
  });
}

async function dnsmasqInstalled() {
  const w = await run('which', ['dnsmasq']);
  if (w.ok) return true;
  const c = await run('sh', ['-c', 'command -v dnsmasq']);
  return c.ok;
}

async function dnsmasqRunning() {
  const pg = await run('sh', ['-c', 'pgrep -x dnsmasq >/dev/null 2>&1 && echo ya || echo tidak']);
  return pg.out === 'ya';
}

/** Isi berkas conf dnsmasq untuk satu interface LAN. */
function buildConf(iface) {
  const s = LAN_SCHEME;
  return [
    '# Web-CCTV v2.9.20 — DHCP server untuk LAN CCTV (dibuat otomatis, jangan edit manual)',
    `# Interface LAN STB yang menuju switch hub kamera: ${iface}`,
    `interface=${iface}`,
    'bind-interfaces',
    `dhcp-range=${s.dhcp_start},${s.dhcp_end},255.255.255.0,${s.lease}`,
    `# STB ini menjadi gateway/route default bagi kamera (bila kamera butuh):`,
    `dhcp-option=3,${s.stb_ip}`,
    'dhcp-option=6,' + s.stb_ip,
    'dhcp-lease-max=100',
    '# Jangan layani DNS dari interface ini agar tidak bentrok dengan resolver sistem.',
    'port=0',
    '',
  ].join('\n');
}

function enabled() {
  try { return fs.existsSync(CONF_PATH); } catch { return false; }
}

/** Aktifkan: tulis conf, pasang dnsmasq bila belum, muat ulang layanan. */
async function enable(iface) {
  const steps = [];
  try {
    fs.mkdirSync(path.dirname(CONF_PATH), { recursive: true });
    fs.writeFileSync(CONF_PATH, buildConf(iface), 'utf8');
    steps.push('conf ditulis: ' + CONF_PATH);
  } catch (e) {
    return { ok: false, error: 'Gagal menulis konfigurasi: ' + e.message, steps };
  }

  let installed = await dnsmasqInstalled();
  if (!installed) {
    const apt = await run('sh', ['-c', 'apt-get install -y --no-install-recommends dnsmasq >/dev/null 2>&1 || sudo -n apt-get install -y --no-install-recommends dnsmasq >/dev/null 2>&1']);
    installed = await dnsmasqInstalled();
    steps.push(apt.ok ? 'dnsmasq dipasang' : 'pemasangan dnsmasq dicoba: ' + (installed ? 'berhasil' : 'gagal (pasang manual: sudo apt-get install dnsmasq)'));
  } else {
    steps.push('dnsmasq sudah terpasang');
  }

  let restarted = false;
  if (installed) {
    const r1 = await run('sh', ['-c', 'systemctl restart dnsmasq >/dev/null 2>&1 || service dnsmasq restart >/dev/null 2>&1 || /etc/init.d/dnsmasq restart >/dev/null 2>&1']);
    restarted = r1.ok;
    steps.push(restarted ? 'layanan dnsmasq dimuat ulang' : 'gagal memuat ulang dnsmasq (jalankan: sudo service dnsmasq restart)');
  }

  return { ok: true, installed, restarted, running: await dnsmasqRunning(), steps };
}

/** Nonaktifkan: hapus conf + muat ulang layanan. */
async function disable() {
  const steps = [];
  try {
    if (fs.existsSync(CONF_PATH)) { fs.unlinkSync(CONF_PATH); steps.push('conf dihapus'); }
    else steps.push('conf tidak ada — sudah nonaktif');
  } catch (e) {
    return { ok: false, error: 'Gagal menghapus konfigurasi: ' + e.message, steps };
  }
  const r = await run('sh', ['-c', 'systemctl restart dnsmasq >/dev/null 2>&1 || service dnsmasq restart >/dev/null 2>&1 || true']);
  steps.push(r.ok ? 'dnsmasq dimuat ulang' : 'muat ulang dnsmasq dilewati');
  return { ok: true, running: await dnsmasqRunning(), steps };
}

async function status() {
  return {
    enabled: enabled(),
    conf_path: CONF_PATH,
    scheme: LAN_SCHEME,
    installed: await dnsmasqInstalled(),
    running: await dnsmasqRunning(),
  };
}

module.exports = { LAN_SCHEME, CONF_PATH, buildConf, enable, disable, status, enabled };
