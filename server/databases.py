"""
Blueprint per la gestione dei database multipli.
Fornisce API per creare, selezionare, rinominare, eliminare e gestire i database.
"""

import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from flask import Blueprint, jsonify, request, send_file
from io import BytesIO

# Crea il blueprint
databases_bp = Blueprint('databases', __name__)

# Percorsi
BASE_DIR = Path(__file__).resolve().parent.parent
DATABASES_DIR = BASE_DIR / "databases"
DATABASES_CONFIG_FILE = DATABASES_DIR / "config.json"


def load_json(filepath: Path) -> dict:
    """Carica un file JSON."""
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(filepath: Path, data) -> None:
    """Salva un file JSON."""
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def sanitize_db_name(name: str) -> str:
    """
    Sanitizza il nome del database per uso come nome cartella.
    - Minuscolo
    - Spazi -> underscore
    - Caratteri speciali -> rimossi o sostituiti
    - Max 50 caratteri
    """
    name = name.strip().lower()
    name = re.sub(r'[^\w\s\-]', '', name)
    name = re.sub(r'[\s]+', '_', name)
    name = re.sub(r'[_\-]+', '_', name)
    name = name.strip('_-')
    return name[:50]


def get_databases_config() -> dict:
    """Carica la configurazione dei database."""
    try:
        return load_json(DATABASES_CONFIG_FILE)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"active_database": None, "databases": []}


def save_databases_config(config: dict) -> None:
    """Salva la configurazione dei database."""
    DATABASES_DIR.mkdir(parents=True, exist_ok=True)
    save_json(DATABASES_CONFIG_FILE, config)


def get_active_database() -> str:
    """Restituisce il nome del database attivo."""
    config = get_databases_config()
    return config.get("active_database")


def get_active_database_path() -> Path:
    """Restituisce il percorso completo del database attivo."""
    active = get_active_database()
    if active:
        return DATABASES_DIR / active / "data.json"
    return None


def get_active_categories_path() -> Path:
    """Restituisce il percorso completo del categories.json del database attivo."""
    active = get_active_database()
    if active:
        return DATABASES_DIR / active / "categories.json"
    return None


def get_database_backup_dir(db_name: str) -> Path:
    """Restituisce la directory di backup per un database."""
    return DATABASES_DIR / db_name / "backup"


def scan_databases() -> list:
    """
    Scansiona la cartella databases/ e restituisce la lista dei database trovati.
    Ogni database è una cartella con un file data.json.
    """
    databases = []
    
    if not DATABASES_DIR.exists():
        return databases
    
    for item in DATABASES_DIR.iterdir():
        if item.is_dir() and item.name != "backup":
            data_file = item / "data.json"
            if data_file.exists():
                try:
                    # Carica il database per contare le domande
                    questions = load_json(data_file)
                    question_count = len(questions) if isinstance(questions, list) else 0
                except:
                    question_count = 0
                
                # Ottieni info sul file
                stat = data_file.stat()
                
                databases.append({
                    "name": item.name,
                    "question_count": question_count,
                    "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
                })
    
    return databases


def update_config_from_scan() -> dict:
    """
    Aggiorna la configurazione basandosi sulla scansione della cartella.
    Mantiene il database attivo se ancora esiste.
    """
    config = get_databases_config()
    scanned = scan_databases()
    
    # Crea un dict dei database scansionati
    scanned_dict = {db["name"]: db for db in scanned}
    
    # Aggiorna la lista mantenendo i metadati esistenti
    updated_databases = []
    for db in config.get("databases", []):
        if db["name"] in scanned_dict:
            # Aggiorna con dati dalla scansione
            scanned_db = scanned_dict[db["name"]]
            db["question_count"] = scanned_db["question_count"]
            db["last_modified"] = scanned_db["last_modified"]
            updated_databases.append(db)
            del scanned_dict[db["name"]]
    
    # Aggiungi nuovi database trovati dalla scansione
    for name, db_info in scanned_dict.items():
        updated_databases.append({
            "name": name,
            "question_count": db_info["question_count"],
            "created": db_info["created"],
            "last_modified": db_info["last_modified"]
        })
    
    config["databases"] = updated_databases
    
    # Verifica che il database attivo esista ancora
    active = config.get("active_database")
    if active and active not in scanned_dict and active not in [db["name"] for db in updated_databases]:
        # Il database attivo non esiste più, seleziona il primo disponibile
        if updated_databases:
            config["active_database"] = updated_databases[0]["name"]
        else:
            config["active_database"] = None
    
    save_databases_config(config)
    return config


