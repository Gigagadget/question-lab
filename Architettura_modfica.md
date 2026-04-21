# Documento di Progetto: Sistema di Studio Avanzato

## 1. Panoramica

### 1.1 Obiettivo
Estendere Question Lab con due funzionalità sinergiche per trasformarlo in uno strumento di studio professionale:
1. **Ripasso Intelligente (Smart Review)** – Un algoritmo di spaced repetition semplificato che seleziona le domande in base alle performance pregresse dell'utente.
2. **Quiz a Tempo (Timed Exam Mode)** – Una modalità che introduce un limite di tempo globale, simulando le condizioni di un esame reale.

### 1.2 Motivazione
- **Ripasso Intelligente**: Ottimizza il tempo di studio concentrandosi sulle aree di debolezza. Le domande con basso punteggio o non viste da tempo hanno maggiore probabilità di essere selezionate.
- **Quiz a Tempo**: Permette di esercitarsi sotto pressione temporale, migliorando la gestione del tempo e la preparazione agli esami.

### 1.3 Impatto sul Progetto
Le modifiche interessano:
- **Backend**: Nuovo modulo `spaced_repetition.py` e aggiornamenti a `quiz_utils.py`.
- **Frontend**: Nuove sezioni UI in `quiz.html`, logica di gestione timer in `quiz.js` e stili dedicati in `quiz.css`.
- **Dati**: Aggiunta del campo `review_stats` a ogni domanda per tracciare lo storico delle performance.

---

## 2. Architettura delle Modifiche

### 2.1 Diagramma dei Componenti

```
┌─────────────────────────────────────────────────────────────┐
│                       FRONTEND (quiz.js)                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │Selection Mode UI│  │ Timer Mode UI   │  │Global Timer  │ │
│  │ (radio cards)   │  │ (presets/custom)│  │Logic & Display│ │
│  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘ │
│           │                    │                   │         │
│           └────────────────────┼───────────────────┘         │
│                                ▼                             │
│                    POST /api/quiz/start                      │
│            { categories, num, smart_review }                 │
└─────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                      BACKEND (Flask)                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                server/quiz.py (Blueprint)            │    │
│  │  - Accetta smart_review e lo passa a QuizManager     │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                             ▼                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │             modules/quiz_utils.py                    │    │
│  │  QuizManager.get_questions_for_quiz()                │    │
│  │  - Se smart_review=True, usa campionamento ponderato │    │
│  │  - validate_answer() aggiorna review_stats           │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                             │                                │
│  ┌──────────────────────────▼──────────────────────────┐    │
│  │           modules/spaced_repetition.py               │    │
│  │  - calculate_question_weight(question) -> float      │    │
│  │  - update_question_review_stats(question, score)     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   database.json         │
                    │   (con review_stats)    │
                    └─────────────────────────┘
```

### 2.2 Flusso dei Dati

#### 2.2.1 Configurazione e Avvio Quiz
1. L'utente seleziona la modalità "Ripasso Intelligente" e/o imposta un timer globale.
2. Il frontend invia una richiesta `POST /api/quiz/start` con il flag `smart_review: true`.
3. `QuizManager` filtra le domande per categoria e calcola un peso per ciascuna usando `calculate_question_weight()`.
4. Le domande vengono campionate con probabilità proporzionale al peso (`random.choices`).
5. Il frontend avvia il timer globale (se richiesto) e presenta le domande.

#### 2.2.2 Durante il Quiz
1. L'utente risponde a una domanda.
2. Il frontend invia `POST /api/quiz/validate`.
3. `QuizManager.validate_answer()` calcola il punteggio (`score` tra 0 e 1).
4. `update_question_review_stats()` aggiorna `review_stats` della domanda (tentativi, padronanza, ultimo punteggio).
5. Il database viene salvato per persistere le statistiche.

#### 2.2.3 Gestione Timer Globale
1. Il frontend avvia un `setInterval` che decrementa il tempo rimanente ogni secondo.
2. Quando il tempo scade, il quiz viene terminato automaticamente, invocando `finishQuiz()`.
3. Il log del quiz include i campi `timer_mode`, `time_limit_seconds`, `time_remaining_at_end`, `time_expired`.

---

## 3. Modello dei Dati

### 3.1 Estensione del Documento "Domanda"

Ogni oggetto domanda in `data.json` acquisisce un nuovo campo opzionale `review_stats`:

