#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Please run as root: sudo ./install.sh"
    exit 1
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "${NODE_BIN}" ]]; then
    echo "Node.js is not installed. Install it first: sudo apt update && sudo apt install -y nodejs"
    exit 1
fi

TARGET_USER="${SUDO_USER:-$(whoami)}"
INSTALL_DIR="/opt/kali-notifier"
SERVICE_FILE="/etc/systemd/system/kali-notifier.service"

echo "[*] Installing Kali Startup Notifier to ${INSTALL_DIR} for user '${TARGET_USER}'..."
mkdir -p "${INSTALL_DIR}"
cp notification_script.js "${INSTALL_DIR}/notification_script.js"
chmod 755 "${INSTALL_DIR}/notification_script.js"

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    read -rp "Enter your Discord Webhook URL: " WEBHOOK_URL
    if [[ -z "${WEBHOOK_URL}" ]]; then
        echo "Error: Discord Webhook URL cannot be empty."
        exit 1
    fi
    echo "DISCORD_WEBHOOK_URL=\"${WEBHOOK_URL}\"" > "${INSTALL_DIR}/.env"
    chown "${TARGET_USER}:${TARGET_USER}" "${INSTALL_DIR}/.env"
    chmod 600 "${INSTALL_DIR}/.env"
else
    echo "[*] Existing ${INSTALL_DIR}/.env preserved."
fi

sed -e "s|__USER__|${TARGET_USER}|g" -e "s|__NODE__|${NODE_BIN}|g" kali-notifier.service > "${SERVICE_FILE}"

systemctl daemon-reload
systemctl enable kali-notifier.service

echo "[+] Installed and enabled! Test it now with: sudo systemctl start kali-notifier.service"
