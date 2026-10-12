#!/usr/bin/env bash
# เพิ่ม location /mra ใน /etc/nginx/conf.d/sbh.conf แบบปลอดภัย
# ใช้: sudo bash /opt/mra-ipd/deploy/nginx/install-mra.sh
# - backup ไฟล์เดิมก่อน · ถ้า nginx -t ไม่ผ่านจะคืนไฟล์เดิมให้ และไม่ reload
# - รันซ้ำได้ (ถ้ามี location /mra แล้วจะไม่เพิ่มซ้ำ)
set -euo pipefail

CONF=/etc/nginx/conf.d/sbh.conf
LOGFMT=/etc/nginx/conf.d/mra-logformat.conf
HERE="$(cd "$(dirname "$0")" && pwd)"
BAK="$CONF.bak-mra-$(date +%Y%m%d%H%M%S)"

[ "$(id -u)" -eq 0 ] || { echo "ต้องรันด้วย sudo"; exit 1; }
[ -f "$CONF" ] || { echo "ไม่พบ $CONF"; exit 1; }

if grep -q "location \^~ /mra" "$CONF"; then
  echo "มี location /mra อยู่แล้ว ไม่ต้องเพิ่ม"
else
  cp -p "$CONF" "$BAK"
  echo "backup: $BAK"
  cp "$HERE/mra-logformat.conf" "$LOGFMT"

  # แทรก block ก่อน } บรรทัดสุดท้ายของไฟล์ (ปิด server block ของ 10.0.120.17)
  last=$(grep -n '^}' "$CONF" | tail -1 | cut -d: -f1)
  [ -n "$last" ] || { echo "หา } ปิด server block ไม่เจอ"; exit 1; }
  block=$(grep -v '^#' "$HERE/mra-location.conf" | sed '/^$/d')
  { head -n $((last - 1)) "$CONF"; echo; echo "    # --- MRA IPD (http://10.0.120.17/mra) ---"; echo "$block"; tail -n +"$last" "$CONF"; } > "$CONF.new"
  mv "$CONF.new" "$CONF"
fi

if nginx -t; then
  systemctl reload nginx
  echo "สำเร็จ: เปิด http://10.0.120.17/mra"
else
  echo "nginx -t ไม่ผ่าน → คืนไฟล์เดิม ไม่ reload"
  [ -f "$BAK" ] && cp -p "$BAK" "$CONF"
  rm -f "$LOGFMT"
  nginx -t || true
  exit 1
fi