```json
{
  "id": "Q001",
  "raw_text": "Qual è la capitale della Francia?",
  "answers": { ... },
  "correct": [ ... ],
  "review_stats": {
    "total_attempts": 5,
    "correct_attempts": 3,
    "partial_attempts": 1,
    "wrong_attempts": 1,
    "last_seen": "2024-01-15T10:30:00",
    "last_score": 1.0,
    "mastery_level": 4
  }
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `total_attempts` | int | Numero totale di volte che la domanda è stata affrontata |
| `correct_attempts` | int | Risposte completamente corrette (score = 1.0) |
| `partial_attempts` | int | Risposte parzialmente corrette (0 < score < 1.0) |
| `wrong_attempts` | int | Risposte completamente errate (score = 0) |
| `last_seen` | ISO 8601 | Timestamp dell'ultima risposta data |
| `last_score` | float | Punteggio ottenuto nell'ultima risposta (0.0-1.0) |
| `mastery_level` | int | Livello di padronanza calcolato (0-5) |

### 3.2 Estensione del Log Quiz

Il log del quiz (`quiz_*.json`) viene esteso con:

```json
{
  "id": "quiz_20240115_103000",
  "selection_mode": "smart",
  "timer_mode": "global",
  "time_limit_seconds": 3600,
  "time_remaining_at_end": 125,
  "time_expired": false
}
```

---

## 4. Algoritmo di Ponderazione (Spaced Repetition Light)

L'algoritmo `calculate_question_weight()` combina tre fattori:

### 4.1 Peso Base (Inverso della Padronanza)
```
base_weight = 1.0 - (mastery_level / 6.0)
```
- `mastery_level = 0` → peso = 1.0
- `mastery_level = 5` → peso = 0.17

### 4.2 Penalità per Errore Recente
Basata sull'`last_score`:
| last_score | Moltiplicatore |
|------------|----------------|
| < 0.3 | 2.5 |
| 0.3 - 0.5 | 2.0 |
| 0.5 - 0.7 | 1.5 |
| 0.7 - 1.0 | 1.2 |
| = 1.0 | 1.0 |

### 4.3 Bonus per Tempo Trascorso
Se la domanda non viene vista da molto tempo, il peso aumenta:
- > 30 giorni: ×2.0
- > 7 giorni: ×1.5

### 4.4 Formula Finale
```
weight = base_weight × recent_penalty × time_bonus
```
Il peso viene limitato inferiormente a `0.1` per evitare che una domanda non venga mai più selezionata.

---

## 5. Modifiche all'API

### 5.1 `POST /api/quiz/start`

**Richiesta** – aggiunto campo `smart_review`:
```json
{
  "categories": ["Cardiologia"],
  "num_questions": 20,
  "subdomains_by_primary": {},
  "smart_review": true   // nuovo
}
```

**Risposta** – invariata.

### 5.2 `POST /api/quiz/validate`

**Comportamento**: Dopo la validazione, la domanda viene aggiornata con `review_stats` e il database salvato.

### 5.3 `POST /api/quiz/save`

**Richiesta** – il log ora include campi relativi a timer e modalità di selezione.

---

## 6. Componenti Frontend

### 6.1 Selezione Modalità di Ripasso
- Due card selezionabili (`<label class="mode-card">`) con radio button nascosti.
- SVG inline per le icone.
- Stile `:checked` con bordo e sfondo che usano le variabili CSS del tema.

### 6.2 Opzioni Timer
- Due card per `timerMode` (`per_question` / `global`).
- Sezione `globalTimerSettings` mostrata dinamicamente.
- Griglia di preset (15, 30, 45, 60, 90, 120 minuti) e input personalizzato.

### 6.3 Timer Globale nel Quiz
- Secondo indicatore timer affiancato a quello per domanda.
- Classi CSS `.warning` e `.critical` per feedback visivo quando il tempo scarseggia.
- Logica JavaScript per avvio/pausa/ripresa e terminazione automatica.

### 6.4 Stili (Theme-Aware)
- Utilizzo estensivo delle variabili CSS (`--bg-tertiary`, `--border-light`, `--accent-blue`, ecc.).
- Transizioni fluide e micro-interazioni coerenti con il design moderno esistente.
- Supporto completo al tema scuro tramite selettore `[data-theme="dark"]`.

---

## 7. Considerazioni di Implementazione

### 7.1 Retrocompatibilità
- Il campo `review_stats` è opzionale. Le domande esistenti ne sono sprovviste e verranno trattate con peso `1.0`.
- L'API `/quiz/start` accetta `smart_review` come parametro opzionale (default `false`), preservando il comportamento originale.

### 7.2 Performance
- Il calcolo dei pesi avviene lato server durante la selezione delle domande. Per database di grandi dimensioni (>10k domande), il campionamento ponderato con `random.choices` rimane efficiente.
- L'aggiornamento delle statistiche avviene dopo ogni risposta, con un singolo salvataggio su disco. Per quiz lunghi, si potrebbe considerare un salvataggio differito, ma il carico è trascurabile per l'uso previsto.

### 7.3 Testing
- **Unit test**: Verificare `calculate_question_weight()` con diversi valori di input.
- **Integrazione**: Testare il flusso completo con `smart_review=true` e verificare che `review_stats` vengano popolati.
- **UI**: Controllare la responsività e il cambio tema.

---

## 8. Riepilogo delle Modifiche ai File

| File | Tipo | Modifiche |
|------|------|-----------|
| `modules/spaced_repetition.py` | Nuovo | Algoritmo di ponderazione e aggiornamento statistiche |
| `modules/quiz_utils.py` | Modifica | `get_questions_for_quiz`: campionamento ponderato; `validate_answer`: aggiornamento stats |
| `server/quiz.py` | Modifica | Passaggio parametro `smart_review` a `QuizManager` |
| `templates/quiz.html` | Modifica | Nuove sezioni UI (selezione modalità, timer globale, doppio timer) |
| `static/js/quiz.js` | Modifica | Logica `selectionMode`, `timerMode`, timer globale, listener UI |
| `static/css/quiz.css` | Modifica | Stili per `.mode-card`, `.global-timer-settings`, `.quiz-timers` |