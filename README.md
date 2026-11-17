# Kali Startup Notifier

A lightweight, zero-dependency Node.js `systemd` service that sends a Discord push notification with system telemetry and geolocation details every time your Kali Linux machine boots.

## Features

- **Zero external dependencies** — uses only Node.js built-in modules (`os`, `fs`, `path`, `https`).
- **Network-aware boot execution** — waits for `network-online.target` and retries automatically if the network is still initializing.
- **Rich Discord embed alerts** — reports Public IP, approximate city/country, ISP, Hostname, Local IPv4, UTC boot timestamp, OS/architecture, and CPU model.

## Prerequisites

- Debian / Kali Linux with `systemd`
- Node.js (`sudo apt install -y nodejs`)
- A Discord Server Webhook URL

## Quick Installation

~~~bash
git clone https://github.com/qaurav/kali-startup-notifier.git
cd kali-startup-notifier
sudo ./install.sh
~~~

The installer copies the script to `/opt/kali-notifier/`, prompts for your Discord Webhook URL (stored securely in `/opt/kali-notifier/.env` with `600` permissions), and enables `kali-notifier.service`.

## Testing & Logs

Trigger a test alert immediately without rebooting:

~~~bash
sudo systemctl start kali-notifier.service
~~~

Check service logs:

~~~bash
journalctl -u kali-notifier.service -n 20
~~~

## Uninstall

~~~bash
sudo systemctl disable --now kali-notifier.service
sudo rm -f /etc/systemd/system/kali-notifier.service
sudo rm -rf /opt/kali-notifier
sudo systemctl daemon-reload
~~~
