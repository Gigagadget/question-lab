## 📋 Piano di Modifica: Ripasso Intelligente + Quiz a Tempo

### Fase 1: Nuovo Modulo Backend per Spaced Repetition

#### 1.1 Creare `modules/spaced_repetition.py`

**Azione:** Creare il file con l'algoritmo di ponderazione e aggiornamento statistiche.

```python
# modules/spaced_repetition.py
"""Algoritmo di spaced repetition per selezione ponderata delle domande."""

from datetime import datetime
from typing import Dict, List, Any


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

    correct = stats.get('correct_attempts', 0)
    partial = stats.get('partial_attempts', 0)
    wrong = stats.get('wrong_attempts', 0)
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
    correct = stats['correct_attempts']
    partial = stats['partial_attempts']
    raw_mastery = (correct * 1.0 + partial * 0.3) / max(total, 1) * 5
    stats['mastery_level'] = min(5, max(0, int(raw_mastery)))
```

#### 1.2 Modificare `modules/quiz_utils.py`

**Azioni:**
- Importare il modulo `spaced_repetition`.
- Aggiungere parametro `smart_review` a `get_questions_for_quiz`.
- Implementare campionamento ponderato.
- Aggiornare le statistiche delle domande dopo la validazione.

**Snippet da aggiungere in cima:**
```python
from modules.spaced_repetition import calculate_question_weight, update_question_review_stats
```

**Modifica `get_questions_for_quiz`:**
```python
def get_questions_for_quiz(
    self,
    categories: List[str],
    num_questions: int,
    subdomains_by_primary: Optional[Dict[str, List[str]]] = None,
    smart_review: bool = False  # NUOVO
) -> Tuple[List[Dict], int, int]:
    # ... (codice esistente per valid_questions) ...

    if smart_review and valid_questions:
        import random
        weights = [calculate_question_weight(q) for q in valid_questions]
        if num_questions == -1:
            questions_to_use = valid_questions
            used_count = available_count
        else:
            used_count = min(num_questions, available_count)
            questions_to_use = random.choices(
                valid_questions,
                weights=weights,
                k=used_count
            )
    else:
        # Comportamento originale
        if num_questions == -1:
            questions_to_use = valid_questions
            used_count = available_count
        else:
            used_count = min(num_questions, available_count)
            questions_to_use = random.sample(valid_questions, used_count)

    # ... (resto invariato) ...
```

**Modifica `validate_answer` per aggiornare le statistiche:**
All'interno di `validate_answer`, dopo aver calcolato il punteggio e prima del return, aggiungere:
```python
# Aggiorna statistiche di ripasso se lo score è definito
if 'score' in result and result['score'] is not None:
    update_question_review_stats(question, result['score'])
    # Salva il database per persistere le statistiche (opzionale, può essere fatto in batch)
    self.save_database(questions)  # Assicurati che save_database esista o usa load/save
```

> **Nota:** Potrebbe essere necessario aggiungere un metodo `save_database` a `QuizManager` o usare le funzioni di `utils.py`. Valuteremo se salvare subito o accumulare.

---

### Fase 2: Modifiche al Frontend - Configurazione Quiz

#### 2.1 Modificare `templates/quiz.html`

**Azione:** Aggiungere le sezioni UI per modalità selezione e timer globale, dopo la sezione categorie e prima del setup-summary.

**Snippet da inserire (in `#quizSetup .setup-card`, dopo `#categoriesContainer`):**

