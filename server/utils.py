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

DEFAULT_PRIMARY_DOMAIN = "indefinito"
DEFAULT_SUBDOMAIN = "indefinito"


def _normalize_category_value(value, fallback=""):
    """Normalizza un valore categoria/sottocategoria."""
    if value is None:
        return fallback
    value = str(value).strip()
    return value if value else fallback


def _sort_with_default_first(values):
    """Ordina alfabeticamente mantenendo 'indefinito' in testa."""
    unique = sorted(set(values), key=lambda v: v.lower())
    if DEFAULT_SUBDOMAIN in unique:
        unique.remove(DEFAULT_SUBDOMAIN)
        unique.insert(0, DEFAULT_SUBDOMAIN)
    return unique


def default_categories_v2():
    """Struttura categorie di default (schema relazionale v2)."""
    return {
        "schema_version": 2,
        "primary_domains": [DEFAULT_PRIMARY_DOMAIN],
        "subdomains_by_primary": {
            DEFAULT_PRIMARY_DOMAIN: [DEFAULT_SUBDOMAIN]
        },
        # Campo derivato per compatibilità frontend legacy
        "subdomains": [DEFAULT_SUBDOMAIN]
    }


def _flatten_subdomains(subdomains_by_primary):
    all_subs = set()
    for subs in subdomains_by_primary.values():
        for s in subs:
            all_subs.add(s)
    if not all_subs:
        all_subs.add(DEFAULT_SUBDOMAIN)
    return _sort_with_default_first(all_subs)


def normalize_categories_structure(categories_data, questions=None):
    """
    Normalizza la struttura categorie in schema v2.
    - Garantisce primary_domains
    - Garantisce subdomains_by_primary
    - Mantiene la regola fissa: indefinito -> [indefinito]
    - Se fornite domande, popola/integra le relazioni a partire dal database
    """
    categories_data = categories_data if isinstance(categories_data, dict) else {}
    normalized = default_categories_v2()

    # Primary domains
    raw_primary = categories_data.get("primary_domains", [])
    primary_domains = set()
    if isinstance(raw_primary, list):
        for p in raw_primary:
            p_norm = _normalize_category_value(p)
            if p_norm:
                primary_domains.add(p_norm)
    if not primary_domains:
        primary_domains.add(DEFAULT_PRIMARY_DOMAIN)
    primary_domains.add(DEFAULT_PRIMARY_DOMAIN)

    # Subdomains map (v2)
    subdomains_by_primary = {}
    raw_map = categories_data.get("subdomains_by_primary", {})
    has_relational_map = isinstance(raw_map, dict) and len(raw_map) > 0
    if isinstance(raw_map, dict):
        for raw_primary_key, raw_subs in raw_map.items():
            p_norm = _normalize_category_value(raw_primary_key)
            if not p_norm:
                continue
            primary_domains.add(p_norm)
            valid_subs = set()
            if isinstance(raw_subs, list):
                for s in raw_subs:
                    s_norm = _normalize_category_value(s)
                    if s_norm:
                        valid_subs.add(s_norm)
            if not valid_subs:
                valid_subs.add(DEFAULT_SUBDOMAIN)
            subdomains_by_primary[p_norm] = valid_subs

    # Compatibilità legacy: subdomains globale
    raw_legacy_subs = categories_data.get("subdomains", [])
    legacy_subs = set()
    if isinstance(raw_legacy_subs, list):
        for s in raw_legacy_subs:
            s_norm = _normalize_category_value(s)
            if s_norm:
                legacy_subs.add(s_norm)
    if not legacy_subs:
        legacy_subs.add(DEFAULT_SUBDOMAIN)

    # Assicura che ogni primary abbia almeno una struttura base
    for p in list(primary_domains):
        if p == DEFAULT_PRIMARY_DOMAIN:
            # Regola fissa
            subdomains_by_primary[p] = {DEFAULT_SUBDOMAIN}
            continue

        if p not in subdomains_by_primary:
            # Se il file è già relazionale, manteniamo fallback legacy.
            # Se è legacy (liste piatte), evitiamo il cross-product primary<->subdomain:
            # la relazione verrà costruita principalmente dalle domande.
            subdomains_by_primary[p] = set(legacy_subs) if has_relational_map else set()
        if not subdomains_by_primary[p]:
            # Fallback minimo: sarà eventualmente raffinato dopo integrazione domande
            subdomains_by_primary[p].add(DEFAULT_SUBDOMAIN)

    # Integra dalle domande presenti nel database
    if isinstance(questions, list):
        for q in questions:
            if not isinstance(q, dict):
                continue
            p = _normalize_category_value(q.get("primary_domain"), DEFAULT_PRIMARY_DOMAIN)
            s = _normalize_category_value(q.get("subdomain"), DEFAULT_SUBDOMAIN)
            if not p:
                p = DEFAULT_PRIMARY_DOMAIN
            if p == DEFAULT_PRIMARY_DOMAIN:
                s = DEFAULT_SUBDOMAIN

            primary_domains.add(p)
            if p not in subdomains_by_primary:
                subdomains_by_primary[p] = {DEFAULT_SUBDOMAIN}
            if p == DEFAULT_PRIMARY_DOMAIN:
                subdomains_by_primary[p] = {DEFAULT_SUBDOMAIN}
            else:
                subdomains_by_primary[p].add(s if s else DEFAULT_SUBDOMAIN)

    # Finalizzazione strutture
    ordered_primary = _sort_with_default_first(primary_domains)
    final_map = {}
    for p in ordered_primary:
        if p == DEFAULT_PRIMARY_DOMAIN:
            final_map[p] = [DEFAULT_SUBDOMAIN]
        else:
            subs = subdomains_by_primary.get(p, {DEFAULT_SUBDOMAIN})
            if not subs:
                subs = {DEFAULT_SUBDOMAIN}
            final_map[p] = _sort_with_default_first(subs)

    normalized["schema_version"] = 2
    normalized["primary_domains"] = ordered_primary
    normalized["subdomains_by_primary"] = final_map
    normalized["subdomains"] = _flatten_subdomains(final_map)
    return normalized


