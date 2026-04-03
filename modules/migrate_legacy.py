"""
Script di migrazione automatico per aggiornamento da versione legacy.
Gestisce:
1. Migrazione log quiz da Quiz_Log/ a databases/<db>/quiz/
2. Rimozione cartella legacy backup/ dalla root
3. Rimozione database.json e categories.json dalla root
4. Aggiornamento config.json (rimozione Quiz_Log da protected_dirs)

Viene eseguito automaticamente all'avvio del server.
"""

import json
import shutil
import os
from pathlib import Path
from datetime import datetime


def get_project_root():
    """Ottiene la directory root del progetto (padre di modules/)."""
    return Path(__file__).resolve().parent.parent


def get_first_database_path(base_dir):
    """Ottiene il percorso quiz/ del primo database disponibile (preferibilmente attivo)."""
    databases_dir = base_dir / "databases"
    config_path = databases_dir / "config.json"
    active_db_name = None

    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            active_db_name = config.get("active_database")
        except (json.JSONDecodeError, FileNotFoundError):
            pass

    # Se c'è un database attivo, usa quello
    if active_db_name:
        db_dir = databases_dir / active_db_name
        quiz_dir = db_dir / "quiz"
        db_dir.mkdir(parents=True, exist_ok=True)
        quiz_dir.mkdir(parents=True, exist_ok=True)
        return quiz_dir

    # Altrimenti usa il primo database trovato
    if databases_dir.exists():
        for item in databases_dir.iterdir():
            if item.is_dir() and item.name not in ("config.json",):
                quiz_dir = item / "quiz"
                quiz_dir.mkdir(parents=True, exist_ok=True)
                return quiz_dir

    return None


def migrate_quiz_logs(base_dir):
    """Migra i log dei quiz dalla vecchia cartella alla nuova struttura."""
    old_dir = base_dir / "Quiz_Log"
    if not old_dir.exists():
        return 0

    quiz_files = list(old_dir.glob("*.json"))
    if not quiz_files:
        try:
            old_dir.rmdir()
        except OSError:
            pass
        return 0

    target_dir = get_first_database_path(base_dir)
    if target_dir is None:
        print("  ⚠️  Nessun database trovato: quiz log NON migrati.")
        return 0

    migrated = 0
    for quiz_file in quiz_files:
        try:
            dest = target_dir / quiz_file.name
            if dest.exists():
                stem = quiz_file.stem
                dest = target_dir / f"{stem}_migrated.json"
            shutil.copy2(str(quiz_file), str(dest))
            migrated += 1
        except Exception as e:
            print(f"  ❌ Errore migrando {quiz_file.name}: {e}")

    # Rimuovi la vecchia cartella Quiz_Log
    try:
        shutil.rmtree(str(old_dir))
    except Exception as e:
        print(f"  ⚠️  Impossibile rimuovere Quiz_Log: {e}")

    return migrated


def remove_old_backup_folder(base_dir):
    """Rimuove la vecchia cartella backup/ dalla root (non più utilizzata)."""
    old_backup = base_dir / "backup"
    if old_backup.exists() and old_backup.is_dir():
        try:
            shutil.rmtree(str(old_backup))
            return True
        except Exception as e:
            print(f"  ⚠️  Impossibile rimuovere backup/: {e}")
    return False


def remove_old_update_backups_folder(base_dir):
    """Rimuove la vecchia cartella backup/update_backups/ se esiste ancora dentro backup/."""
    # La vecchia struttura era backup/update_backups/, ora è update_backups/ nella root
    # Se esiste ancora la vecchia cartella backup/ (con update_backups dentro), verrà rimossa da remove_old_backup_folder
    # Se esiste la nuova update_backups/ va tenuta perché è quella attuale
    pass


def remove_root_database_files(base_dir):
    """Rimuove database.json e categories.json dalla root (non più utilizzati)."""
    removed = []
    for filename in ("database.json", "categories.json"):
        filepath = base_dir / filename
        if filepath.exists() and filepath.is_file():
            try:
                filepath.unlink()
                removed.append(filename)
            except Exception as e:
                print(f"  ⚠️  Impossibile rimuovere {filename}: {e}")
    return removed


def update_config_json(base_dir):
    """Aggiorna config.json rimuovendo Quiz_Log e backup da protected_dirs."""
    config_file = base_dir / "config.json"
    if not config_file.exists():
        return False

    try:
        with open(config_file, "r", encoding="utf-8") as f:
            config = json.load(f)

        protected_dirs = config.get("protected_dirs", [])
        changed = False

        for item in ("Quiz_Log", "backup"):
            if item in protected_dirs:
                protected_dirs.remove(item)
                changed = True

        # Rimuovi anche database.json e categories.json da protected_files
        protected_files = config.get("protected_files", [])
        for item in ("database.json", "categories.json"):
            if item in protected_files:
                protected_files.remove(item)
                changed = True

        if changed:
            config["protected_dirs"] = protected_dirs
            config["protected_files"] = protected_files
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            return True

        return False

    except Exception as e:
        print(f"  ❌ Errore aggiornando config.json: {e}")
        return False


def run_migration():
    """
    Esegue tutte le migrazioni necessarie.
    Chiamata all'avvio del server.
    """
    base_dir = get_project_root()
    any_migration_done = False

    # 1. Migrazione quiz log
    count = migrate_quiz_logs(base_dir)
    if count > 0:
        print(f"  ✅ Migrati {count} quiz log nella cartella del database")
        any_migration_done = True

    # 2. Rimozione vecchia cartella backup/
    if remove_old_backup_folder(base_dir):
        print("  🗑️  Rimossa vecchia cartella backup/ dalla root")
        any_migration_done = True

    # 3. Rimozione database.json e categories.json dalla root
    removed_files = remove_root_database_files(base_dir)
    if removed_files:
        for f in removed_files:
            print(f"  🗑️  Rimosso {f} dalla root")
        any_migration_done = True

    # 4. Aggiornamento config.json
    if update_config_json(base_dir):
        print("  ✅ Aggiornato config.json")
        any_migration_done = True

    if any_migration_done:
        print("  🔄 Migrazione da versione legacy completata")
    else:
        pass  # Nessuna migrazione necessaria, silenzio
