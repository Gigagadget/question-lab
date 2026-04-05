"""
Blueprint per la gestione dei backup.
Fornisce API per ottenere, ripristinare e eliminare backup.
"""

from flask import Blueprint, jsonify, request
import json
import os
import logging
from datetime import datetime

from server.utils import (
    get_database_backup_dir,
    load_database,
    save_database,
    create_backup,
    normalize_categories_structure,
    save_categories,
)

# Crea il blueprint
backups_bp = Blueprint('backups', __name__)

# Configure logging
logger = logging.getLogger(__name__)


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

        if not isinstance(data, list):
            return jsonify({"error": "Formato backup non valido"}), 400

        if save_database(data, create_backup_file=False):
            # Rigenera categories.json dal database ripristinato per evitare
            # categorie/sottocategorie obsolete rimaste da stati successivi.
            regenerated_categories = normalize_categories_structure({}, questions=data)
            if not save_categories(regenerated_categories):
                logger.error("Ripristino DB completato ma rigenerazione categories.json fallita")
                return jsonify({
                    "error": "Ripristino completato ma aggiornamento categorie fallito"
                }), 500
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