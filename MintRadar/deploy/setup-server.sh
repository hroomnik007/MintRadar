#!/bin/bash
# Run once on Hetzner server to set up PrivyZap hosting.
# Usage: cd deploy/ && bash setup-server.sh
set -e

DOMAIN="privyzap.pedani.eu"
WEB_ROOT="/var/www/privyzap"
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
EMAIL="your@email.com"  # replace before running

echo "==> Creating web root ${WEB_ROOT}"
sudo mkdir -p "${WEB_ROOT}"

echo "==> Installing Nginx config"
sudo cp nginx.conf "${NGINX_CONF}"
sudo ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/

echo "==> Testing Nginx config"
sudo nginx -t

echo "==> Reloading Nginx"
sudo systemctl reload nginx

echo "==> Obtaining SSL certificate"
sudo certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}"

echo ""
echo "Done. PrivyZap will be live at https://${DOMAIN} after the first GitHub Actions deploy."
