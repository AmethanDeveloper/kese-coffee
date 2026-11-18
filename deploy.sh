#!/usr/bin/env bash
# =====================================================================
#  Kese Coffee: установка приложения на сервер Ubuntu
#  Запуск:  bash /root/coffee-app/deploy.sh
#  Свой домен (если появится):  DOMAIN=order.coffee1.kz bash /root/coffee-app/deploy.sh
#
#  Что делает: ставит веб-сервер Caddy, копирует сайт в /var/www/coffee
#  и включает HTTPS с бесплатным сертификатом. Ставит службу kese-push,
#  которая присылает персоналу уведомления о новых заказах. VPN и другие сервисы
#  не трогает: если порт 443 уже занят, сайт откроется на порту 8443.
#  Запускать повторно можно — так же обновляется сайт после правок.
# =====================================================================
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB=/var/www/coffee

if [ "$(id -u)" != "0" ]; then echo "Запустите от root (sudo bash deploy.sh)"; exit 1; fi
if [ ! -f "$SRC/index.html" ]; then echo "Не нашёл index.html рядом со скриптом ($SRC)"; exit 1; fi

echo "==> Ставлю нужные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -qq
apt-get install -y -qq curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https rsync >/dev/null
if ! command -v node >/dev/null 2>&1; then
  echo "==> Ставлю Node.js (для уведомлений персоналу)"
  apt-get install -y -qq nodejs >/dev/null || echo "   !! Node.js не установился — уведомления работать не будут"
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "==> Ставлю веб-сервер Caddy"
  if curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
     && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list \
     && apt-get update -y -qq && apt-get install -y -qq caddy >/dev/null; then
    :
  else
    echo "    официальный репозиторий недоступен, ставлю caddy из репозитория Ubuntu"
    rm -f /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y -qq && apt-get install -y -qq caddy >/dev/null
  fi
fi

# --- адрес сайта --------------------------------------------------------
IP="$(curl -4 -fsS --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')"
HOST="${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}"

# --- какие порты свободны ----------------------------------------------
owner() { ss -ltnpH "( sport = :$1 )" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2; }
P80="$(owner 80)"; P443="$(owner 443)"
if [ -n "$P80" ] && [ "$P80" != "caddy" ]; then
  echo
  echo "!! Порт 80 занят программой: $P80"
  echo "   Он нужен, чтобы получить бесплатный сертификат HTTPS."
  echo "   Освободите порт 80 (например, в 3x-ui не используйте порт 80) и запустите скрипт ещё раз."
  exit 1
fi
if [ -n "$P443" ] && [ "$P443" != "caddy" ]; then
  PORT=8443
  echo "==> Порт 443 занят ($P443) — скорее всего VPN. Не трогаю его, сайт будет на порту 8443"
else
  PORT=443
fi
if [ "$PORT" = "443" ]; then SITE="$HOST"; URL="https://$HOST"; else SITE="https://$HOST:$PORT"; URL="https://$HOST:$PORT"; fi

# --- файлы сайта -------------------------------------------------------
echo "==> Копирую сайт в $WEB"
mkdir -p "$WEB"
rsync -a --delete --exclude 'deploy.sh' --exclude 'supabase/' --exclude 'push-server/' --exclude '*.md' --exclude '.DS_Store' "$SRC/" "$WEB/"
chown -R caddy:caddy "$WEB" 2>/dev/null || chmod -R a+rX "$WEB"