def get_subdomains_for_primary(categories_data, primary_domain):
    """Restituisce i sottodomini validi per un dominio principale."""
    categories_data = normalize_categories_structure(categories_data)
    primary_domain = _normalize_category_value(primary_domain, DEFAULT_PRIMARY_DOMAIN)
    if primary_domain not in categories_data["subdomains_by_primary"]:
        primary_domain = DEFAULT_PRIMARY_DOMAIN
    return categories_data["subdomains_by_primary"].get(primary_domain, [DEFAULT_SUBDOMAIN])


def is_valid_subdomain_for_primary(categories_data, primary_domain, subdomain):
    """Verifica se un sottodominio è valido per il dominio principale indicato."""
    allowed = get_subdomains_for_primary(categories_data, primary_domain)
    return _normalize_category_value(subdomain, DEFAULT_SUBDOMAIN) in allowed


def normalize_question_categories(question, categories_data):
    """
    Normalizza primary_domain/subdomain di una domanda rispetto alle categorie.
    Restituisce True se ha effettuato modifiche.
    """
    if not isinstance(question, dict):
        return False

    categories_data = normalize_categories_structure(categories_data)
    changed = False

    primary = _normalize_category_value(question.get("primary_domain"), DEFAULT_PRIMARY_DOMAIN)
    if primary not in categories_data["primary_domains"]:
        primary = DEFAULT_PRIMARY_DOMAIN
        changed = True

    allowed_subs = categories_data["subdomains_by_primary"].get(primary, [DEFAULT_SUBDOMAIN])
    subdomain = _normalize_category_value(question.get("subdomain"), DEFAULT_SUBDOMAIN)
    if subdomain not in allowed_subs:
        subdomain = DEFAULT_SUBDOMAIN if DEFAULT_SUBDOMAIN in allowed_subs else allowed_subs[0]
        changed = True

    # Regola fissa
    if primary == DEFAULT_PRIMARY_DOMAIN and subdomain != DEFAULT_SUBDOMAIN:
        subdomain = DEFAULT_SUBDOMAIN
        changed = True

    if question.get("primary_domain") != primary:
        question["primary_domain"] = primary
        changed = True

    if question.get("subdomain") != subdomain:
        question["subdomain"] = subdomain
        changed = True

    return changed


def categories_changed(old_categories, new_categories):
    """Confronto robusto tra due strutture categorie normalizzate."""
    old_norm = normalize_categories_structure(old_categories)
    new_norm = normalize_categories_structure(new_categories)
    return old_norm != new_norm


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
    active_categories_path = get_active_categories_path()
    active_db_path = get_active_database_path()

    if not active_categories_path or not active_db_path or not active_db_path.exists():
        return None

    categories_path = str(active_categories_path)
    db_questions = load_database() or []

    if not os.path.exists(categories_path):
        normalized = normalize_categories_structure({}, questions=db_questions)
        save_categories(normalized)
        return normalized

    try:
        with open(categories_path, 'r', encoding='utf-8') as f:
            raw = json.load(f)
    except Exception:
        raw = {}

    normalized = normalize_categories_structure(raw, questions=db_questions)
    if categories_changed(raw, normalized):
        save_categories(normalized)
    return normalized


