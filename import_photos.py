#!/usr/bin/env python3
"""Раскладывает исходные фото Ozon в docs/img/<АРТИКУЛ>/ и пишет список в data.json.

Порядок кадров: если все файлы пронумерованы — по номеру, иначе по времени создания
файла (в папках лежат UUID-имена, алфавит дал бы случайный порядок).
Артикулы, для которых исходной папки нет, не трогаются — их фото остаются как были.
"""
import csv, io, json, re, unicodedata, urllib.request
from pathlib import Path

from PIL import Image, ImageOps

SRC = Path("/Users/yunus_mac/Documents/Старс керамик (Плитки)/Фото для озон")
ROOT = Path(__file__).parent
DST = ROOT / "docs" / "img"
DATA = ROOT / "docs" / "data.json"
EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
FULL, THUMB = 1600, 700
SHEET = "1dqYgo6PI2ttiQgbF8QhLzOI19VSFSEdthK_xDX5Mk04"
TABS = ("0", "725867454")

# Папки, названные не так, как модель в таблице. Точное совпадение имени всегда важнее
# псевдонима: при двух папках на одну модель («ОРО ВАЙТ» и «ОРРО ВАЙТ») берётся точная.
ALIASES = {
    "АЙССНОВ": "АЙССНОУ",
    "ОРРО ВАЙТ": "ОРО ВАЙТ",
    "МИНЕРАЛ ВАЙТ": "МИРРОР ВАЙТ",
    "ЛИАМ КРЕМ МАТОВЫЙ": "ЛИАМ КРЕМ",
    "ЛИАМ КРЕМ ГАЛЯНЦЕЫЙ": "ЛИАМ КРЕМ ПОЛИШ",
    "ДЖОЗЕФИНА": "ДЖОЗЕФИНА ПОЛИШ",
    "БЕТОН ГРЕЙ МАТ": "БЕТОН ГРЕЙ",
    "ГЕОРГИЯ МТ": "ГЕОРГИЯ",
    "ЕВА ВАЙТ МАТ": "ЕВА ВАЙТ",
    "ЗЕВС ГРЕЙ МТ": "ЗЕВС ГРЕЙ",
    "ОРО ВАЙТ МАТ": "ОРО ВАЙТ",
    "ПАТРИЦИЯ СТОУН КРАВ": "ПАТРИЦИЯ СТОУН",
}

CYR = str.maketrans("АВЕКМНОРСТУХ", "ABEKMHOPCTYX")


def norm(s):
    s = unicodedata.normalize("NFC", s).upper().replace("Ё", "Е").replace("*", "X")
    return " ".join(s.replace("Х", "X").split())


def catalog():
    """(название, формат) -> артикул; только артикулы из arts.txt."""
    want = {a.strip().upper().translate(CYR)
            for a in (ROOT / "arts.txt").read_text(encoding="utf-8").splitlines()
            if a.strip() and not a.startswith("#")}
    out = {}
    for gid in TABS:
        url = f"https://docs.google.com/spreadsheets/d/{SHEET}/export?format=csv&gid={gid}"
        text = urllib.request.urlopen(url, timeout=30).read().decode("utf-8")
        head, _, rest = text.partition("\n")
        head = "Артикулы" + head[head.index(","):]
        for row in csv.DictReader(io.StringIO(head + "\n" + rest)):
            art, name = row["Артикулы"].strip(), row["НАЗВАНИЯ"].strip()
            if art and name and art.upper().translate(CYR) in want:
                out[(norm(name), norm(row["ФОРМАТ"]))] = art
    return out


def ordered(files):
    """Кадры в том порядке, в котором их делали."""
    nums = [re.match(r"0*(\d+)", p.stem) for p in files]
    if all(nums):
        return sorted(files, key=lambda p: int(re.match(r"0*(\d+)", p.stem).group(1)))
    return sorted(files, key=lambda p: getattr(p.stat(), "st_birthtime", p.stat().st_mtime))


def source_dirs():
    """(название, формат) -> папка. Точное имя модели вытесняет псевдоним."""
    exact, aliased, skipped = {}, {}, []
    for fmt_dir in sorted(p for p in SRC.iterdir() if p.is_dir()):
        fmt = norm(fmt_dir.name)
        for d in sorted(p for p in fmt_dir.iterdir() if p.is_dir()):
            name = norm(d.name)
            if name in ALIASES:
                aliased.setdefault((ALIASES[name], fmt), d)
            else:
                exact[(name, fmt)] = d
    for key, d in aliased.items():
        if key in exact:
            skipped.append(f"{d.name} (есть точная папка {exact[key].name})")
        else:
            exact[key] = d
    return exact, skipped


def main():
    cat, (dirs, skipped) = catalog(), source_dirs()
    done, unmatched, photos = [], [], {}
    for key, d in sorted(dirs.items()):
        art = cat.get(key)
        files = ordered([p for p in d.iterdir() if p.suffix.lower() in EXT])
        if not art:
            unmatched.append(f"{d.parent.name}/{d.name} ({len(files)} фото)")
            continue
        target = DST / art
        target.mkdir(parents=True, exist_ok=True)
        for old in target.iterdir():
            old.unlink()                       # ставим ровно тот набор, что в источнике
        names = []
        for i, src in enumerate(files, 1):
            im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
            for suffix, box, q in ((".jpg", FULL, 82), ("_t.jpg", THUMB, 78)):
                out = im.copy()
                out.thumbnail((box, box), Image.LANCZOS)
                out.save(target / f"{i:02d}{suffix}", "JPEG", quality=q,
                         optimize=True, progressive=True)
            names.append(f"{i:02d}")
        photos[art] = names
        done.append(f"{art:12} {key[0]:22} {key[1]:7} {len(files)} фото  <- {d.name}")

    data = json.loads(DATA.read_text(encoding="utf-8"))
    for tile in data["tiles"]:
        if tile["art"] in photos:
            tile["photos"] = photos[tile["art"]]
    data["tiles"].sort(key=lambda t: (not t["photos"], t["format"], t["name"]))
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    print("\n".join(done))
    print(f"\nОбновлено моделей: {len(done)}, "
          f"всего с фото: {sum(1 for t in data['tiles'] if t['photos'])}")
    if skipped:
        print("Папки-дубли, пропущены:", *skipped, sep="\n  ")
    if unmatched:
        print("Нет такой модели в каталоге, пропущены:", *unmatched, sep="\n  ")


if __name__ == "__main__":
    main()
