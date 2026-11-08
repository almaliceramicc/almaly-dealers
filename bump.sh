#!/bin/bash
# Проставляет версию у style.css и *.js во всех страницах, чтобы браузеры не показывали старое.
set -e
cd "$(dirname "$0")/docs"
V=$(date +%y%m%d%H%M)
for f in *.html; do
  perl -0pi -e "s/(href=\"style\.css)(\?v=[0-9]+)?\"/\$1?v=$V\"/g; s/(src=\"(?:config|app|order|admin|dnd|editor|theme|photo-edit)\.js)(\?v=[0-9]+)?\"/\$1?v=$V\"/g" "$f"
done
echo "версия ресурсов: $V"