```html
<!-- Modalità di Selezione -->
<div class="setup-section">
    <div class="section-header-with-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a10 10 0 1 0 10 10 10 10 0 0 0-10-10z"/>
            <path d="M12 6v6l4 2"/>
        </svg>
        <h3>Modalità di Selezione</h3>
    </div>
    <div class="selection-mode-options">
        <label class="mode-card">
            <input type="radio" name="selectionMode" value="random" checked>
            <span class="mode-card-indicator"></span>
            <div class="mode-card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 4 18 9"/>
                    <polyline points="6 15 12 20 18 15"/>
                    <line x1="4" y1="9" x2="20" y2="9"/>
                    <line x1="4" y1="15" x2="20" y2="15"/>
                </svg>
            </div>
            <div class="mode-card-content">
                <span class="mode-card-title">Selezione Casuale</span>
                <span class="mode-card-description">Tutte le domande hanno la stessa probabilità di apparire</span>
            </div>
        </label>
        <label class="mode-card">
            <input type="radio" name="selectionMode" value="smart">
            <span class="mode-card-indicator"></span>
            <div class="mode-card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 2v4"/>
                    <path d="M12 18v4"/>
                    <path d="M4.93 4.93l2.83 2.83"/>
                    <path d="M16.24 16.24l2.83 2.83"/>
                </svg>
            </div>
            <div class="mode-card-content">
                <span class="mode-card-title">Ripasso Intelligente</span>
                <span class="mode-card-description">Le domande più difficili per te appaiono più frequentemente</span>
            </div>
        </label>
    </div>
</div>

<!-- Opzioni di Tempo -->
<div class="setup-section">
    <div class="section-header-with-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
        </svg>
        <h3>Opzioni di Tempo</h3>
    </div>
    <div class="timer-mode-options">
        <label class="mode-card">
            <input type="radio" name="timerMode" value="per_question" checked>
            <span class="mode-card-indicator"></span>
            <div class="mode-card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>
            </div>
            <div class="mode-card-content">
                <span class="mode-card-title">Timer per Domanda</span>
                <span class="mode-card-description">Nessun limite di tempo complessivo</span>
            </div>
        </label>
        <label class="mode-card">
            <input type="radio" name="timerMode" value="global">
            <span class="mode-card-indicator"></span>
            <div class="mode-card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 2v4"/>
                    <path d="M12 18v4"/>
                    <path d="M4.93 4.93l2.83 2.83"/>
                    <path d="M16.24 16.24l2.83 2.83"/>
                    <path d="M2 12h4"/>
                    <path d="M18 12h4"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>
            </div>
            <div class="mode-card-content">
                <span class="mode-card-title">Timer Globale</span>
                <span class="mode-card-description">Simula un esame con tempo limite complessivo</span>
            </div>
        </label>
    </div>
    <div id="globalTimerSettings" class="global-timer-settings" style="display: none;">
        <div class="time-presets-grid">
            <button class="time-preset-card" data-minutes="15"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>15 min</span></button>
            <button class="time-preset-card" data-minutes="30"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>30 min</span></button>
            <button class="time-preset-card" data-minutes="45"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>45 min</span></button>
            <button class="time-preset-card" data-minutes="60"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>60 min</span></button>
            <button class="time-preset-card" data-minutes="90"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>90 min</span></button>
            <button class="time-preset-card" data-minutes="120"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>120 min</span></button>
        </div>
        <div class="custom-time-input">
            <div class="input-with-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <input type="number" id="customMinutes" min="1" max="480" placeholder="Minuti personalizzati...">
            </div>
            <button id="applyCustomTime" class="btn-outline">Applica</button>
        </div>
    </div>
</div>
```

**Modifica barra superiore del quiz game:**
Nel `#quizGame`, sostituire l'attuale `div.quiz-timer` con:

```html
<div class="quiz-timers">
    <div class="quiz-timer" id="questionTimerContainer">
        <svg class="timer-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span id="timer">00:00</span>
        <span class="timer-label">per domanda</span>
    </div>
    <div class="quiz-timer global-timer" id="globalTimerContainer" style="display: none;">
        <svg class="timer-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 2v4"/>
            <path d="M12 18v4"/>
            <path d="M4.93 4.93l2.83 2.83"/>
            <path d="M16.24 16.24l2.83 2.83"/>
            <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span id="globalTimer">--:--</span>
        <span class="timer-label">rimanente</span>
    </div>
</div>
```

#### 2.2 Aggiungere stili in `static/css/quiz.css`

