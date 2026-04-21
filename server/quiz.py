"""
Blueprint per la gestione del quiz.
Fornisce API per avviare quiz, validare risposte, salvare e gestire i log.
"""

from flask import Blueprint, jsonify, request
import logging

from modules.quiz_utils import QuizManager
from server.databases import get_active_database_path

# Crea il blueprint
quiz_bp = Blueprint('quiz', __name__)

# Configure logging
logger = logging.getLogger(__name__)


def get_quiz_manager():
    """Restituisce un QuizManager per il database attivo"""
    active_db_path = get_active_database_path()
    if not active_db_path or not active_db_path.exists():
        return None  # Nessun database selezionato
    db_path = str(active_db_path)
    # Usa la cartella quiz/ dentro la cartella del database attivo
    quiz_log_dir = str(active_db_path.parent / "quiz")
    return QuizManager(db_path, quiz_log_dir=quiz_log_dir)


@quiz_bp.route('/api/quiz/categories', methods=['GET'])
def get_quiz_categories():
    """Ottiene le categorie con il conteggio delle domande per il quiz"""
    try:
        quiz_manager = get_quiz_manager()
        if quiz_manager is None:
            return jsonify({"error": "Nessun database selezionato. Seleziona un database prima di avviare il quiz."}), 400
        categories = quiz_manager.get_categories_with_counts()
        return jsonify(categories), 200
    except Exception as e:
        logger.error(f"Errore in GET /api/quiz/categories: {e}")
        return jsonify({"error": str(e)}), 500


@quiz_bp.route('/api/quiz/start', methods=['POST'])
def start_quiz():
    """Avvia una nuova sessione quiz"""
    try:
        quiz_manager = get_quiz_manager()
        if quiz_manager is None:
            return jsonify({"error": "Nessun database selezionato. Seleziona un database prima di avviare il quiz.", "available_count": 0, "used_count": 0}), 400
        data = request.get_json()
        categories = data.get('categories', ['all'])
        num_questions = data.get('num_questions', 10)
        subdomains_by_primary = data.get('subdomains_by_primary', {})
        smart_review = data.get('smart_review', False)

        # Gestisci il caso "Tutte"
        if num_questions == -1 or num_questions == 'all':
            num_questions = -1

        questions, available_count, used_count = quiz_manager.get_questions_for_quiz(
            categories,
            num_questions,
            subdomains_by_primary=subdomains_by_primary,
            smart_review=smart_review
        )

        if not questions:
            return jsonify({
                "error": "Nessuna domanda disponibile per le categorie selezionate",
                "available_count": 0,
                "used_count": 0
            }), 400

        # Prepara le domande per il frontend (rimuovi risposte corrette)
        quiz_questions = []
        for q in questions:
            quiz_q = {
                'id': q.get('id'),
                'raw_text': q.get('raw_text'),
                'answers': q.get('answers', {}),
                'primary_domain': q.get('primary_domain', 'indefinito'),
                'subdomain': q.get('subdomain', 'indefinito')
            }
            quiz_questions.append(quiz_q)

        return jsonify({
            "questions": quiz_questions,
            "total_questions": len(quiz_questions),
            "available_count": available_count,
            "used_count": used_count,
            "categories_selected": categories,
            "subdomains_by_primary_selected": subdomains_by_primary
        }), 200

    except Exception as e:
        logger.error(f"Errore in POST /api/quiz/start: {e}")
        return jsonify({"error": str(e)}), 500


@quiz_bp.route('/api/quiz/validate', methods=['POST'])
def validate_quiz_answer():
    """Valida la risposta per una singola domanda"""
    try:
        quiz_manager = get_quiz_manager()
        if quiz_manager is None:
            return jsonify({"error": "Nessun database selezionato"}), 400
        data = request.get_json()
        question_id = data.get('question_id')
        user_answers = data.get('user_answers', [])

        if not question_id:
            return jsonify({"error": "question_id è obbligatorio"}), 400

        result = quiz_manager.validate_answer(question_id, user_answers)
        return jsonify(result), 200

    except Exception as e:
        logger.error(f"Errore in POST /api/quiz/validate: {e}")
        return jsonify({"error": str(e)}), 500


