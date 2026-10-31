#!/usr/bin/env python3
"""Проверки зеркала портал → витрина. Сеть и настоящие репозитории не нужны."""
import json, subprocess, tempfile, unittest
from pathlib import Path

import mirror_catalog as m
import sync_catalog


def write_jpg(folder, name, payload):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(payload)


class MirrorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.repo = self.root / "dealers"
        self.tiles = self.root / "tiles"
        (self.repo / "docs" / "img").mkdir(parents=True)
        (self.tiles / "photos").mkdir(parents=True)
        arts = "# список\nAAA\nBBB\n"
        (self.repo / "arts.txt").write_text(arts, encoding="utf-8")
        (self.tiles / "arts.txt").write_text(arts, encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_order_cover_and_thumbnails(self):
        src = self.repo / "docs" / "img" / "AAA"
        write_jpg(src, "02.jpg", b"second")
        write_jpg(src, "01.jpg", b"cover")
        write_jpg(src, "01_t.jpg", b"thumb-must-not-copy")
        dst = self.tiles / "photos" / "AAA"
        write_jpg(dst, "01.png", b"old-cover")
        write_jpg(dst, "02.png", b"old-second")
        write_jpg(dst, "03.png", b"old-extra")

        report = m.mirror(self.repo, self.tiles, only=["AAA"])
        self.assertIn("записать 2", report)
        self.assertIn("удалить 3", report)
        self.assertEqual((dst / "01.jpg").read_bytes(), b"cover")
        self.assertEqual((dst / "02.jpg").read_bytes(), b"second")
        self.assertFalse((dst / "01.png").exists())
        self.assertFalse((dst / "03.png").exists())
        self.assertFalse(any(p.name.endswith("_t.jpg") for p in dst.iterdir()))

        again = m.mirror(self.repo, self.tiles, only=["AAA"])
        self.assertIn("уже совпадает", again)
        self.assertIn("Нечего отправлять", again)

    def test_empty_gallery_clears_catalog_files(self):
        dst = self.tiles / "photos" / "AAA"
        write_jpg(dst, "01.png", b"gone")
        write_jpg(dst, "02.jpg", b"gone2")
        report = m.mirror(self.repo, self.tiles, only=["AAA"])
        self.assertIn("удалить 2", report)
        self.assertFalse(any(dst.iterdir()))

    def test_dry_run_does_not_write(self):
        src = self.repo / "docs" / "img" / "AAA"
        write_jpg(src, "01.jpg", b"new")
        dst = self.tiles / "photos" / "AAA"
        write_jpg(dst, "01.png", b"old")
        m.mirror(self.repo, self.tiles, only=["AAA"], dry_run=True)
        self.assertEqual((dst / "01.png").read_bytes(), b"old")
        self.assertFalse((dst / "01.jpg").exists())

    def test_delete_card_survives_and_refuses_wipe(self):
        write_jpg(self.tiles / "photos" / "BBB", "01.png", b"keep-until-removed")
        text = (self.repo / "arts.txt").read_text(encoding="utf-8").replace("BBB\n", "")
        (self.repo / "arts.txt").write_text(text, encoding="utf-8")

        report = m.mirror(self.repo, self.tiles, arts_only=True)
        self.assertIn("убрано BBB", report)
        self.assertIn("снято с витрины", report)
        self.assertFalse((self.tiles / "photos" / "BBB").exists())
        self.assertNotIn("BBB", m.active_arts((self.tiles / "arts.txt").read_text(encoding="utf-8")))

        # Ночная пересборка витрины arts.txt не переписывает: карточки нет в списке.
        self.assertNotIn("BBB", m.active_keys((self.tiles / "arts.txt").read_text(encoding="utf-8")))

        (self.repo / "arts.txt").write_text("# список\n", encoding="utf-8")
        with self.assertRaises(m.MirrorRefused):
            m.mirror(self.repo, self.tiles, arts_only=True)
        self.assertIn("AAA", (self.tiles / "arts.txt").read_text(encoding="utf-8"))

    def test_readd_brings_portal_photos(self):
        (self.tiles / "arts.txt").write_text("# список\nAAA\n", encoding="utf-8")
        write_jpg(self.repo / "docs" / "img" / "BBB", "01.jpg", b"portal-cover")
        report = m.mirror(self.repo, self.tiles, arts_only=True)
        self.assertIn("добавлено BBB", report)
        self.assertEqual((self.tiles / "photos" / "BBB" / "01.jpg").read_bytes(), b"portal-cover")

    def test_cyrillic_twin_folder(self):
        write_jpg(self.repo / "docs" / "img" / "VHF600085C", "01.jpg", b"latin-folder")
        write_jpg(self.tiles / "photos" / "VHF600085C", "01.png", b"old")
        report = m.mirror(self.repo, self.tiles, only=["VHF600085С"])  # кириллическая С
        self.assertIn("VHF600085C", report)
        self.assertEqual((self.tiles / "photos" / "VHF600085C" / "01.jpg").read_bytes(), b"latin-folder")
        self.assertFalse((self.tiles / "photos" / "VHF600085C" / "01.png").exists())

    def test_git_since_sees_only_changed_model(self):
        write_jpg(self.repo / "docs" / "img" / "AAA", "01.jpg", b"a1")
        write_jpg(self.repo / "docs" / "img" / "BBB", "01.jpg", b"b1")
        data = {"tiles": [
            {"art": "AAA", "photos": ["01"]},
            {"art": "BBB", "photos": ["01"]},
        ]}
        (self.repo / "docs" / "data.json").write_text(json.dumps(data), encoding="utf-8")
        git = ["git", "-C", str(self.repo)]
        subprocess.check_call(git + ["init", "-q"])
        subprocess.check_call(git + ["add", "."])
        subprocess.check_call(git + ["commit", "-q", "-m", "base"])
        base = subprocess.check_output(git + ["rev-parse", "HEAD"], text=True).strip()

        write_jpg(self.repo / "docs" / "img" / "AAA", "01.jpg", b"a2")
        write_jpg(self.repo / "docs" / "img" / "AAA", "02.jpg", b"a-extra")
        (self.repo / "docs" / "img" / "AAA" / "01_t.jpg").write_bytes(b"thumb")
        data["tiles"][0]["photos"] = ["01", "02"]
        (self.repo / "docs" / "data.json").write_text(json.dumps(data), encoding="utf-8")
        subprocess.check_call(git + ["add", "."])
        subprocess.check_call(git + ["commit", "-q", "-m", "Фото AAA: 2 шт."])

        write_jpg(self.tiles / "photos" / "AAA", "01.png", b"stale")
        write_jpg(self.tiles / "photos" / "BBB", "01.png", b"leave-me")
        report = m.mirror(self.repo, self.tiles, since=base)
        self.assertIn("Фото AAA", report)
        self.assertNotIn("Фото BBB", report)
        self.assertEqual((self.tiles / "photos" / "AAA" / "01.jpg").read_bytes(), b"a2")
        self.assertEqual((self.tiles / "photos" / "AAA" / "02.jpg").read_bytes(), b"a-extra")
        self.assertEqual((self.tiles / "photos" / "BBB" / "01.png").read_bytes(), b"leave-me")

    def test_disk_photos_fill_only_missing_card(self):
        img = self.root / "img"
        write_jpg(img / "NEW1", "01.jpg", b"x")
        write_jpg(img / "NEW1", "01_t.jpg", b"t")
        write_jpg(img / "NEW1", "02.jpg", b"y")
        self.assertEqual(sync_catalog.disk_photos("NEW1", img), ["01", "02"])
        self.assertEqual(sync_catalog.disk_photos("НЕТ", img), [])


class DiskPhotosCyrillic(unittest.TestCase):
    def test_cyrillic_lookup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_jpg(root / "VHF600085C", "02.jpg", b"b")
            write_jpg(root / "VHF600085C", "01.jpg", b"a")
            self.assertEqual(sync_catalog.disk_photos("VHF600085С", root), ["01", "02"])


if __name__ == "__main__":
    unittest.main()
