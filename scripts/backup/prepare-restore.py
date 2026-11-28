#!/usr/bin/env python3
"""復元(docs/backup.md)の準備。取得の記録にある版のmigrationだけを持つ、Supabase CLIの作業ディレクトリを作る。

使い方: python3 scripts/backup/prepare-restore.py <取得の出力のディレクトリ> <出力先(まだ無いディレクトリ)>

migrationは、取得の記録のcommitから取り出す。このスクリプトのあるリポジトリのGitオブジェクトを読むだけで、
checkout、index、参照を変えない。DB、Supabase、R2へは接続しない。
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
MIGRATIONS = "supabase/migrations"
REGULAR_FILE_MODES = {"100644", "100755"}
# db pushに要る設定だけを持つ。認証、Vault、seed、linkの情報は持ち込まない。
CONFIG = """project_id = "aims-restore"

[db]
major_version = 17

[db.migrations]
enabled = true

[db.seed]
enabled = false
"""


class PrepareError(Exception):
    """準備を続けられない理由。"""


def read_manifest(backup_dir: Path) -> tuple[str, list[str]]:
    """取得の記録を確かめ、commitと版の一覧を返す。"""
    path = backup_dir / "manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise PrepareError(f"取得の記録を読めません: {path}: {error}") from error
    if not isinstance(manifest, dict) or manifest.get("format") != 1:
        raise PrepareError(f"取得の記録のformatが1ではありません: {path}")
    commit = manifest.get("commit")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit):
        raise PrepareError(f"取得の記録のcommitが完全なcommit IDではありません: {commit!r}")
    versions = manifest.get("migration_versions")
    if (
        not isinstance(versions, list)
        or not versions
        or not all(isinstance(version, str) and re.fullmatch(r"[0-9]+", version) for version in versions)
        or len(set(versions)) != len(versions)
    ):
        raise PrepareError(f"取得の記録のmigration_versionsが、重複の無い数字の版の一覧ではありません: {versions!r}")
    return commit, sorted(versions)


def git(*args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["git", "-C", str(REPOSITORY), *args], capture_output=True, check=False)


def git_output(*args: str) -> bytes:
    result = git(*args)
    if result.returncode != 0:
        reason = result.stderr.decode(errors="replace").strip()
        raise PrepareError(f"Gitの読み出しに失敗しました: git {' '.join(args)}: {reason}")
    return result.stdout


def list_migrations(commit: str) -> list[tuple[str, str, str]]:
    """commitのmigrationのディレクトリの中身を、(ファイル名, mode, object ID)で返す。"""
    kind = git("cat-file", "-t", commit)
    if kind.returncode != 0 or kind.stdout.strip() != b"commit":
        raise PrepareError(
            f"取得のcommit {commit} がローカルのGitにありません。{REPOSITORY} でgit fetchして取得してから、やり直してください。"
        )
    entries = []
    for record in git_output("ls-tree", "-z", commit, "--", f"{MIGRATIONS}/").split(b"\0"):
        if not record:
            continue
        metadata, path = record.split(b"\t", 1)
        mode, _, object_id = metadata.decode().split()
        entries.append((path.decode(errors="surrogateescape").rsplit("/", 1)[-1], mode, object_id))
    return entries


def select_migrations(commit: str, versions: list[str]) -> list[tuple[str, str]]:
    """版ごとにちょうど1つの通常のファイルを選び、(ファイル名, object ID)で返す。"""
    entries = list_migrations(commit)
    selected = []
    problems = []
    for version in versions:
        matches = [entry for entry in entries if re.fullmatch(rf"{version}_.+\.sql", entry[0])]
        if not matches:
            problems.append(f"版 {version}: migrationのファイルがありません")
        elif len(matches) > 1:
            names = ", ".join(name for name, _, _ in matches)
            problems.append(f"版 {version}: migrationのファイルが複数あります({names})")
        elif matches[0][1] not in REGULAR_FILE_MODES:
            problems.append(f"版 {version}: 通常のファイルではありません({matches[0][0]})")
        else:
            selected.append((matches[0][0], matches[0][2]))
    if problems:
        raise PrepareError("\n".join([f"取得のcommit {commit} から、migrationを選べません。", *problems]))
    return selected


def write_workdir(out: Path, migrations: list[tuple[str, str]]) -> None:
    """新しいディレクトリへ作業ディレクトリを書く。失敗したら、作ったディレクトリを消す。"""
    try:
        out.mkdir()
    except OSError as error:
        raise PrepareError(f"出力先は、まだ無いディレクトリを指定してください: {out}: {error.strerror}") from error
    try:
        directory = out / MIGRATIONS
        directory.mkdir(parents=True)
        (out / "supabase" / "config.toml").write_text(CONFIG, encoding="utf-8")
        for name, object_id in migrations:
            (directory / name).write_bytes(git_output("cat-file", "blob", object_id))
    except BaseException:
        shutil.rmtree(out)
        raise


def main(arguments: list[str]) -> int:
    if len(arguments) != 2:
        print("使い方: prepare-restore.py <取得の出力のディレクトリ> <出力先(まだ無いディレクトリ)>", file=sys.stderr)
        return 2
    backup_dir, out = (Path(argument) for argument in arguments)
    try:
        commit, versions = read_manifest(backup_dir)
        migrations = select_migrations(commit, versions)
        write_workdir(out, migrations)
    except (PrepareError, OSError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f"取得のcommit {commit} から、次の版のmigrationを準備しました: {out}")
    for name, _ in migrations:
        print(f"  {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
