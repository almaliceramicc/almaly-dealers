#!/usr/bin/env python3
"""Обновляет карточки каталога дилерского портала из Google-таблицы.

Трогает только товарные поля: название, формат, покрытие, упаковку, паллету и остатки.
Список фотографий остаётся тем, что задан в редакторе портала.
"""
import csv, io, json, unicodedata, urllib.request
from pathlib import Path

SHEET = "1dqYgo6PI2ttiQgbF8QhLzOI19VSFSEdthK_xDX5Mk04"
TABS = {"60x60": "0", "60x120": "725867454"}
DATA = Path(__file__).parent / "docs" / "data.json"

SURFACE = {"ГЛ": "Глянец", "MT": "Матовая", "МТ": "Матовая", "САТИН": "Сатин",
           "КАРВИНГ": "Карвинг", "ПАНЧ КАРВИНГ": "Панч-карвинг"}


def norm(s):
    return " ".join(unicodedata.normalize("NFC", s or "").upper().replace("Ё", "Е").split())


def num(v):
    try:
        return float(str(v).replace("\xa0", "").replace(" ", "").replace(",", "."))
    except ValueError:
        return 0.0


def rows():
    for gid in TABS.values():
        url = f"https://docs.google.com/spreadsheets/d/{SHEET}/export?format=csv&gid={gid}"
        text = urllib.request.urlopen(url, timeout=30).read().decode("utf-8")
        head, _, rest = text.partition("\n")
        head = "Артикулы" + head[head.index(","):]   # первую колонку в таблице переименовывают
        yield from csv.DictReader(io.StringIO(head + "\n" + rest))


# Кириллические буквы-двойники в артикулах: «VHF600085С» и «VHF600085C» — одна плитка.
CYR = str.maketrans("АВЕКМНОРСТУХ", "ABEKMHOPCTYX")


def wanted_arts(path):
    """Список артикулов для каталога из arts.txt (по одному в строке, # — комментарий)."""
    lines = path.read_text(encoding="utf-8").splitlines()
    return {a.strip().upper().translate(CYR) for a in lines if a.strip() and not a.startswith("#")}


def catalog():
    want = wanted_arts(Path(__file__).parent / "arts.txt")
    tiles = []
    for row in rows():
        art, name = row["Артикулы"].strip(), norm(row["НАЗВАНИЯ"])
        status = row["Статус арт."].strip().lower()
        if not name or art.upper().translate(CYR) not in want:
            continue
        tiles.append({
            "art": art,
            "name": name.title(),
            "format": norm(row["ФОРМАТ"]).replace("Х", "X").replace("X", "×"),
            "surface": SURFACE.get(norm(row["ПОКРЫТИЕ"]), row["ПОКРЫТИЕ"].strip().title()),
            "packing": row["ПАКИНГ"].strip(),
            "pallet": row["ПАЛЛЕТ М2/КГ"].strip(),
            "is_new": status == "new",
            "stock": {"msk": num(row["СКЛАД Москва"]), "tver": num(row["СКЛАД Тверь"]),
                      "msk_res": num(row["РЕЗЕРВ Москва"]), "tver_res": num(row["РЕЗЕРВ Тверь"])},
        })
    lost = want - {t["art"].upper().translate(CYR) for t in tiles}
    if lost:
        print("Нет в таблице (карточки не будет):", ", ".join(sorted(lost)))
    return tiles


def main():
    old = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {"tiles": []}
    photos = {t["art"]: t.get("photos", []) for t in old["tiles"]}

    tiles = [t | {"photos": photos.get(t["art"], [])} for t in catalog()]
    tiles.sort(key=lambda t: (not t["photos"], t["format"], t["name"]))

    DATA.write_text(json.dumps({"tiles": tiles}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"моделей: {len(tiles)}, с фото: {sum(1 for t in tiles if t['photos'])}")


if __name__ == "__main__":
    main()