# --- служба уведомлений персоналу (kese-push) ----------------------------
PUSH_ENV=/etc/kese-push.env
PUSH_OK=""
if command -v node >/dev/null 2>&1 && [ -d "$SRC/push-server" ]; then
  echo "==> Настраиваю уведомления персоналу"
  mkdir -p /opt/kese-push
  rsync -a --delete "$SRC/push-server/" /opt/kese-push/
  if [ ! -s "$PUSH_ENV" ] || ! grep -q '^VAPID_PRIVATE=' "$PUSH_ENV"; then
    node /opt/kese-push/server.js --keys > "$PUSH_ENV"
    echo "PUSH_SECRET=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$PUSH_ENV"
  fi
  # адрес сайта и ключ Supabase обновляем при каждом запуске
  SB_URL="$(sed -n "s/.*SUPABASE_URL: *'\([^']*\)'.*/\1/p" "$SRC/js/config.js" | head -1)"
  SB_KEY="$(sed -n "s/.*SUPABASE_KEY: *'\([^']*\)'.*/\1/p" "$SRC/js/config.js" | head -1)"
  sed -i '/^VAPID_SUBJECT=/d;/^SUPABASE_URL=/d;/^SUPABASE_KEY=/d;/^PUSH_PORT=/d' "$PUSH_ENV"
  { echo "VAPID_SUBJECT=$URL"; echo "SUPABASE_URL=$SB_URL"; echo "SUPABASE_KEY=$SB_KEY"; echo "PUSH_PORT=8787"; } >> "$PUSH_ENV"
  chmod 600 "$PUSH_ENV"
  cat > /etc/systemd/system/kese-push.service <<UNIT
[Unit]
Description=Kese Coffee push notifications
After=network-online.target

[Service]
EnvironmentFile=$PUSH_ENV
ExecStart=$(command -v node) /opt/kese-push/server.js
Restart=always
RestartSec=3
DynamicUser=yes
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable kese-push >/dev/null 2>&1 || true
  systemctl restart kese-push
  PUSH_OK=1
fi

# --- настройка Caddy ---------------------------------------------------
mkdir -p /etc/caddy/sites
TLS=""
if [ "$PORT" != "443" ]; then
  # на 443 работает VPN — сертификат получаем только через порт 80
  TLS=$'\ttls {\n\t\tissuer acme {\n\t\t\tdisable_tlsalpn_challenge\n\t\t}\n\t}'
fi
cat > /etc/caddy/sites/coffee.caddy <<EOF
$SITE {
$TLS
	root * $WEB
	encode zstd gzip
	reverse_proxy /push/* 127.0.0.1:8787
	file_server
	@nocache path / /index.html /sw.js /manifest.webmanifest /js/config.js
	header @nocache Cache-Control "no-cache"
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
	}
}
EOF

CF=/etc/caddy/Caddyfile
if [ ! -f "$CF" ] || grep -q '/usr/share/caddy' "$CF"; then
  # стандартный файл после установки — заменяем
  [ -f "$CF" ] && cp "$CF" "$CF.bak.$(date +%s)"
  echo 'import /etc/caddy/sites/*.caddy' > "$CF"
elif ! grep -q 'import /etc/caddy/sites/\*.caddy' "$CF"; then
  cp "$CF" "$CF.bak.$(date +%s)"
  printf '\nimport /etc/caddy/sites/*.caddy\n' >> "$CF"
fi

caddy validate --config "$CF" --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

# --- файрвол -----------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null; ufw allow "$PORT"/tcp >/dev/null
  echo "==> Открыл в файрволе порты 80 и $PORT"
fi

# --- проверка ----------------------------------------------------------
echo "==> Жду сертификат HTTPS (до минуты)"
OK=""
for i in $(seq 1 20); do
  if curl -fsS --max-time 5 -o /dev/null "$URL/"; then OK=1; break; fi
  sleep 3
done

echo
if [ -n "$OK" ]; then
  echo "Готово! Приложение работает:"
else
  echo "Сайт настроен, но HTTPS ещё не ответил. Подождите пару минут и откройте адрес."
  echo "Если не откроется: journalctl -u caddy -n 50"
fi
echo
echo "   Гости:     $URL"
echo "   Персонал:  $URL/#admin"
echo
echo "В Supabase → Authentication → URL Configuration укажите Site URL: $URL"

if [ -n "$PUSH_OK" ]; then
  sleep 1
  PUSH_SECRET="$(sed -n 's/^PUSH_SECRET=//p' "$PUSH_ENV")"
  if curl -fsS --max-time 5 "$URL/push/key" >/dev/null 2>&1; then
    echo
    echo "Уведомления персоналу: сервер работает."
  else
    echo
    echo "Уведомления персоналу: сервер не ответил. Проверьте: journalctl -u kese-push -n 30"
  fi
  echo "Один раз (или если поменяли домен) выполните в Supabase → SQL Editor:"
  echo
  echo "   select public.set_push_config('$URL/push/order', '$PUSH_SECRET');"
  echo
fi
