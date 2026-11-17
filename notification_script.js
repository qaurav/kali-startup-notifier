#!/usr/bin/env node
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const BASE_DIR = __dirname;
const ENV_PATH = path.join(BASE_DIR, '.env');
const QUEUE_PATH = path.join(BASE_DIR, 'offline_queue.json');
const LAST_SENT_PATH = path.join(BASE_DIR, '.last_sent');
const COOLDOWN_MS = 10000;
const MAX_QUEUE_ITEMS = 25;

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

function getBootId() {
  try {
    return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return 'unknown-boot';
  }
}

function getBatteryStatus() {
  try {
    const psDir = '/sys/class/power_supply';
    if (!fs.existsSync(psDir)) return 'N/A';
    const bat = fs.readdirSync(psDir).find((e) => e.startsWith('BAT'));
    if (!bat) return 'AC / Desktop (No Battery)';
    const cap = fs.readFileSync(path.join(psDir, bat, 'capacity'), 'utf8').trim();
    const status = fs.readFileSync(path.join(psDir, bat, 'status'), 'utf8').trim();
    return `${cap}% (${status})`;
  } catch {
    return 'Unknown';
  }
}

function getWifiInfo() {
  const raw = safeExec('nmcli -t -f active,ssid,bssid dev wifi');
  if (!raw) return 'Ethernet / Unknown';
  const activeLine = raw.split(/\r?\n/).find((l) => l.startsWith('yes:'));
  if (!activeLine) return 'Ethernet / Disconnected';
  const parts = activeLine.split(':');
  const ssid = parts[1] || 'Hidden SSID';
  const bssid = parts.slice(2).join(':').replace(/\\:/g, ':');
  return bssid ? `${ssid} (${bssid})` : ssid;
}

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const list = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        list.push(`${name}: ${addr.address}`);
      }
    }
  }
  return list.length > 0 ? list.join(', ') : 'None';
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'kali-startup-notifier/2.1',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function fetchGeoLocation() {
  const providers = [
    {
      name: 'ipwho.is',
      url: 'https://ipwho.is/',
      parse: (j) => {
        if (!j || j.success === false || !j.ip) return null;
        return {
          ip: j.ip,
          city: j.city || 'Unknown',
          region: j.region || '',
          country: j.country || 'Unknown',
          isp: (j.connection && (j.connection.isp || j.connection.org)) || j.isp || 'Unknown',
        };
      },
    },
    {
      name: 'ipinfo.io',
      url: 'https://ipinfo.io/json',
      parse: (j) => {
        if (!j || !j.ip) return null;
        return {
          ip: j.ip,
          city: j.city || 'Unknown',
          region: j.region || '',
          country: j.country || 'Unknown',
          isp: j.org || 'Unknown',
        };
      },
    },
    {
      name: 'ifconfig.co',
      url: 'https://ifconfig.co/json',
      parse: (j) => {
        if (!j || !j.ip) return null;
        return {
          ip: j.ip,
          city: j.city || 'Unknown',
          region: j.region_name || '',
          country: j.country || 'Unknown',
          isp: j.asn_org || 'Unknown',
        };
      },
    },
  ];

  for (const p of providers) {
    try {
      const res = await fetchWithTimeout(p.url, {}, 4000);
      if (res.ok) {
        const parsed = p.parse(JSON.parse(res.text));
        if (parsed) return { ...parsed, provider: p.name };
      }
    } catch {
      // Try next fallback provider
    }
  }
  return null;
}

