#!/usr/bin/env python3
"""Одностороннее зеркало: дилерский портал → витрина QR (almaly-tiles).

Переносит только то, что владелец меняет в редакторе портала:

- фото модели (полные кадры docs/img/<АРТИКУЛ>/01.jpg, 02.jpg, … без миниатюр
  *_t.jpg) в photos/<АРТИКУЛ>/ в том же порядке; первое фото — обложка витрины;
- список карточек arts.txt. Ночная пересборка витрины этот файл не переписывает,
  поэтому удалённая карточка не возвращается из Google-таблицы.

Скрипт сам ничего не коммитит. Коммит и push делает workflow «Зеркало витрины».
Секрет с токеном — TILES_TOKEN, в репозиторий он не кладётся.
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

CYR = str.maketrans("АВЕКМНОРСТУХ", "ABEKMHOPCTYX")
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
ART_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё_-]{1,40}")


class MirrorRefused(Exception):
    """Состав каталога сжался слишком сильно — витрину не трогаем."""


def norm_art(art):
    return art.strip().upper().translate(CYR)


def active_arts(text):
    """Артикулы из arts.txt без комментариев и пустых строк."""
    out = []
    for line in text.splitlines():
        item = line.strip()
        if item and not item.startswith("#"):
            out.append(item)
    return out


def active_keys(text):
    return {norm_art(a) for a in active_arts(text)}


def check_art(art):
    if not ART_RE.fullmatch(art or ""):
        raise MirrorRefused(f"Странное имя артикула, пропуск невозможен: {art!r}")


def match_dir(parent, art):
    """Папка артикула; «C» и «С» считаются одной моделью."""
    if not parent.is_dir():
        return None
    direct = parent / art
    if direct.is_dir():
        return direct
    want = norm_art(art)
    for path in parent.iterdir():
        if path.is_dir() and norm_art(path.name) == want:
            return path
    return None


def full_frames(src):
    """Полные кадры портала по имени файла. Миниатюры *_t.jpg не берём."""
    if not src.is_dir():
        return []
    files = [p for p in src.iterdir()
             if p.is_file() and p.suffix.lower() == ".jpg" and not p.stem.lower().endswith("_t")]
    files.sort(key=lambda p: p.name.lower())
    return [(f"{i:02d}.jpg", p.read_bytes()) for i, p in enumerate(files, 1)]


def plan_photos(src, dst):
    """Что записать и какие чужие кадры убрать, чтобы порядок совпал с порталом."""
    frames = full_frames(src)
    blobs = {name: data for name, data in frames}
    existing = {}
    if dst.is_dir():
        for path in dst.iterdir():
            if path.is_file() and path.suffix.lower() in IMAGE_EXT:
                existing[path.name] = path
    writes, deletes = [], []
    for name, path in sorted(existing.items()):
        if name not in blobs:
            deletes.append(name)
        elif path.read_bytes() != blobs[name]:
            writes.append(name)
    for name in blobs:
        if name not in existing:
            writes.append(name)
    return {"write": writes, "delete": deletes, "blobs": blobs}


def apply_photos(src, dst, dry_run):
    plan = plan_photos(src, dst)
    if dry_run or (not plan["write"] and not plan["delete"]):
        plan.pop("blobs", None)
        return plan
    dst.mkdir(parents=True, exist_ok=True)
    for name in plan["delete"]:
        (dst / name).unlink()
    blobs = plan.pop("blobs")
    for name in plan["write"]:
        (dst / name).write_bytes(blobs[name])
    return plan


def clear_photos(dst, dry_run):
    if not dst.is_dir():
        return []
    names = sorted(p.name for p in dst.iterdir()
                   if p.is_file() and p.suffix.lower() in IMAGE_EXT)
    if dry_run or not names:
        return names
    for name in names:
        (dst / name).unlink()
    if not any(dst.iterdir()):
        dst.rmdir()
    return names


def arts_too_small(old_text, new_text):
    old, new = active_keys(old_text), active_keys(new_text)
    return len(new) < max(1, len(old) // 2)


def git_out(repo, *args):
    proc = subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip()
        raise SystemExit(detail or f"git {' '.join(args)} завершился с кодом {proc.returncode}")
    return proc.stdout


def changed_photo_arts(repo, since):
    """Артикулы, у которых в этом диапазоне коммитов менялись файлы или список фото."""
    rev = git_out(repo, "rev-parse", "--verify", since).strip()
    status = git_out(repo, "diff", "--name-status", rev, "HEAD")
    arts = set()
    data_changed = False
    for line in status.splitlines():
        parts = line.split("\t")
        for path in parts[1:]:
            match = re.match(r"docs/img/([^/]+)/", path)
            if match:
                arts.add(match.group(1))
            if path == "docs/data.json":
                data_changed = True
    if data_changed:
        old_raw = subprocess.run(["git", "show", f"{rev}:docs/data.json"], cwd=repo, capture_output=True)
        old_map = photo_map(old_raw.stdout) if old_raw.returncode == 0 else {}
        new_map = photo_map((repo / "docs" / "data.json").read_bytes())
        if old_map is not None and new_map is not None:
            for art in set(old_map) | set(new_map):
                if old_map.get(art) != new_map.get(art):
                    arts.add(art)
    for art in arts:
        check_art(art)
    return arts


def photo_map(raw):
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return {t.get("art", ""): list(t.get("photos") or []) for t in data.get("tiles", [])}


def mirror(repo, tiles, *, since=None, only=(), arts_only=False, dry_run=False):
    """Возвращает текст отчёта. При опасном arts.txt бросает MirrorRefused до любых записей."""
    repo, tiles = Path(repo), Path(tiles)
    photo_arts = set()
    if only:
        for art in only:
            check_art(art)
            photo_arts.add(art)
    elif since and not arts_only:
        photo_arts |= changed_photo_arts(repo, since)
    elif not arts_only and not since:
        raise SystemExit("Укажите --since, --only или --arts-only.")

    src_arts = (repo / "arts.txt").read_text(encoding="utf-8")
    dst_path = tiles / "arts.txt"
    dst_arts = dst_path.read_text(encoding="utf-8") if dst_path.exists() else ""
    if src_arts != dst_arts and arts_too_small(dst_arts, src_arts):
        raise MirrorRefused(
            f"Отказ: на витрине {len(active_keys(dst_arts))} артикулов, "
            f"с портала пришло {len(active_keys(src_arts))}. "
            "Похоже на повреждённый arts.txt — витрина не изменена.")

    removed = active_keys(dst_arts) - active_keys(src_arts)
    added = active_keys(src_arts) - active_keys(dst_arts)
    # Новая карточка сразу получает фото портала, снятая — не копируется обратно.
    photo_arts |= {a for a in active_arts(src_arts) if norm_art(a) in added}
    photo_arts = {a for a in photo_arts if norm_art(a) not in removed}

    lines = []
    if src_arts != dst_arts:
        gone = ", ".join(sorted(removed)) or "—"
        came = ", ".join(sorted(added)) or "—"
        lines.append(f"Состав каталога: убрано {gone}; добавлено {came}")
        if not dry_run:
            dst_path.write_text(src_arts, encoding="utf-8")
    else:
        lines.append("Состав каталога: без изменений")

    for key in sorted(removed):
        sample = next((a for a in active_arts(dst_arts) if norm_art(a) == key), key)
        dst = match_dir(tiles / "photos", sample) or (tiles / "photos" / sample)
        deleted = clear_photos(dst, dry_run)
        if deleted:
            lines.append(f"Фото {dst.name}: снято с витрины ({len(deleted)} файлов)")

    for art in sorted(photo_arts, key=norm_art):
        src = match_dir(repo / "docs" / "img", art) or (repo / "docs" / "img" / art)
        dst = match_dir(tiles / "photos", src.name if src.is_dir() else art)
        if dst is None:
            dst = tiles / "photos" / (src.name if src.is_dir() else art)
        plan = apply_photos(src, dst, dry_run)
        if plan["write"] or plan["delete"]:
            lines.append(
                f"Фото {dst.name}: записать {len(plan['write'])}, удалить {len(plan['delete'])}")
        else:
            lines.append(f"Фото {art}: уже совпадает")

    if not any(line.startswith("Фото") and "уже совпадает" not in line for line in lines) \
            and src_arts == dst_arts:
        lines.append("Нечего отправлять на витрину.")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Зеркало портала на витрину QR")
    parser.add_argument("--repo", default=".", help="корень almaly-dealers")
    parser.add_argument("--tiles", required=True, help="корень almaly-tiles")
    parser.add_argument("--since", help="коммит, с которого смотреть изменения фото")
    parser.add_argument("--only", action="append", default=[], help="принудительно сверить этот артикул")
    parser.add_argument("--arts-only", action="store_true", help="только список карточек, без чужих фото")
    parser.add_argument("--dry-run", action="store_true", help="показать план и ничего не писать")
    args = parser.parse_args(argv)
    try:
        report = mirror(args.repo, args.tiles, since=args.since, only=args.only,
                        arts_only=args.arts_only, dry_run=args.dry_run)
    except MirrorRefused as exc:
        print(exc, file=sys.stderr)
        return 2
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
