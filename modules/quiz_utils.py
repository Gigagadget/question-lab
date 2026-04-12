import json
import random
import os
from datetime import datetime
from typing import List, Dict, Tuple, Optional
from pathlib import Path

class QuizManager:
    """Gestore della logica del quiz"""

    def __init__(self, database_file: str = 'database.json', quiz_log_dir: str = None):
        self.database_file = database_file
        if quiz_log_dir:
            self.quiz_log_dir = Path(quiz_log_dir)
        else:
            raise ValueError("quiz_log_dir è obbligatorio. Specifica il percorso della cartella quiz/ del database.")
        self.quiz_log_dir.mkdir(parents=True, exist_ok=True)
    
    def load_database(self) -> List[Dict]:
        """Carica il database delle domande"""
        try:
            with open(self.database_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            return []
        except json.JSONDecodeError:
            return []
    
    def get_categories_with_counts(self) -> Dict:
        """
        Ottiene le categorie con il conteggio delle domande disponibili
        (domande con almeno una risposta correta)
        """
        questions = self.load_database()
        
        categories = {}
        for q in questions:
            # Verifica che la domanda abbia almeno una risposta correta
            correct = q.get('correct', [])
            valid_correct = [c for c in correct if c and c != 'null' and c.strip()]
            
            if not valid_correct:
                continue
            
            primary_domain = q.get('primary_domain', 'indefinito')
            subdomain = q.get('subdomain', 'indefinito')
            
            if primary_domain not in categories:
                categories[primary_domain] = {
                    'count': 0,
                    'subdomains': {}
                }
            
            categories[primary_domain]['count'] += 1
            
            if subdomain not in categories[primary_domain]['subdomains']:
                categories[primary_domain]['subdomains'][subdomain] = 0
            
            categories[primary_domain]['subdomains'][subdomain] += 1
        
        return categories
    
    def get_questions_for_quiz(
        self,
        categories: List[str],
        num_questions: int,
        subdomains_by_primary: Optional[Dict[str, List[str]]] = None
    ) -> Tuple[List[Dict], int, int]:
        """
        Ottiene le domande per il quiz
        
        Returns:
            Tuple[List[Dict], int, int]: (domande_selezionate, domande_disponibili, domande_usate)
        """
        all_questions = self.load_database()
        
        # Normalizza filtro sottodomini (opzionale)
        normalized_sub_filter = {}
        if isinstance(subdomains_by_primary, dict):
            for p, subs in subdomains_by_primary.items():
                if not isinstance(p, str):
                    continue
                p_norm = p.strip()
                if not p_norm:
                    continue
                if not isinstance(subs, list):
                    subs = []
                valid_subs = set()
                for s in subs:
                    if not isinstance(s, str):
                        continue
                    s_norm = s.strip()
                    if s_norm:
                        valid_subs.add(s_norm)
                # Mantiene anche set vuoti: significa "nessun sottodominio selezionato"
                normalized_sub_filter[p_norm] = valid_subs

        # Filtra domande con almeno una risposta correta
        valid_questions = []
        for q in all_questions:
            correct = q.get('correct', [])
            valid_correct = [c for c in correct if c and c != 'null' and c.strip()]
            
            if not valid_correct:
                continue
            
            # Filtra per categorie selezionate
            primary_domain = q.get('primary_domain', 'indefinito')
            if not ('all' in categories or primary_domain in categories):
                continue

            # Filtro opzionale per sottodominio relativo alla primary
            if normalized_sub_filter:
                question_subdomain = q.get('subdomain', 'indefinito')
                allowed_for_primary = normalized_sub_filter.get(primary_domain)
                # Se la primary è stata passata nel filtro, applica il vincolo
                if isinstance(allowed_for_primary, set) and question_subdomain not in allowed_for_primary:
                    continue

            valid_questions.append(q)
        
        available_count = len(valid_questions)
        
        if available_count == 0:
            return [], 0, 0
        
        # Determina quante domande usare
        if num_questions == -1:  # "Tutte"
            questions_to_use = valid_questions
            used_count = available_count
        else:
            used_count = min(num_questions, available_count)
            questions_to_use = random.sample(valid_questions, used_count)
        
        # Arricchisci le domande con risposte aggiuntive se necessario
        enriched_questions = []
        for q in questions_to_use:
            enriched_q = self._enrich_question_answers(q, all_questions)
            enriched_questions.append(enriched_q)
        
        return enriched_questions, available_count, used_count
    
    def _enrich_question_answers(self, question: Dict, all_questions: List[Dict]) -> Dict:
        """
        Arricchisce una domanda con risposte aggiuntive se ha meno di 4 risposte
        """
        answers = question.get('answers', {})
        correct = question.get('correct', [])
        
        # Se ha già 4 o più risposte, ritorna così
        if len(answers) >= 4:
            return question
        
        # Trova risposte da altre domande della stessa categoria
        primary_domain = question.get('primary_domain', 'indefinito')
        same_category_questions = [
            q for q in all_questions 
            if q.get('primary_domain') == primary_domain and q.get('id') != question.get('id')
        ]
        
        # Raccogli tutte le risposte disponibili dalla stessa categoria
        additional_answers = []
        for q in same_category_questions:
            q_answers = q.get('answers', {})
            for letter, text in q_answers.items():
                if text and text.strip():
                    # Non aggiungere risposte che sono già corrette nella domanda originale
                    if letter not in correct:
                        additional_answers.append(text)
        
        # Mescola e prendi le risposte necessarie
        random.shuffle(additional_answers)
        needed = 4 - len(answers)
        
        # Aggiungi le risposte aggiuntive
        enriched_answers = answers.copy()
        available_letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
        
        for i in range(min(needed, len(additional_answers))):
            # Trova la prossima lettera disponibile
            for letter in available_letters:
                if letter not in enriched_answers:
                    enriched_answers[letter] = additional_answers[i]
                    break
        
        # Crea la domanda arricchita
        enriched_question = question.copy()
        enriched_question['answers'] = enriched_answers
        
        return enriched_question
    
    def validate_answer(self, question_id: str, user_answers: List[str]) -> Dict:
        """
        Valida le risposte dell'utente per una domanda
        
        Returns:
            Dict con: is_correct, is_partial, correct_answers, feedback, score
        """
        questions = self.load_database()
        
        # Trova la domanda
        question = None
        for q in questions:
            if q.get('id') == question_id:
                question = q
                break
        
        if not question:
            return {
                'error': 'Domanda non trovata',
                'is_correct': False,
                'is_partial': False,
                'correct_answers': [],
                'feedback': 'error',
                'score': 0.0
            }
        
        correct_answers = question.get('correct', [])
        valid_correct = [c for c in correct_answers if c and c != 'null' and c.strip()]
        
        # Normalizza le risposte utente
        user_answers_set = set(answer.strip().upper() for answer in user_answers if answer and answer.strip())
        correct_answers_set = set(answer.strip().upper() for answer in valid_correct if answer and answer.strip())
        total_correct = len(correct_answers_set)
        
        # Calcola il risultato
        if not correct_answers_set:
            # Nessuna risposta corretta definita
            return {
                'is_correct': False,
                'is_partial': False,
                'correct_answers': list(correct_answers_set),
                'feedback': 'nessuna_risposta_corretta_definita',
                'score': 0.0
            }
        
        if not user_answers_set:
            # L'utente non ha selezionato nulla
            return {
                'is_correct': False,
                'is_partial': False,
                'correct_answers': list(correct_answers_set),
                'feedback': 'nessuna_risposta',
                'score': 0.0
            }
        
        # Verifica correttezza
        if user_answers_set == correct_answers_set:
            return {
                'is_correct': True,
                'is_partial': False,
                'correct_answers': list(correct_answers_set),
                'feedback': 'corretto',
                'score': 1.0
            }
        
        # Verifica parziale
        correct_selected = user_answers_set.intersection(correct_answers_set)
        wrong_selected = user_answers_set - correct_answers_set
        correct_selected_count = len(correct_selected)
        
        if correct_selected and not wrong_selected:
            # Ha selezionato solo alcune risposte corrette - Punteggio proporzionale
            score = correct_selected_count / total_correct
            return {
                'is_correct': False,
                'is_partial': True,
                'correct_answers': list(correct_answers_set),
                'feedback': 'parziale_mancanti',
                'score': score
            }
        
        if correct_selected and wrong_selected:
            # Ha selezionato alcune corrette e alcune sbagliate - 0 punti
            return {
                'is_correct': False,
                'is_partial': True,
                'correct_answers': list(correct_answers_set),
                'feedback': 'parziale_errate',
                'score': 0.0
            }
        
        # Ha selezionato solo risposte sbagliate
        return {
            'is_correct': False,
            'is_partial': False,
            'correct_answers': list(correct_answers_set),
            'feedback': 'errato',
            'score': 0.0
        }
        
        correct_answers = question.get('correct', [])
        valid_correct = [c for c in correct_answers if c and c != 'null' and c.strip()]
        
        # Normalizza le risposte utente
        user_answers_set = set(answer.strip().upper() for answer in user_answers if answer and answer.strip())
        correct_answers_set = set(answer.strip().upper() for answer in valid_correct if answer and answer.strip())
        
        # Calcola il risultato
        if not correct_answers_set:
            # Nessuna risposta correta definita
            return {
                'is_correct': False,
                'is_partial': False,
                'correct_answers': list(correct_answers_set),
                'feedback': 'nessuna_risposta_corretta_definita'
            }
        
        if not user_answers_set:
            # L'utente non ha selezionato nulla
            return {
                'is_correct': False,
                'is_partial': False,
                'correct_answers': list(correct_answers_set),
                'feedback': 'nessuna_risposta'
            }
        
        # Verifica correttezza
        if user_answers_set == correct_answers_set:
            return {
                'is_correct': True,
                'is_partial': False,
                'correct_answers': list(correct_answers_set),
                'feedback': 'corretto'
            }
        
        # Verifica parziale
        correct_selected = user_answers_set.intersection(correct_answers_set)
        wrong_selected = user_answers_set - correct_answers_set
        
        if correct_selected and not wrong_selected:
            # Ha selezionato solo alcune risposte corrette
            return {
                'is_correct': False,
                'is_partial': True,
                'correct_answers': list(correct_answers_set),
                'feedback': 'parziale_mancanti'
            }
        
        if correct_selected and wrong_selected:
            # Ha selezionato alcune corrette e alcune sbagliate
            return {
                'is_correct': False,
                'is_partial': True,
                'correct_answers': list(correct_answers_set),
                'feedback': 'parziale_errate'
            }
        
        # Ha selezionato solo risposte sbagliate
        return {
            'is_correct': False,
            'is_partial': False,
            'correct_answers': list(correct_answers_set),
                'feedback': 'errato'
        }
    
    def save_quiz_log(self, quiz_data: Dict) -> str:
        """
        Salva il log di un quiz completato
        
        Returns:
            str: ID del quiz salvato
        """
        timestamp = datetime.now()
        quiz_id = f"quiz_{timestamp.strftime('%Y%m%d_%H%M%S')}"
        
        # Aggiungi metadati
        quiz_data['id'] = quiz_id
        quiz_data['date'] = timestamp.isoformat()
        
        # Salva il file
        filename = f"{quiz_id}.json"
        filepath = self.quiz_log_dir / filename
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(quiz_data, f, ensure_ascii=False, indent=2)
        
        return quiz_id
    
    def get_quiz_logs(self) -> List[Dict]:
        """
        Ottiene la lista di tutti i log dei quiz
        """
        logs = []
        
        if not self.quiz_log_dir.exists():
            return logs
        
        for file in self.quiz_log_dir.glob('*.json'):
            try:
                with open(file, 'r', encoding='utf-8') as f:
                    log_data = json.load(f)
                    
                    # Estrai informazioni summary
                    summary = {
                        'id': log_data.get('id', file.stem),
                        'date': log_data.get('date', ''),
                        'categories': log_data.get('categories_selected', []),
                        'total_questions': log_data.get('total_questions_used', 0),
                        'correct_answers': log_data.get('correct_answers', 0),
                        'score_percentage': log_data.get('score_percentage', 0),
                        'total_time_seconds': log_data.get('total_time_seconds', 0),
                        'file_name': file.name
                    }
                    logs.append(summary)
            except Exception as e:
                print(f"Errore nel leggere il log {file}: {e}")
        
        # Ordina per data (più recenti prima)
        logs.sort(key=lambda x: x.get('date', ''), reverse=True)
        
        return logs
    
    def get_quiz_log_detail(self, log_id: str) -> Optional[Dict]:
        """
        Ottiene il dettaglio di un log specifico
        """
        # Cerca il file corrispondente
        for file in self.quiz_log_dir.glob('*.json'):
            if file.stem == log_id or file.name == f"{log_id}.json":
                try:
                    with open(file, 'r', encoding='utf-8') as f:
                        return json.load(f)
                except Exception as e:
                    print(f"Errore nel leggere il log {file}: {e}")
                    return None
        
        return None
    
    def delete_quiz_log(self, log_id: str) -> bool:
        """
        Cancella un log specifico
        """
        for file in self.quiz_log_dir.glob('*.json'):
            if file.stem == log_id or file.name == f"{log_id}.json":
                try:
                    file.unlink()
                    return True
                except Exception as e:
                    print(f"Errore nel cancellare il log {file}: {e}")
                    return False
        
        return False
    
    def delete_all_quiz_logs(self) -> int:
        """
        Cancella tutti i log dei quiz
        
        Returns:
            int: Numero di file cancellati
        """
        deleted_count = 0
        
        if not self.quiz_log_dir.exists():
            return deleted_count
        
        for file in self.quiz_log_dir.glob('*.json'):
            try:
                file.unlink()
                deleted_count += 1
            except Exception as e:
                print(f"Errore nel cancellare il log {file}: {e}")
        
        return deleted_count