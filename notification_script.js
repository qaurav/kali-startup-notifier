// notification_script.js
// Gathers system info and approximate geolocation, then sends a boot alert via Discord Webhook.

const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { platform, hostname, cpus, networkInterfaces, arch } = os;

/**
 * Lightweight .env loader (avoids external npm dependencies).
 */
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        const val = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
            process.env[key] = val;
        }
    }
}

loadEnv();

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

/**
 * Finds the first non-internal IPv4 address (Local/Private IP).
 * @returns {string}
 */
function getLocalIpAddress() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'N/A (Check network settings)';
}

/**
 * Fetches public IP and approximate geolocation data.
 * @returns {Promise<object>}
 */
function getPublicIpAndLocation() {
    return new Promise((resolve) => {
        https.get('https://ipwho.is/', (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.success) {
                        resolve({
                            ip: json.ip || 'N/A',
                            city: json.city || 'Unknown',
                            country: json.country || 'Unknown',
                            isp: (json.connection && json.connection.isp) || 'Unknown'
                        });
                    } else {
                        resolve({ ip: 'N/A', city: 'Unknown', country: 'Unknown', isp: 'Unknown' });
                    }
                } catch (err) {
                    console.error('Error parsing geolocation response:', err.message);
                    resolve({ ip: 'N/A', city: 'Error', country: 'Error', isp: 'Error' });
                }
            });
        }).on('error', (err) => {
            console.error('Geolocation network error:', err.message);
            resolve({ ip: 'N/A', city: 'Offline', country: 'Offline', isp: 'Offline' });
        });
    });
}

/**
 * Builds the Discord embed payload.
 * @param {object} geoData
 * @returns {object}
 */
function getNotificationPayload(geoData) {
    const systemName = platform();
    const machineType = arch();
    const processorModel = cpus().length > 0 ? cpus()[0].model : 'Unknown Processor';
    const privateIpAddress = getLocalIpAddress();
    const hostName = hostname();
    const currentTime = new Date().toISOString();

    const publicIp = geoData.ip || 'N/A';
    const location = (geoData.city && geoData.country)
        ? `${geoData.city}, ${geoData.country}`
        : 'Unknown Location';
    const isp = geoData.isp || 'N/A';

    return {
        content: `🔴 **ALERT:** System (${hostName}) booted up from ${location}!`,
        embeds: [
            {
                title: `🚨 BOOT DETECTED: ${hostName} (${publicIp})`,
                description: 'A startup sequence completed on your monitored Linux system. Verify the location and time below. If unexpected, investigate immediately.',
                color: 16711680,
                fields: [
                    { name: '🌍 Public IP (External)', value: `\`${publicIp}\``, inline: true },
                    { name: '📍 Approx. Location', value: `\`${location}\``, inline: true },
                    { name: '📡 ISP / Network Provider', value: `\`${isp}\``, inline: false },
                    { name: '💻 Hostname', value: `\`${hostName}\``, inline: true },
                    { name: '🏠 Private IP (Local)', value: `\`${privateIpAddress}\``, inline: true },
                    { name: '⏱️ Timestamp (UTC)', value: `\`${currentTime}\``, inline: false },
                    { name: '⚙️ OS / Arch', value: `${systemName} (${machineType})`, inline: true },
                    { name: '🧠 Processor', value: processorModel, inline: true }
                ],
                footer: {
                    text: 'Kali Security Watchdog | Monitor system logs for login attempts.'
                },
                timestamp: currentTime
            }
        ]
    };
}

/**
 * Sends the JSON payload to the configured Discord Webhook.
 * @param {object} data
 */
function sendPushNotification(data) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('YOUR_WEBHOOK')) {
        console.error('Error: DISCORD_WEBHOOK_URL is not configured. Set it in .env');
        process.exitCode = 1;
        return;
    }

    console.log('Sending boot notification to Discord Webhook...');
    const postData = JSON.stringify(data);
    const url = new URL(DISCORD_WEBHOOK_URL);

    const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = https.request(options, (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
            if (res.statusCode === 204) {
                console.log('Push notification sent successfully (HTTP 204).');
            } else {
                console.error(`Discord webhook failed (HTTP ${res.statusCode}): ${responseBody}`);
                process.exitCode = 1;
            }
        });
    });

    req.on('error', (err) => {
        console.error(`Network error sending Discord webhook: ${err.message}`);
        process.exitCode = 1;
    });

    req.write(postData);
    req.end();
}

async function main() {
    console.log('Gathering system and geolocation info...');
    const geoData = await getPublicIpAndLocation();
    const payload = getNotificationPayload(geoData);
    sendPushNotification(payload);
}

main();
