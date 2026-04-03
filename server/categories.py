"""
Blueprint per la gestione delle categorie.
Fornisce API per ottenere, aggiungere, rimuovere e rinominare categorie.
"""

from flask import Blueprint, jsonify, request
import logging

from server.databases import get_active_database_path, get_active_categories_path

# Crea il blueprint
categories_bp = Blueprint('categories', __name__)

# Configure logging
logger = logging.getLogger(__name__)


def load_database():
    """Carica il database JSON da file (usa database attivo se disponibile)"""
    import json
    import os

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
    import json
    import os
    import shutil
    from datetime import datetime
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


def load_categories():
    """Carica le categorie da file separato (usa database attivo se disponibile)"""
    import json
    import os

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
    import json
    import os

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


@categories_bp.route('/api/categories', methods=['GET'])
def get_categories():
    """Ottiene tutte le categorie"""
    try:
        categories_data = load_categories()
        if categories_data is None:
            return jsonify({"error": "Nessun database selezionato. Seleziona un database dalla Gestione Database."}), 400
        return jsonify(categories_data), 200
    except Exception as e:
        logger.error(f"Errore in GET /api/categories: {e}")
        return jsonify({"error": str(e)}), 500


@categories_bp.route('/api/categories', methods=['POST'])
def update_categories():
    """Aggiorna le categorie (aggiungi o rimuovi)"""
    try:
        data = request.get_json()
        action = data.get('action')
        category_type = data.get('type')
        value = data.get('value')

        if not value or not value.strip():
            return jsonify({"error": "Il nome della categoria non può essere vuoto"}), 400

        value = value.strip()
        categories_data = load_categories()
        if categories_data is None:
            return jsonify({"error": "Nessun database selezionato"}), 400

        if action == 'add':
            if category_type == 'primary_domain':
                if value not in categories_data["primary_domains"]:
                    categories_data["primary_domains"].append(value)
                    categories_data["primary_domains"].sort()
                else:
                    return jsonify({"error": "Categoria già esistente"}), 400
            else:
                if value not in categories_data["subdomains"]:
                    categories_data["subdomains"].append(value)
                    categories_data["subdomains"].sort()
                else:
                    return jsonify({"error": "Categoria già esistente"}), 400

            if save_categories(categories_data):
                questions = load_database()
                categories = get_unique_categories(questions)
                return jsonify({
                    "message": f"Categoria '{value}' aggiunta con successo",
                    "categories": {
                        'primary_domains': categories[0],
                        'subdomains': categories[1]
                    }
                }), 200
            else:
                return jsonify({"error": "Salvataggio delle categorie fallito"}), 500

        elif action == 'remove':
            if category_type == 'primary_domain':
                if value in categories_data["primary_domains"]:
                    categories_data["primary_domains"].remove(value)
                    questions = load_database()
                    for q in questions:
                        if q.get('primary_domain') == value:
                            q['primary_domain'] = 'indefinito'
                    save_database(questions, create_backup_file=False)
                else:
                    return jsonify({"error": "Categoria non trovata"}), 404
            else:
                if value in categories_data["subdomains"]:
                    categories_data["subdomains"].remove(value)
                    questions = load_database()
                    for q in questions:
                        if q.get('subdomain') == value:
                            q['subdomain'] = 'indefinito'
                    save_database(questions, create_backup_file=False)
                else:
                    return jsonify({"error": "Categoria non trovata"}), 404

            if save_categories(categories_data):
                questions = load_database()
                categories = get_unique_categories(questions)
                return jsonify({
                    "message": f"Categoria '{value}' rimossa con successo",
                    "categories": {
                        'primary_domains': categories[0],
                        'subdomains': categories[1]
                    }
                }), 200
            else:
                return jsonify({"error": "Salvataggio delle categorie fallito"}), 500

        return jsonify({"error": "Azione non valida"}), 400

    except Exception as e:
        logger.error(f"Errore in POST /api/categories: {e}")
        return jsonify({"error": str(e)}), 500


@categories_bp.route('/api/categories/rename', methods=['POST'])
def rename_category():
    """Rinomina una categoria (aggiorna anche tutte le domande)"""
    try:
        data = request.get_json()
        category_type = data.get('type')  # 'primary_domain' o 'subdomain'
        old_value = data.get('old_value', '').strip()
        new_value = data.get('new_value', '').strip()

        if not old_value or not new_value:
            return jsonify({"error": "Nome categoria non valido"}), 400

        if old_value == new_value:
            return jsonify({"error": "Il nuovo nome è uguale al vecchio"}), 400

        categories_data = load_categories()
        if categories_data is None:
            return jsonify({"error": "Nessun database selezionato"}), 400

        # Verifica che la categoria esista
        if category_type == 'primary_domain':
            if old_value not in categories_data["primary_domains"]:
                return jsonify({"error": "Categoria non trovata"}), 404
            if new_value in categories_data["primary_domains"]:
                return jsonify({"error": "Categoria già esistente"}), 400
        else:
            if old_value not in categories_data["subdomains"]:
                return jsonify({"error": "Categoria non trovata"}), 404
            if new_value in categories_data["subdomains"]:
                return jsonify({"error": "Categoria già esistente"}), 400

        # Aggiorna la categoria nel file categories.json
        if category_type == 'primary_domain':
            idx = categories_data["primary_domains"].index(old_value)
            categories_data["primary_domains"][idx] = new_value
            categories_data["primary_domains"].sort()
        else:
            idx = categories_data["subdomains"].index(old_value)
            categories_data["subdomains"][idx] = new_value
            categories_data["subdomains"].sort()

        save_categories(categories_data)

        # Aggiorna tutte le domande con la nuova categoria
        questions = load_database()
        if questions is None:
            return jsonify({"error": "Nessun database selezionato"}), 400
        updated_count = 0
        for q in questions:
            if category_type == 'primary_domain' and q.get('primary_domain') == old_value:
                q['primary_domain'] = new_value
                updated_count += 1
            elif category_type == 'subdomain' and q.get('subdomain') == old_value:
                q['subdomain'] = new_value
                updated_count += 1

        save_database(questions, create_backup_file=True)

        return jsonify({
            "message": f"Categoria '{old_value}' rinominata in '{new_value}'",
            "updated_questions": updated_count,
            "categories": {
                'primary_domains': categories_data["primary_domains"],
                'subdomains': categories_data["subdomains"]
            }
        }), 200

    except Exception as e:
        logger.error(f"Errore in POST /api/categories/rename: {e}")
        return jsonify({"error": str(e)}), 500