**Azione:** Inserire i CSS forniti nella risposta precedente (`.section-header-with-icon`, `.mode-card`, `.global-timer-settings`, `.quiz-timers`, ecc.). Assicurarsi che siano dopo gli stili esistenti per garantire precedenza.

---

### Fase 3: Logica Frontend in `static/js/quiz.js`

#### 3.1 Estendere `QuizManagerFrontend`

**Aggiungere proprietà nello stato:**
```javascript
// Nel costruttore
this.selectionMode = 'random';        // 'random' o 'smart'
this.timerMode = 'per_question';      // 'per_question' o 'global'
this.globalTimer = null;
this.globalTimeLimit = null;
this.globalTimeRemaining = null;
```

**Aggiungere metodi per il timer globale:**
```javascript
startGlobalTimer(timeLimitSeconds) {
    this.globalTimeLimit = timeLimitSeconds;
    this.globalTimeRemaining = timeLimitSeconds;
    this.updateGlobalTimerDisplay();
    
    this.globalTimer = setInterval(() => {
        this.globalTimeRemaining--;
        this.updateGlobalTimerDisplay();
        
        if (this.globalTimeRemaining <= 0) {
            this.handleTimeExpired();
        }
    }, 1000);
}

handleTimeExpired() {
    clearInterval(this.globalTimer);
    this.globalTimer = null;
    this.showStatus('Tempo scaduto. Quiz terminato automaticamente.', 'warning');
    // Salva risposte pendenti e termina
    this.finishQuiz(false, true); // interrupted=false, timeExpired=true
}

updateGlobalTimerDisplay() {
    const timerEl = document.getElementById('globalTimer');
    if (!timerEl) return;
    const mins = Math.floor(this.globalTimeRemaining / 60);
    const secs = this.globalTimeRemaining % 60;
    timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    const container = document.getElementById('globalTimerContainer');
    if (this.globalTimeRemaining <= 300) {
        container.classList.add('warning');
        container.classList.remove('critical');
    }
    if (this.globalTimeRemaining <= 60) {
        container.classList.remove('warning');
        container.classList.add('critical');
    }
}

pauseGlobalTimer() {
    if (this.globalTimer) {
        clearInterval(this.globalTimer);
        this.globalTimer = null;
    }
}

resumeGlobalTimer() {
    if (this.timerMode === 'global' && this.globalTimeRemaining > 0) {
        this.startGlobalTimer(this.globalTimeRemaining);
    }
}
```

**Modificare `startQuiz` per includere i nuovi parametri:**
```javascript
async startQuiz() {
    // ... validazioni esistenti ...
    
    const selectionMode = document.querySelector('input[name="selectionMode"]:checked').value;
    const timerMode = document.querySelector('input[name="timerMode"]:checked').value;
    this.selectionMode = selectionMode;
    this.timerMode = timerMode;
    
    let timeLimitMinutes = null;
    if (timerMode === 'global') {
        const selectedPreset = document.querySelector('.time-preset-card.selected');
        timeLimitMinutes = selectedPreset ? parseInt(selectedPreset.dataset.minutes) : 60;
        const customInput = document.getElementById('customMinutes');
        if (customInput.value) {
            timeLimitMinutes = parseInt(customInput.value) || 60;
        }
    }
    
    const response = await fetch('/api/quiz/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            categories: this.selectedCategories,
            num_questions: this.selectedCount,
            subdomains_by_primary: this.selectedSubdomainsByPrimary,
            smart_review: selectionMode === 'smart'  // NUOVO PARAMETRO
        })
    });
    // ... resto invariato ...
    
    // Dopo aver caricato le domande, avvia i timer
    this.startTime = Date.now();
    this.elapsedTime = 0;
    this.startTimer(); // timer per domanda
    
    if (this.timerMode === 'global' && timeLimitMinutes) {
        document.getElementById('globalTimerContainer').style.display = 'flex';
        this.startGlobalTimer(timeLimitMinutes * 60);
    }
    
    // ...
}
```