@quiz_bp.route('/api/quiz/save', methods=['POST'])
def save_quiz_result():
    """Salva il log del quiz completato"""
    try:
        quiz_manager = get_quiz_manager()
        if quiz_manager is None:
            return jsonify({"error": "Nessun database selezionato"}), 400
        data = request.get_json()

        if not data:
            return jsonify({"error": "Nessun dato fornito"}), 400

        quiz_id = quiz_manager.save_quiz_log(data)

        return jsonify({
            "message": "Log del quiz salvato con successo",
            "quiz_id": quiz_id
        }), 200

    except Exception as e:
        logger.error(f"Errore in POST /api/quiz/save: {e}")
        return jsonify({"error": str(e)}), 500


@quiz_bp.route('/api/quiz/logs', methods=['GET'])
def get_quiz_logs():
    """Ottiene la lista di tutti i log dei quiz"""
    try:
        quiz_manager = get_quiz_manager()
        if quiz_manager is None:
            return jsonify({"error": "Nessun database selezionato", "logs": []}), 400
        logs = quiz_manager.get_quiz_logs()
        return jsonify({"logs": logs}), 200
    except Exception as e:
        logger.error(f"Errore in GET /api/quiz/logs: {e}")
        return jsonify({"error": str(e)}), 500


@quiz_bp.route('/api/quiz/logs/<log_id>', methods=['GET'])
def get_quiz_log_detail(log_id):
    """Ottiene il dettaglio di un log specifico del quiz"""
    try:
        quiz_manager = get_quiz_manager()
        if quiz_manager is None:
            return jsonify({"error": "Nessun database selezionato"}), 400
        log_data = quiz_manager.get_quiz_log_detail(log_id)

        if log_data is None:
            return jsonify({"error": "Log non trovato"}), 404

        return jsonify(log_data), 200

    except Exception as e:
        logger.error(f"Errore in GET /api/quiz/logs/{log_id}: {e}")
        return jsonify({"error": str(e)}), 500


@quiz_bp.route('/api/quiz/logs/<log_id>', methods=['DELETE'])
def delete_quiz_log(log_id):
    """Elimina un log specifico del quiz"""
    try:
        quiz_manager = get_quiz_manager()
        if quiz_manager is None:
            return jsonify({"error": "Nessun database selezionato"}), 400
        success = quiz_manager.delete_quiz_log(log_id)

        if success:
            return jsonify({"message": f"Log {log_id} eliminato con successo"}), 200
        else:
            return jsonify({"error": "Log non trovato"}), 404

    except Exception as e:
        logger.error(f"Errore in DELETE /api/quiz/logs/{log_id}: {e}")
        return jsonify({"error": str(e)}), 500


@quiz_bp.route('/api/quiz/logs', methods=['DELETE'])
def delete_all_quiz_logs():
    """Elimina tutti i log dei quiz"""
    try:
        quiz_manager = get_quiz_manager()
        if quiz_manager is None:
            return jsonify({"error": "Nessun database selezionato", "deleted_count": 0}), 400
        deleted_count = quiz_manager.delete_all_quiz_logs()

        return jsonify({
            "message": f"Eliminati {deleted_count} log dei quiz",
            "deleted_count": deleted_count
        }), 200

    except Exception as e:
        logger.error(f"Errore in DELETE /api/quiz/logs: {e}")
        return jsonify({"error": str(e)}), 500


@quiz_bp.route('/api/quiz/statistics', methods=['GET'])
def get_quiz_statistics():
    """Ottiene le statistiche generali del quiz"""
    try:
        quiz_manager = get_quiz_manager()
        if quiz_manager is None:
            return jsonify({"error": "Nessun database selezionato"}), 400
        stats = quiz_manager.get_quiz_statistics()
        return jsonify(stats), 200
    except Exception as e:
        logger.error(f"Errore in GET /api/quiz/statistics: {e}")
        return jsonify({"error": str(e)}), 500