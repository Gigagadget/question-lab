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
    """
    Migra eventuali backup dalla vecchia cartella backup/ a update_backups/,
    poi rimuove la vecchia cartella backup/ dalla root.
    """
    old_backup = base_dir / "backup"
    if not old_backup.exists() or not old_backup.is_dir():
        return False

    new_backup = base_dir / "update_backups"

    # Migra file dalla vecchia cartella backup/ alla nuova update_backups/
    try:
        if new_backup.exists():
            # Migra file individuali
            for f in old_backup.iterdir():
                if f.is_file():
                    dest = new_backup / f.name
                    if not dest.exists():
                        import shutil
                        shutil.copy2(str(f), str(dest))
            # Migra sottocartelle (es. database/)
            for sub in old_backup.iterdir():
                if sub.is_dir():
                    dest_dir = new_backup / sub.name
                    if not dest_dir.exists():
                        import shutil
                        shutil.copytree(str(sub), str(dest_dir))
        else:
            # Se update_backups non esiste, rinomina direttamente
            old_backup.rename(new_backup)
            return True  # La vecchia cartella non esiste più, è stata rinominata
    except Exception as e:
        print(f"  ⚠️  Migrazione backup fallita: {e}")

    # Ora che i contenuti sono migrati, rimuovi la vecchia cartella
    try:
        import shutil
        shutil.rmtree(str(old_backup))
        return True
    except Exception as e:
        print(f"  ⚠️  Impossibile rimuovere backup/: {e}")
        return False


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

    # 2. Migrazione backup legacy -> update_backups
    if remove_old_backup_folder(base_dir):
        print("  🗑️  Rimossa/migrata vecchia cartella backup/ dalla root")
        any_migration_done = True

    # 3. Aggiornamento config.json
    if update_config_json(base_dir):
        print("  ✅ Aggiornato config.json")
        any_migration_done = True

    # NOTA: database.json e categories.json NON vengono rimossi qui.
    # Vengono rimossi da migrate_old_database_to_databases_folder() in app.py
    # SOLO quando la migrazione avviene con successo.

    if any_migration_done:
        print("  🔄 Migrazione da versione legacy completata")
    else:
        pass  # Nessuna migrazione necessaria, silenzio
