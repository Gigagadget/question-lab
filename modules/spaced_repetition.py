"""Algoritmo di spaced repetition per selezione ponderata delle domande."""

from datetime import datetime
from typing import Dict, Any


def calculate_question_weight(question: Dict[str, Any]) -> float:
    """
    Calcola il peso di una domanda per la selezione nel quiz.
    Peso più alto = più probabilità di essere scelta.
    """
    stats = question.get('review_stats')
    if not stats:
        return 1.0

    total_attempts = stats.get('total_attempts', 0)
    if total_attempts == 0:
        return 1.0

    mastery = stats.get('mastery_level', 0)

    # Base weight inversamente proporzionale alla padronanza (0->1.0, 5->0.17)
    base_weight = 1.0 - (mastery / 6.0)

    # Penalità per errore recente
    last_score = stats.get('last_score')
    recent_penalty = 1.0
    if last_score is not None:
        if last_score < 0.3:
            recent_penalty = 2.5
        elif last_score < 0.5:
            recent_penalty = 2.0
        elif last_score < 0.7:
            recent_penalty = 1.5
        elif last_score < 1.0:
            recent_penalty = 1.2

    # Bonus per domande non viste da tempo
    last_seen_str = stats.get('last_seen')
    time_bonus = 1.0
    if last_seen_str:
        try:
            last_seen = datetime.fromisoformat(last_seen_str)
            days_since = (datetime.now() - last_seen).days
            if days_since > 30:
                time_bonus = 2.0
            elif days_since > 7:
                time_bonus = 1.5
        except (ValueError, TypeError):
            pass

    return max(0.1, base_weight * recent_penalty * time_bonus)


def update_question_review_stats(question: Dict[str, Any], score: float) -> None:
    """Aggiorna le statistiche di ripasso dopo una risposta."""
    stats = question.get('review_stats')
    if stats is None:
        stats = {}
        question['review_stats'] = stats

    stats['total_attempts'] = stats.get('total_attempts', 0) + 1

    if score >= 1.0:
        stats['correct_attempts'] = stats.get('correct_attempts', 0) + 1
    elif score > 0:
        stats['partial_attempts'] = stats.get('partial_attempts', 0) + 1
    else:
        stats['wrong_attempts'] = stats.get('wrong_attempts', 0) + 1

    stats['last_seen'] = datetime.now().isoformat()
    stats['last_score'] = score

    # Ricalcola livello di padronanza (0-5)
    total = stats['total_attempts']
    correct = stats.get('correct_attempts', 0)
    partial = stats.get('partial_attempts', 0)
    raw_mastery = (correct * 1.0 + partial * 0.3) / max(total, 1) * 5
    stats['mastery_level'] = min(5, max(0, int(raw_mastery)))