def save_categories(categories):
    """Salva le categorie su file separato (usa database attivo se disponibile)"""
    active_categories_path = get_active_categories_path()
    active_db_path = get_active_database_path()

    if not active_categories_path or not active_db_path or not active_db_path.exists():
        logger.warning("Tentativo di salvataggio categorie senza database attivo")
        return False

    categories_path = str(active_categories_path)
    normalized = normalize_categories_structure(categories)

    try:
        with open(categories_path, 'w', encoding='utf-8') as f:
            json.dump(normalized, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Errore nel salvataggio delle categorie: {e}")
        return False


def get_unique_categories(questions):
    """
    Sincronizza le categorie con le domande e restituisce la struttura normalizzata.
    """
    saved_categories = load_categories()
    if saved_categories is None:
        # Nessun DB attivo
        return None

    merged_categories = normalize_categories_structure(saved_categories, questions=questions or [])
    save_categories(merged_categories)
    return merged_categories


def load_user_prefs():
    """Carica le preferenze utente da file JSON"""
    from pathlib import Path

    BASE_DIR = Path(__file__).resolve().parent.parent
    USER_PREFS_FILE = str(BASE_DIR / 'preferences.json')
    default_prefs = {"theme": "light", "lan_access": False}

    if not os.path.exists(USER_PREFS_FILE):
        save_user_prefs(default_prefs)
        return default_prefs

    try:
        with open(USER_PREFS_FILE, 'r', encoding='utf-8') as f:
            prefs = json.load(f)
        # Ensure lan_access default exists
        if "lan_access" not in prefs:
            prefs["lan_access"] = False
        return prefs
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


def load_config():
    """Carica config.json e aggiunge automaticamente campi mancanti"""
    from pathlib import Path
    BASE_DIR = Path(__file__).resolve().parent.parent
    CONFIG_FILE = str(BASE_DIR / 'config.json')
    
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except Exception as e:
        logger.error(f"Errore nel caricamento di config.json: {e}")
        return {}
    
# Aggiungi campi LAN password se non esistono
    if "lan_password_hash" not in config:
        config["lan_password_hash"] = None
    if "lan_password_enabled" not in config:
        config["lan_password_enabled"] = False
    if "lan_auth_realm" not in config:
        import random
        config["lan_auth_realm"] = f"QuestionLab {random.randint(1000,9999)}"
    if "log_failed_auth" not in config:
        config["log_failed_auth"] = False

    # Aggiungi search settings defaults se non esistono
    if "search" not in config:
        config["search"] = {
            "mode": "normal",
            "highlightEnabled": True,
            "searchAnswers": True,
            "searchNotes": True,
            "searchCategories": True
        }
        save_config(config)

    return config


def save_config(config):
    """Salva config.json mantenendo tutti i campi esistenti"""
    from pathlib import Path
    BASE_DIR = Path(__file__).resolve().parent.parent
    CONFIG_FILE = str(BASE_DIR / 'config.json')

    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Errore nel salvataggio di config.json: {e}")
        return False


def set_lan_password(password: str) -> bool:
    """Imposta password LAN (solo se chiamata da localhost)"""
    import bcrypt
    import random
    config = load_config()
    salt = bcrypt.gensalt()
    config["lan_password_hash"] = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')
    config["lan_password_enabled"] = True
    # ✅ Rigenera realm random ogni volta che cambia la password
    # Questo forza il browser a dimenticare le vecchie credenziali in cache
    config["lan_auth_realm"] = f"QuestionLab {random.randint(1000,9999)}"
    return save_config(config)


def verify_lan_password(password: str) -> bool:
    """Verifica password LAN contro hash salvato"""
    import bcrypt
    config = load_config()
    if not config.get("lan_password_hash"):
        return False
    try:
        return bcrypt.checkpw(password.encode('utf-8'), config["lan_password_hash"].encode('utf-8'))
    except Exception:
        return False


def is_lan_password_set() -> bool:
    """Verifica se password LAN è stata impostata"""
    config = load_config()
    return config.get("lan_password_hash") is not None and config["lan_password_hash"] != ""


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
