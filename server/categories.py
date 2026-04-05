"""
Blueprint per la gestione delle categorie.
Supporta categorie relazionali (primary_domain -> subdomains).
"""

from flask import Blueprint, jsonify, request
import logging

from server.utils import (
    load_database,
    save_database,
    load_categories,
    save_categories,
    get_unique_categories,
    normalize_categories_structure,
    normalize_question_categories,
    DEFAULT_PRIMARY_DOMAIN,
    DEFAULT_SUBDOMAIN,
)

# Crea il blueprint
categories_bp = Blueprint('categories', __name__)

# Configure logging
logger = logging.getLogger(__name__)


def _get_categories_and_questions():
    """Carica e normalizza categorie + domande dal DB attivo."""
    categories_data = load_categories()
    if categories_data is None:
        return None, None, (jsonify({"error": "Nessun database selezionato"}), 400)

    questions = load_database()
    if questions is None:
        return None, None, (jsonify({"error": "Nessun database selezionato"}), 400)

    categories_data = normalize_categories_structure(categories_data, questions=questions)

    # Normalizza eventuali incoerenze già presenti
    changed = False
    for q in questions:
        if normalize_question_categories(q, categories_data):
            changed = True

    if changed:
        save_database(questions, create_backup_file=False)
    save_categories(categories_data)

    return categories_data, questions, None


def _sort_subdomains(subs):
    subs = sorted(set(subs), key=lambda v: v.lower())
    if DEFAULT_SUBDOMAIN in subs:
        subs.remove(DEFAULT_SUBDOMAIN)
        subs.insert(0, DEFAULT_SUBDOMAIN)
    return subs


def _resolve_primary_for_subdomain(categories_data, subdomain_value, provided_primary):
    """
    Risolve la primary per operazioni su sottodomini.
    - Se provided_primary è valorizzata, usa quella.
    - Altrimenti, prova a inferire se il sottodominio compare in una sola primary.
    """
    if provided_primary:
        return provided_primary, None

    matches = []
    sub_map = categories_data.get("subdomains_by_primary", {})
    for p, subs in sub_map.items():
        if subdomain_value in subs:
            matches.append(p)

    if len(matches) == 1:
        return matches[0], None

    if len(matches) > 1:
        return None, "Sottodominio ambiguo: specifica anche il dominio principale"

    return None, "Sottodominio non trovato"


def _persist_categories_and_questions(categories_data, questions, create_backup_file=False):
    """Salva categorie e domande, poi restituisce la struttura categorie aggiornata."""
    categories_data = normalize_categories_structure(categories_data, questions=questions)

    # Doppio controllo coerenza domande
    for q in questions:
        normalize_question_categories(q, categories_data)

    if not save_categories(categories_data):
        return None, (jsonify({"error": "Salvataggio delle categorie fallito"}), 500)
    if not save_database(questions, create_backup_file=create_backup_file):
        return None, (jsonify({"error": "Salvataggio del database fallito"}), 500)

    merged = get_unique_categories(questions)
    return merged, None


@categories_bp.route('/api/categories', methods=['GET'])
def get_categories():
    """Ottiene la struttura categorie normalizzata."""
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
    """Aggiorna le categorie (aggiungi o rimuovi)."""
    try:
        data = request.get_json() or {}
        action = data.get('action')
        category_type = data.get('type')
        value = (data.get('value') or '').strip()
        provided_primary = (data.get('primary_domain') or '').strip()

        if action not in ('add', 'remove'):
            return jsonify({"error": "Azione non valida"}), 400
        if category_type not in ('primary_domain', 'subdomain'):
            return jsonify({"error": "Tipo categoria non valido"}), 400
        if not value:
            return jsonify({"error": "Il nome della categoria non può essere vuoto"}), 400

        categories_data, questions, error_response = _get_categories_and_questions()
        if error_response:
            return error_response

        updated_questions = 0

        if action == 'add':
            if category_type == 'primary_domain':
                if value in categories_data["primary_domains"]:
                    return jsonify({"error": "Categoria già esistente"}), 400

                categories_data["primary_domains"].append(value)
                categories_data["primary_domains"] = sorted(categories_data["primary_domains"], key=lambda v: v.lower())
                categories_data["subdomains_by_primary"][value] = [DEFAULT_SUBDOMAIN]

            else:
                primary_domain = provided_primary
                if not primary_domain:
                    return jsonify({"error": "Per aggiungere un sottodominio devi specificare il dominio principale"}), 400
                if primary_domain not in categories_data["primary_domains"]:
                    return jsonify({"error": "Dominio principale non trovato"}), 404
                if primary_domain == DEFAULT_PRIMARY_DOMAIN and value != DEFAULT_SUBDOMAIN:
                    return jsonify({"error": "Il dominio 'indefinito' può contenere solo il sottodominio 'indefinito'"}), 400

                subs = categories_data["subdomains_by_primary"].get(primary_domain, [DEFAULT_SUBDOMAIN])
                if value in subs:
                    return jsonify({"error": "Sottodominio già esistente per questo dominio"}), 400
                subs.append(value)
                categories_data["subdomains_by_primary"][primary_domain] = _sort_subdomains(subs)

            merged_categories, persist_error = _persist_categories_and_questions(categories_data, questions)
            if persist_error:
                return persist_error

            return jsonify({
                "message": f"Categoria '{value}' aggiunta con successo",
                "updated_questions": updated_questions,
                "categories": merged_categories
            }), 200

        # action == 'remove'
        if category_type == 'primary_domain':
            if value == DEFAULT_PRIMARY_DOMAIN:
                return jsonify({"error": "Il dominio 'indefinito' è fisso e non può essere rimosso"}), 400
            if value not in categories_data["primary_domains"]:
                return jsonify({"error": "Categoria non trovata"}), 404

            categories_data["primary_domains"] = [p for p in categories_data["primary_domains"] if p != value]
            categories_data["subdomains_by_primary"].pop(value, None)

            for q in questions:
                if q.get('primary_domain') == value:
                    q['primary_domain'] = DEFAULT_PRIMARY_DOMAIN
                    q['subdomain'] = DEFAULT_SUBDOMAIN
                    updated_questions += 1

        else:
            primary_domain, resolve_error = _resolve_primary_for_subdomain(categories_data, value, provided_primary)
            if resolve_error:
                return jsonify({"error": resolve_error}), 400
            if primary_domain not in categories_data["primary_domains"]:
                return jsonify({"error": "Dominio principale non trovato"}), 404

            if value == DEFAULT_SUBDOMAIN:
                return jsonify({"error": "Il sottodominio 'indefinito' è fisso e non può essere rimosso"}), 400

            subs = categories_data["subdomains_by_primary"].get(primary_domain, [DEFAULT_SUBDOMAIN])
            if value not in subs:
                return jsonify({"error": "Sottodominio non trovato per questo dominio"}), 404

            subs = [s for s in subs if s != value]
            if DEFAULT_SUBDOMAIN not in subs:
                subs.insert(0, DEFAULT_SUBDOMAIN)
            categories_data["subdomains_by_primary"][primary_domain] = _sort_subdomains(subs)

            for q in questions:
                if q.get('primary_domain') == primary_domain and q.get('subdomain') == value:
                    q['subdomain'] = DEFAULT_SUBDOMAIN
                    updated_questions += 1

        merged_categories, persist_error = _persist_categories_and_questions(categories_data, questions)
        if persist_error:
            return persist_error

        return jsonify({
            "message": f"Categoria '{value}' rimossa con successo",
            "updated_questions": updated_questions,
            "categories": merged_categories
        }), 200

    except Exception as e:
        logger.error(f"Errore in POST /api/categories: {e}")
        return jsonify({"error": str(e)}), 500