function readQueue() {
  try {
    if (!fs.existsSync(QUEUE_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  try {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(items.slice(-MAX_QUEUE_ITEMS), null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('Failed to write offline queue:', err.message);
  }
}

function queueOfflineEvent(snapshot) {
  const queue = readQueue();
  const alreadyQueued = queue.some(
    (item) => item.bootId === snapshot.bootId && item.trigger === snapshot.trigger
  );
  if (!alreadyQueued) {
    queue.push(snapshot);
    writeQueue(queue);
    console.log(`[Offline] Queued event (${snapshot.trigger}) at ${snapshot.timestamp}`);
  } else {
    console.log('[Offline] Event already queued for this boot session; waiting for network.');
  }
}

async function sendDiscord(webhookUrl, snapshot, geo, queuedEvents) {
  const locationParts = [geo.city, geo.region, geo.country].filter(Boolean);
  const locationStr = locationParts.join(', ') || 'Unknown Location';
  const isColdBoot = snapshot.trigger.toLowerCase().includes('boot');

  const fields = [
    { name: '🖥️ Hostname & OS', value: `\`${snapshot.hostname}\` (${snapshot.platform}/${snapshot.arch})`, inline: true },
    { name: '⚡ Trigger', value: snapshot.trigger, inline: true },
    { name: '⏱️ Uptime', value: snapshot.uptime, inline: true },
    { name: '🌐 Public IP', value: `\`${geo.ip}\``, inline: true },
    { name: '🏢 ISP / Org', value: geo.isp, inline: true },
    { name: '📍 Location', value: `${locationStr} *(via ${geo.provider})*`, inline: true },
    { name: '📶 Wi-Fi / Network', value: snapshot.wifi, inline: true },
    { name: '🔋 Battery / Power', value: snapshot.battery, inline: true },
    { name: '🔌 Local IP(s)', value: `\`${snapshot.localIPs}\``, inline: false },
  ];

  if (queuedEvents.length > 0) {
    const historyLines = queuedEvents.map(
      (e) => `• **${e.trigger}** at \`${e.timestamp}\` (Battery: ${e.battery})`
    );
    fields.push({
      name: `📦 Queued Offline Events (${queuedEvents.length})`,
      value: historyLines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  const res = await fetchWithTimeout(
    webhookUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Kali System Notifier',
        content: `🔴 **ALERT:** System (\`${snapshot.hostname}\`) online from **${locationStr}**!`,
        embeds: [
          {
            title: isColdBoot ? '🚨 System Boot Alert' : '🔄 Network / Wake Alert',
            color: isColdBoot ? 0xed4245 : 0x5865f2,
            fields,
            footer: { text: `kali-startup-notifier v2.1 • ${snapshot.timestamp}` },
          },
        ],
      }),
    },
    6000
  );

  if (!res.ok) {
    throw new Error(`Discord webhook failed with HTTP ${res.status}: ${res.text}`);
  }
  return res.status;
}

async function sendTelegram(botToken, chatId, snapshot, geo, queuedEvents) {
  if (!botToken || !chatId) return;
  const locationStr = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
  let text =
    `🚨 *System Alert: ${snapshot.hostname}*\n` +
    `• *Trigger:* ${snapshot.trigger}\n` +
    `• *Location:* ${locationStr}\n` +
    `• *Public IP:* \`${geo.ip}\` (${geo.isp})\n` +
    `• *Wi-Fi:* ${snapshot.wifi}\n` +
    `• *Battery:* ${snapshot.battery}\n` +
    `• *Local IP:* \`${snapshot.localIPs}\``;

  if (queuedEvents.length > 0) {
    text += `\n\n📦 *Queued Offline Events (${queuedEvents.length}):*\n`;
    text += queuedEvents.map((e) => `- ${e.trigger} @ ${e.timestamp}`).join('\n');
  }

  await fetchWithTimeout(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    },
    5000
  );
}

async function main() {
  loadEnv(ENV_PATH);

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const trigger = args.find((a) => !a.startsWith('--')) || 'Cold Boot';

  if (!force && fs.existsSync(LAST_SENT_PATH)) {
    const lastSent = Number(fs.readFileSync(LAST_SENT_PATH, 'utf8').trim() || '0');
    if (Date.now() - lastSent < COOLDOWN_MS) {
      console.log('Cooldown active; skipping duplicate notification.');
      process.exit(0);
    }
  }

  const snapshot = {
    bootId: getBootId(),
    timestamp: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'),
    trigger,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: formatUptime(os.uptime()),
    wifi: getWifiInfo(),
    battery: getBatteryStatus(),
    localIPs: getLocalIPs(),
  };

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;

  if (!webhookUrl && (!tgToken || !tgChatId)) {
    console.error('Error: Neither DISCORD_WEBHOOK_URL nor Telegram credentials are configured in .env');
    process.exit(1);
  }

  const geo = await fetchGeoLocation();
  if (!geo) {
    queueOfflineEvent(snapshot);
    process.exit(1);
  }

  const queuedEvents = readQueue();

  try {
    if (webhookUrl) {
      const code = await sendDiscord(webhookUrl, snapshot, geo, queuedEvents);
      console.log(`Discord notification sent successfully (HTTP ${code})`);
    }
    if (tgToken && tgChatId) {
      await sendTelegram(tgToken, tgChatId, snapshot, geo, queuedEvents);
      console.log('Telegram notification sent successfully');
    }

    if (queuedEvents.length > 0 && fs.existsSync(QUEUE_PATH)) {
      fs.unlinkSync(QUEUE_PATH);
    }
    fs.writeFileSync(LAST_SENT_PATH, String(Date.now()), { mode: 0o600 });
  } catch (err) {
    console.error('Delivery failed:', err.message);
    queueOfflineEvent(snapshot);
    process.exit(1);
  }
}

main();