# ==================== API ====================

@databases_bp.route('/api/databases', methods=['GET'])
def list_databases():
    """Lista tutti i database disponibili."""
    try:
        # Scansiona e aggiorna la configurazione
        config = update_config_from_scan()
        
        return jsonify({
            "databases": config.get("databases", []),
            "active_database": config.get("active_database")
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@databases_bp.route('/api/databases/active', methods=['GET'])
def get_active():
    """Ottiene il database attivo."""
    try:
        config = get_databases_config()
        active = config.get("active_database")
        
        if not active:
            return jsonify({"active_database": None, "message": "Nessun database attivo"}), 200
        
        # Trova info sul database attivo
        db_info = None
        for db in config.get("databases", []):
            if db["name"] == active:
                db_info = db
                break
        
        return jsonify({
            "active_database": active,
            "database_info": db_info
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@databases_bp.route('/api/databases/active', methods=['POST'])
def set_active():
    """Seleziona il database attivo."""
    try:
        data = request.get_json()
        db_name = data.get("name")
        
        if not db_name:
            return jsonify({"error": "Nome database non fornito"}), 400
        
        # Verifica che il database esista
        db_path = DATABASES_DIR / db_name / "data.json"
        if not db_path.exists():
            return jsonify({"error": f"Database '{db_name}' non trovato"}), 404
        
        # Aggiorna la configurazione
        config = get_databases_config()
        config["active_database"] = db_name
        
        # Aggiorna last_accessed
        for db in config.get("databases", []):
            if db["name"] == db_name:
                db["last_accessed"] = datetime.now().isoformat()
                break
        
        save_databases_config(config)
        
        return jsonify({
            "message": f"Database '{db_name}' selezionato",
            "active_database": db_name
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@databases_bp.route('/api/databases', methods=['POST'])
def create_database():
    """Crea un nuovo database."""
    try:
        data = request.get_json()
        raw_name = data.get("name", "").strip()
        
        if not raw_name:
            return jsonify({"error": "Nome database non fornito"}), 400
        
        # Sanitizza il nome
        db_name = sanitize_db_name(raw_name)
        
        if not db_name:
            return jsonify({"error": "Nome database non valido dopo sanitizzazione"}), 400
        
        # Verifica che non esista già
        db_path = DATABASES_DIR / db_name
        if db_path.exists():
            return jsonify({"error": f"Database '{db_name}' esiste già"}), 400
        
        # Crea la struttura
        db_path.mkdir(parents=True, exist_ok=True)
        (db_path / "backup").mkdir(exist_ok=True)
        
        # Crea data.json vuoto
        save_json(db_path / "data.json", [])
        
        # Crea categories.json di default
        default_categories = {
            "primary_domains": ["indefinito"],
            "subdomains": ["indefinito", "generale", "specifico"]
        }
        save_json(db_path / "categories.json", default_categories)
        
        # Aggiorna la configurazione
        config = get_databases_config()
        now = datetime.now().isoformat()
        config["databases"].append({
            "name": db_name,
            "question_count": 0,
            "created": now,
            "last_modified": now
        })
        
        # Se è il primo database, selezionalo come attivo
        if not config.get("active_database"):
            config["active_database"] = db_name
        
        save_databases_config(config)
        
        return jsonify({
            "message": f"Database '{db_name}' creato con successo",
            "database": {
                "name": db_name,
                "question_count": 0,
                "created": now,
                "last_modified": now
            }
        }), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@databases_bp.route('/api/databases/<db_name>', methods=['DELETE'])
def delete_database(db_name):
    """Elimina un database."""
    try:
        db_path = DATABASES_DIR / db_name
        
        if not db_path.exists():
            return jsonify({"error": f"Database '{db_name}' non trovato"}), 404
        
        # Elimina ricorsivamente la cartella
        shutil.rmtree(db_path)
        
        # Aggiorna la configurazione
        config = get_databases_config()
        config["databases"] = [db for db in config.get("databases", []) if db["name"] != db_name]
        
        # Se era il database attivo, seleziona un altro
        if config.get("active_database") == db_name:
            if config["databases"]:
                config["active_database"] = config["databases"][0]["name"]
            else:
                config["active_database"] = None
        
        save_databases_config(config)
        
        return jsonify({
            "message": f"Database '{db_name}' eliminato",
            "active_database": config.get("active_database")
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@databases_bp.route('/api/databases/<db_name>', methods=['PUT'])
def rename_database(db_name):
    """Rinomina un database."""
    try:
        data = request.get_json()
        new_name_raw = data.get("new_name", "").strip()
        
        if not new_name_raw:
            return jsonify({"error": "Nuovo nome non fornito"}), 400
        
        # Sanitizza il nuovo nome
        new_name = sanitize_db_name(new_name_raw)
        
        if not new_name:
            return jsonify({"error": "Nome non valido dopo sanitizzazione"}), 400
        
        old_path = DATABASES_DIR / db_name
        
        if not old_path.exists():
            return jsonify({"error": f"Database '{db_name}' non trovato"}), 404
        
        new_path = DATABASES_DIR / new_name
        
        if new_path.exists() and new_name != db_name:
            return jsonify({"error": f"Database '{new_name}' esiste già"}), 400
        
        # Rinomina la cartella
        old_path.rename(new_path)
        
        # Aggiorna la configurazione
        config = get_databases_config()
        
        for db in config.get("databases", []):
            if db["name"] == db_name:
                db["name"] = new_name
                break
        
        # Aggiorna il database attivo se necessario
        if config.get("active_database") == db_name:
            config["active_database"] = new_name
        
        save_databases_config(config)
        
        return jsonify({
            "message": f"Database rinominato da '{db_name}' a '{new_name}'",
            "old_name": db_name,
            "new_name": new_name,
            "active_database": config.get("active_database")
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@databases_bp.route('/api/databases/upload', methods=['POST'])
def upload_database():
    """Upload di un file JSON come nuovo database."""
    try:
        if 'file' not in request.files:
            return jsonify({"error": "Nessun file fornito"}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({"error": "Nessun file selezionato"}), 400
        
        if not file.filename.endswith('.json'):
            return jsonify({"error": "Il file deve essere .json"}), 400
        
        # Leggi e valida il JSON
        try:
            content = file.read().decode('utf-8')
            data = json.loads(content)
        except json.JSONDecodeError:
            return jsonify({"error": "File JSON non valido"}), 400
        
        if not isinstance(data, list):
            return jsonify({"error": "Il file deve contenere un array di domande"}), 400
        
        # Determina il nome del database
        custom_name = request.form.get("name", "").strip()
        if custom_name:
            db_name = sanitize_db_name(custom_name)
        else:
            # Usa il nome del file senza estensione
            db_name = sanitize_db_name(Path(file.filename).stem)
        
        if not db_name:
            return jsonify({"error": "Nome database non valido"}), 400
        
        # Verifica che non esista già
        db_path = DATABASES_DIR / db_name
        if db_path.exists():
            return jsonify({"error": f"Database '{db_name}' esiste già"}), 400
        
        # Crea la struttura
        db_path.mkdir(parents=True, exist_ok=True)
        (db_path / "backup").mkdir(exist_ok=True)
        
        # Salva il database
        save_json(db_path / "data.json", data)
        
        # Crea categories.json di default
        default_categories = {
            "primary_domains": ["indefinito"],
            "subdomains": ["indefinito", "generale", "specifico"]
        }
        save_json(db_path / "categories.json", default_categories)
        
        # Aggiorna la configurazione
        config = get_databases_config()
        now = datetime.now().isoformat()
        config["databases"].append({
            "name": db_name,
            "question_count": len(data),
            "created": now,
            "last_modified": now
        })
        
        if not config.get("active_database"):
            config["active_database"] = db_name
        
        save_databases_config(config)
        
        return jsonify({
            "message": f"Database '{db_name}' caricato con successo",
            "database": {
                "name": db_name,
                "question_count": len(data),
                "created": now,
                "last_modified": now
            }
        }), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@databases_bp.route('/api/databases/<db_name>/download', methods=['GET'])
def download_database(db_name):
    """Download di un database come file JSON."""
    try:
        db_path = DATABASES_DIR / db_name / "data.json"
        
        if not db_path.exists():
            return jsonify({"error": f"Database '{db_name}' non trovato"}), 404
        
        return send_file(
            str(db_path),
            as_attachment=True,
            download_name=f"{db_name}.json",
            mimetype='application/json'
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@databases_bp.route('/api/databases/scan', methods=['POST'])
def scan_for_databases():
    """Scansiona la cartella databases/ per nuovi database."""
    try:
        config = update_config_from_scan()
        
        return jsonify({
            "message": "Scansione completata",
            "databases": config.get("databases", []),
            "active_database": config.get("active_database")
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500