@categories_bp.route('/api/categories/rename', methods=['POST'])
def rename_category():
    """Rinomina una categoria (aggiorna anche tutte le domande)."""
    try:
        data = request.get_json() or {}
        category_type = data.get('type')  # 'primary_domain' o 'subdomain'
        old_value = (data.get('old_value') or '').strip()
        new_value = (data.get('new_value') or '').strip()
        provided_primary = (data.get('primary_domain') or '').strip()

        if category_type not in ('primary_domain', 'subdomain'):
            return jsonify({"error": "Tipo categoria non valido"}), 400
        if not old_value or not new_value:
            return jsonify({"error": "Nome categoria non valido"}), 400
        if old_value == new_value:
            return jsonify({"error": "Il nuovo nome è uguale al vecchio"}), 400

        categories_data, questions, error_response = _get_categories_and_questions()
        if error_response:
            return error_response

        updated_count = 0

        if category_type == 'primary_domain':
            if old_value == DEFAULT_PRIMARY_DOMAIN:
                return jsonify({"error": "Il dominio 'indefinito' è fisso e non può essere rinominato"}), 400
            if old_value not in categories_data["primary_domains"]:
                return jsonify({"error": "Categoria non trovata"}), 404
            if new_value in categories_data["primary_domains"]:
                return jsonify({"error": "Categoria già esistente"}), 400

            categories_data["primary_domains"] = [new_value if p == old_value else p for p in categories_data["primary_domains"]]
            old_subs = categories_data["subdomains_by_primary"].pop(old_value, [DEFAULT_SUBDOMAIN])
            categories_data["subdomains_by_primary"][new_value] = _sort_subdomains(old_subs)

            for q in questions:
                if q.get('primary_domain') == old_value:
                    q['primary_domain'] = new_value
                    updated_count += 1

        else:
            primary_domain, resolve_error = _resolve_primary_for_subdomain(categories_data, old_value, provided_primary)
            if resolve_error:
                return jsonify({"error": resolve_error}), 400
            if primary_domain not in categories_data["primary_domains"]:
                return jsonify({"error": "Dominio principale non trovato"}), 404

            if old_value == DEFAULT_SUBDOMAIN:
                return jsonify({"error": "Il sottodominio 'indefinito' è fisso e non può essere rinominato"}), 400

            subs = categories_data["subdomains_by_primary"].get(primary_domain, [DEFAULT_SUBDOMAIN])
            if old_value not in subs:
                return jsonify({"error": "Sottodominio non trovato per questo dominio"}), 404
            if new_value in subs:
                return jsonify({"error": "Sottodominio già esistente per questo dominio"}), 400

            categories_data["subdomains_by_primary"][primary_domain] = _sort_subdomains(
                [new_value if s == old_value else s for s in subs]
            )

            for q in questions:
                if q.get('primary_domain') == primary_domain and q.get('subdomain') == old_value:
                    q['subdomain'] = new_value
                    updated_count += 1

        merged_categories, persist_error = _persist_categories_and_questions(
            categories_data,
            questions,
            create_backup_file=True
        )
        if persist_error:
            return persist_error

        return jsonify({
            "message": f"Categoria '{old_value}' rinominata in '{new_value}'",
            "updated_questions": updated_count,
            "categories": merged_categories
        }), 200

    except Exception as e:
        logger.error(f"Errore in POST /api/categories/rename: {e}")
        return jsonify({"error": str(e)}), 500
