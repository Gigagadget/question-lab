"""
Blueprint per la gestione delle categorie.
Fornisce API per ottenere, aggiungere, rimuovere e rinominare categorie.
"""

from flask import Blueprint, jsonify, request
import logging

from server.utils import load_database, save_database, load_categories, save_categories, get_unique_categories

# Crea il blueprint
categories_bp = Blueprint('categories', __name__)

# Configure logging
logger = logging.getLogger(__name__)


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