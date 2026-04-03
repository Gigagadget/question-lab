"""
Blueprint per la gestione dei backup.
Fornisce API per ottenere, ripristinare e eliminare backup.
"""

from flask import Blueprint, jsonify, request
import json
import os
import logging
from datetime import datetime

from server.databases import get_active_database_path

# Crea il blueprint
backups_bp = Blueprint('backups', __name__)

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
    import shutil
    from pathlib import Path

    active_db_path = get_active_database_path()

    if not active_db_path or not active_db_path.exists():
        logger.warning("Tentativo di salvataggio senza database attivo")
        return False

    db_path = str(active_db_path)

    try:
        if create_backup_file and os.path.exists(db_path):
            # Crea backup
            db_backup_dir = active_db_path.parent / "backup"
            if not os.path.exists(db_backup_dir):
                os.makedirs(db_backup_dir)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            db_name = Path(db_path).stem
            backup_file = os.path.join(db_backup_dir, f'{db_name}_{timestamp}.json')
            shutil.copy2(db_path, backup_file)
            logger.info(f"Backup creato: {backup_file}")

        with open(db_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        logger.info(f"Database salvato con successo con {len(data)} elementi in {db_path}")
        return True
    except Exception as e:
        logger.error(f"Errore nel salvataggio del database: {e}")
        return False


def create_backup():
    """Crea un backup del database con timestamp (usa database attivo se disponibile)"""
    import shutil
    from pathlib import Path

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


@backups_bp.route('/api/backups', methods=['GET'])
def get_backups():
    """Ottiene la lista dei backup disponibili per il database corrente"""
    try:
        db_backup_dir = get_database_backup_dir()
        if db_backup_dir is None:
            return jsonify({"error": "Nessun database selezionato", "backups": []}), 400
        if not os.path.exists(db_backup_dir):
            return jsonify({"backups": []}), 200

        backups = []
        for file in os.listdir(db_backup_dir):
            if file.endswith('.json'):
                file_path = os.path.join(db_backup_dir, file)
                stat = os.stat(file_path)
                backups.append({
                    'name': file,
                    'size': stat.st_size,
                    'modified': datetime.fromtimestamp(stat.st_mtime).isoformat()
                })

        backups.sort(key=lambda x: x['modified'], reverse=True)
        return jsonify({"backups": backups}), 200
    except Exception as e:
        logger.error(f"Errore in GET /api/backups: {e}")
        return jsonify({"error": str(e)}), 500


@backups_bp.route('/api/backups/<backup_name>', methods=['POST'])
def restore_backup(backup_name):
    """Ripristina un backup"""
    try:
        db_backup_dir = get_database_backup_dir()
        if db_backup_dir is None:
            return jsonify({"error": "Nessun database selezionato"}), 400
        backup_path = os.path.join(db_backup_dir, backup_name)
        if not os.path.exists(backup_path):
            return jsonify({"error": "Backup non trovato"}), 404

        create_backup()

        with open(backup_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if save_database(data, create_backup_file=False):
            return jsonify({"message": f"Ripristinato da {backup_name}"}), 200
        else:
            return jsonify({"error": "Ripristino del backup fallito"}), 500
    except Exception as e:
        logger.error(f"Errore in POST /api/backups/{backup_name}: {e}")
        return jsonify({"error": str(e)}), 500


@backups_bp.route('/api/backups', methods=['DELETE'])
def delete_backups():
    """Elimina uno o più backup"""
    try:
        data = request.get_json()
        backup_names = data.get('backups', [])

        if not backup_names:
            return jsonify({"error": "Nessun backup specificato"}), 400

        db_backup_dir = get_database_backup_dir()
        if db_backup_dir is None:
            return jsonify({"error": "Nessun database selezionato"}), 400
        deleted_count = 0

        for backup_name in backup_names:
            backup_path = os.path.join(db_backup_dir, backup_name)
            if os.path.exists(backup_path):
                os.remove(backup_path)
                deleted_count += 1
                logger.info(f"Backup eliminato: {backup_name}")

        return jsonify({
            "message": f"Eliminati {deleted_count} backup",
            "deleted_count": deleted_count
        }), 200
    except Exception as e:
        logger.error(f"Errore in DELETE /api/backups: {e}")
        return jsonify({"error": str(e)}), 500