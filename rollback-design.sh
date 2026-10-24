#!/bin/bash
# Вернуть дизайн дилерского портала, который был до редизайна 25.10.2026 (git-метка design-old-2026-10-25).
# Трогает только оформление: стили, страницы и скрипт каталога. Заявки, data.json, фото и arts.txt не меняются.
set -e
cd "$(dirname "$0")"
git pull --rebase
git checkout design-old-2026-10-25 -- docs/style.css docs/app.js docs/index.html docs/tile.html docs/order.html
./bump.sh
git add docs/*.html
git commit -m "Возврат старого дизайна портала (метка design-old-2026-10-25)"
git push
echo "Старый дизайн вернётся на сайт через 1–2 минуты."
