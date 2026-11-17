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
NM_DISPATCHER_DIR="/etc/NetworkManager/dispatcher.d"

echo "[*] Installing Kali Startup Notifier v2.0 to ${INSTALL_DIR} for user '${TARGET_USER}'..."
mkdir -p "${INSTALL_DIR}"
cp notification_script.js "${INSTALL_DIR}/notification_script.js"
chown -R "${TARGET_USER}:${TARGET_USER}" "${INSTALL_DIR}"
chmod 755 "${INSTALL_DIR}/notification_script.js"

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    read -rp "Enter your Discord Webhook URL: " WEBHOOK_URL
    if [[ -z "${WEBHOOK_URL}" ]]; then
        echo "Error: Discord Webhook URL cannot be empty."
        exit 1
    fi

    TG_TOKEN=""
    TG_CHAT=""
    if [[ -t 0 ]]; then
        read -rp "Optional - Telegram Bot Token (press Enter to skip): " TG_TOKEN || true
        if [[ -n "${TG_TOKEN}" ]]; then
            read -rp "Optional - Telegram Chat ID: " TG_CHAT || true
        fi
    fi

    {
        echo "DISCORD_WEBHOOK_URL=\"${WEBHOOK_URL}\""
        if [[ -n "${TG_TOKEN}" && -n "${TG_CHAT}" ]]; then
            echo "TELEGRAM_BOT_TOKEN=\"${TG_TOKEN}\""
            echo "TELEGRAM_CHAT_ID=\"${TG_CHAT}\""
        fi
    } > "${INSTALL_DIR}/.env"

    chown "${TARGET_USER}:${TARGET_USER}" "${INSTALL_DIR}/.env"
    chmod 600 "${INSTALL_DIR}/.env"
else
    echo "[*] Existing ${INSTALL_DIR}/.env preserved."
fi

sed -e "s|__USER__|${TARGET_USER}|g" -e "s|__NODE__|${NODE_BIN}\vert{}g" kali-notifier.service > "${SERVICE_FILE}"

if [[ -d "${NM_DISPATCHER_DIR}" ]]; then
    sed -e "s|__USER__|${TARGET_USER}|g" -e "s|__NODE__|${NODE_BIN}\vert{}g" 99-kali-notifier > "${NM_DISPATCHER_DIR}/99-kali-notifier"
    chown root:root "${NM_DISPATCHER_DIR}/99-kali-notifier"
    chmod 755 "${NM_DISPATCHER_DIR}/99-kali-notifier"
    echo "[*] Installed NetworkManager wake/Wi-Fi hook at ${NM_DISPATCHER_DIR}/99-kali-notifier"
fi

systemctl daemon-reload
systemctl enable kali-notifier.service

echo "[+] Installed and enabled v2.0! Test it now with: sudo systemctl start kali-notifier.service"