**Modificare `submitAnswer` per gestire pausa/ripresa timer globale:**
All'inizio, mettere in pausa il timer globale (se attivo). Dopo aver mostrato il feedback, non riprendere automaticamente: si riprenderà al `nextQuestion`.

**Modificare `nextQuestion`:**
```javascript
nextQuestion() {
    if (this.currentQuestionIndex < this.questions.length - 1) {
        this.currentQuestionIndex++;
        this.displayQuestion();
        document.getElementById('btnSubmitAnswer').style.display = 'block';
        document.getElementById('btnNextQuestion').style.display = 'none';
        // Riprendi timer globale se necessario
        this.resumeGlobalTimer();
    } else {
        this.finishQuiz();
    }
}
```

**Modificare `finishQuiz` per includere info timer:**
```javascript
async finishQuiz(interrupted = false, timeExpired = false) {
    this.stopTimer();
    if (this.globalTimer) {
        clearInterval(this.globalTimer);
        this.globalTimer = null;
    }
    
    const quizLog = this.prepareQuizLog(interrupted);
    quizLog.timer_mode = this.timerMode;
    if (this.timerMode === 'global') {
        quizLog.time_limit_seconds = this.globalTimeLimit;
        quizLog.time_remaining_at_end = this.globalTimeRemaining;
        quizLog.time_expired = timeExpired;
    }
    // ... invio al server ...
}
```

**Aggiungere listener per UI timer:**
In `initializeEventListeners`, aggiungere:
```javascript
// Toggle impostazioni timer globale
document.querySelectorAll('input[name="timerMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const settings = document.getElementById('globalTimerSettings');
        settings.style.display = e.target.value === 'global' ? 'block' : 'none';
    });
});

// Preset tempo
document.querySelectorAll('.time-preset-card').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.time-preset-card').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('customMinutes').value = '';
    });
});

// Applica tempo personalizzato
document.getElementById('applyCustomTime').addEventListener('click', () => {
    const input = document.getElementById('customMinutes');
    const minutes = parseInt(input.value);
    if (minutes && minutes > 0 && minutes <= 480) {
        document.querySelectorAll('.time-preset-card').forEach(b => b.classList.remove('selected'));
    }
});
```

---

### Fase 4: Aggiornamento Backend per Salvare Statistiche

#### 4.1 Modificare `modules/quiz_utils.py` - Salvare statistiche dopo ogni risposta

Opzione: Dopo `validate_answer`, chiamare `self._save_questions(questions)` dove `questions` è la lista completa caricata. Per efficienza, potremmo salvare solo dopo la fine del quiz, ma per semplicità salviamo subito.

Aggiungere metodo a `QuizManager`:
```python
def _save_questions(self, questions):
    """Salva il database delle domande."""
    with open(self.database_file, 'w', encoding='utf-8') as f:
        json.dump(questions, f, indent=2, ensure_ascii=False)
```

In `validate_answer`, dopo aver aggiornato `update_question_review_stats`, chiamare `self._save_questions(questions)`.

#### 4.2 Assicurarsi che l'API `/quiz/start` accetti `smart_review`

Modificare `server/quiz.py`:
```python
@quiz_bp.route('/api/quiz/start', methods=['POST'])
def start_quiz():
    # ...
    smart_review = data.get('smart_review', False)  # nuovo
    questions, available_count, used_count = quiz_manager.get_questions_for_quiz(
        categories,
        num_questions,
        subdomains_by_primary=subdomains_by_primary,
        smart_review=smart_review  # passa il parametro
    )
```

---

### Fase 5: Test e Verifica

1. **Backend**: Verificare che `calculate_question_weight` restituisca valori coerenti.
2. **Frontend**: Controllare che le card di selezione e timer si attivino correttamente.
3. **Integrazione**: Eseguire un quiz con "Ripasso Intelligente" e verificare che nel log venga salvato `selection_mode: smart`.
4. **Timer Globale**: Avviare quiz con timer globale, attendere scadenza e verificare terminazione automatica.
5. **Tema Scuro**: Attivare tema scuro e controllare che tutti i nuovi elementi siano leggibili.