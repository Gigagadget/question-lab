"""
Utility condivise per la gestione del database e delle categorie.
Queste funzioni sono usate sia da app.py che dai Blueprint.
"""

import json
import os
import shutil
import logging
from datetime import datetime
from pathlib import Path

from server.databases import get_active_database_path, get_active_categories_path

# Configure logging
logger = logging.getLogger(__name__)


def get_database_backup_dir():
    """Ottiene la directory di backup specifica per il database corrente"""
    active_db_path = get_active_database_path()
    if active_db_path and active_db_path.exists():
        # Usa la cartella backup/ dentro la cartella del database attivo
        return str(active_db_path.parent / "backup")
    # Nessun database attivo: restituisci None
    return None


def create_backup():
    """Crea un backup del database con timestamp (usa database attivo se disponibile)"""
    active_db_path = get_active_database_path()
    if not active_db_path or not active_db_path.exists():
        logger.warning("Tentativo di backup senza database attivo")
        return None

    db_path = str(active_db_path)

    # Backup nella cartella del database attivo
    db_backup_dir = active_db_path.parent / "backup"

    if not os.path.exists(db_backup_dir):
        os.makedirs(db_backup_dir)

    if os.path.exists(db_path):
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        db_name = Path(db_path).stem
        backup_file = os.path.join(db_backup_dir, f'{db_name}_{timestamp}.json')
        shutil.copy2(db_path, backup_file)
        logger.info(f"Backup creato: {backup_file}")
        return backup_file
    return None


def load_database():
    """Carica il database JSON da file (usa database attivo se disponibile)"""
    active_db_path = get_active_database_path()

    if not active_db_path or not active_db_path.exists():
        return None

    db_path = str(active_db_path)

    if not os.path.exists(db_path):
        return []

    try:
        with open(db_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Errore nel parsing del database: {e}")
        return []
    except Exception as e:
        logger.error(f"Errore nel caricamento del database: {e}")
        return []


def save_database(data, create_backup_file=True):
    """Salva il database JSON su file con backup (usa database attivo se disponibile)"""
    active_db_path = get_active_database_path()

    if not active_db_path or not active_db_path.exists():
        logger.warning("Tentativo di salvataggio senza database attivo")
        return False

    db_path = str(active_db_path)

    try:
        if create_backup_file and os.path.exists(db_path):
            create_backup()

        with open(db_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        logger.info(f"Database salvato con successo con {len(data)} elementi in {db_path}")
        return True
    except Exception as e:
        logger.error(f"Errore nel salvataggio del database: {e}")
        return False


def load_categories():
    """Carica le categorie da file separato (usa database attivo se disponibile)"""
    default_categories = {
        "primary_domains": ["indefinito"],
        "subdomains": ["indefinito"]
    }

    active_categories_path = get_active_categories_path()

    if not active_categories_path or not active_categories_path.exists():
        return None

    categories_path = str(active_categories_path)

    if not os.path.exists(categories_path):
        return default_categories

    try:
        with open(categories_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return default_categories


def save_categories(categories):
    """Salva le categorie su file separato (usa database attivo se disponibile)"""
    active_categories_path = get_active_categories_path()

    if not active_categories_path or not active_categories_path.exists():
        logger.warning("Tentativo di salvataggio categorie senza database attivo")
        return False

    categories_path = str(active_categories_path)

    try:
        with open(categories_path, 'w', encoding='utf-8') as f:
            json.dump(categories, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Errore nel salvataggio delle categorie: {e}")
        return False


def get_unique_categories(questions):
    """Estrae i valori unici di primary_domain e subdomain dalle domande E dal file categorie"""
    saved_categories = load_categories()
    primary_domains = set(saved_categories.get("primary_domains", []))
    subdomains = set(saved_categories.get("subdomains", []))

    for q in questions:
        if q.get('primary_domain') and q['primary_domain'].strip():
            primary_domains.add(q['primary_domain'].strip())
        if q.get('subdomain') and q['subdomain'].strip():
            subdomains.add(q['subdomain'].strip())

    merged_categories = {
        "primary_domains": sorted(list(primary_domains)),
        "subdomains": sorted(list(subdomains))
    }
    save_categories(merged_categories)

    return sorted(list(primary_domains)), sorted(list(subdomains))


def load_user_prefs():
    """Carica le preferenze utente da file JSON"""
    from pathlib import Path
    
    BASE_DIR = Path(__file__).resolve().parent.parent
    USER_PREFS_FILE = str(BASE_DIR / 'preferences.json')
    default_prefs = {"theme": "light"}

    if not os.path.exists(USER_PREFS_FILE):
        save_user_prefs(default_prefs)
        return default_prefs

    try:
        with open(USER_PREFS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Errore nel caricamento delle preferenze: {e}")
        return default_prefs


def save_user_prefs(prefs):
    """Salva le preferenze utente su file JSON"""
    from pathlib import Path
    
    BASE_DIR = Path(__file__).resolve().parent.parent
    USER_PREFS_FILE = str(BASE_DIR / 'preferences.json')

    try:
        with open(USER_PREFS_FILE, 'w', encoding='utf-8') as f:
            json.dump(prefs, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Errore nel salvataggio delle preferenze: {e}")
        return False


def migrate_old_backups():
    """Migra i backup dalla vecchia struttura alla nuova (sottocartelle per database)"""
    from pathlib import Path
    
    BASE_DIR = Path(__file__).resolve().parent.parent
    BACKUP_DIR = str(BASE_DIR / 'backup')
    
    if not os.path.exists(BACKUP_DIR):
        return 0

    db_backup_dir = get_database_backup_dir()
    if db_backup_dir is None:
        # Nessun database attivo: salta la migrazione dei backup
        logger.info("⚠️ Nessun database attivo: migrazione backup saltata")
        return 0

    if not os.path.exists(db_backup_dir):
        os.makedirs(db_backup_dir)

    migrated_count = 0
    for file in os.listdir(BACKUP_DIR):
        if file.endswith('.json'):
            old_path = os.path.join(BACKUP_DIR, file)
            new_path = os.path.join(db_backup_dir, file)
            if not os.path.exists(new_path):
                shutil.move(old_path, new_path)
                migrated_count += 1
                logger.info(f"Backup migrato: {file}")

    return migrated_count
