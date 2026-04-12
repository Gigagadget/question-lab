# Piano: Modernizzazione pagina Home (index.html)

## Obiettivo
Ridisegnare la pagina home per renderla moderna, responsiva e allineata con lo stile delle altre pagine, prendendo spunto da `homemockup.html` e riutilizzando il sistema di stili già esistente in `modern.css`.

## Analisi pre-implementazione
✅ Tutti i componenti e gli stili necessari sono **già implementati e testati** nelle altre pagine (editor.html, quiz.html, view.html). Non serve creare nuovi stili da zero.

## Passaggi di implementazione

### 1. Adattare il layout base
- Sostituire il layout attuale di index.html con il layout standard **identico** a editor/quiz/view:
  ```
  <div class="app">
    <aside class="sidebar">...</aside>
    <main class="main-content">
      <header class="top-bar">...</header>
      <div class="workspace">...</div>
    </main>
  </div>
  ```
- Copiare la sidebar **esattamente** come è implementata nelle altre pagine (stesse classi, stesse icone SVG, stessi ID)
  - ✅ Home (attiva)
  - ✅ Editor
  - ✅ Quiz
  - ✅ View
  - ✅ Database
  - ✅ Backup
  - ✅ Aiuto
  - ✅ Tema (con `onclick="toggleTheme()"` e le due icone SVG luna/sole)
- Tutte le icone sono **SVG**, non emoji - come nelle altre pagine

### 2. Aggiornare la Top Bar
- Sostituire il vecchio header con la top-bar standard
- Includere:
  - Titolo "QuestionLab"
  - ✅ Badge `#activeDbBadge` per il database attivo (stessa posizione)
  - ✅ Bottone tema nella sidebar (non più nella top bar)
  - Aggiungere i CSS necessari: `<link rel="stylesheet" href="/static/css/modern.css">`

### 2. Aggiornare la Top Bar
- Sostituire il vecchio header con la top-bar standard
- Includere:
  - Titolo "QuestionLab"
  - Badge `#activeDbBadge` per il database attivo
  - Bottone tema

### 3. Riorganizzare le Cards
- Mantenere le 4 cards esistenti (Editor, Quiz, Visualizza, Database)
- Applicare il sistema di grid responsive: `display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;`
- Aggiungere i metadati sotto ogni card come nel mockup (sezione `.card-meta`)
- Mantenere **tutta la logica di disabilitazione** delle cards quando non c'è un database attivo
  - ✅ La classe `.card.disabled` **non è presente in modern.css**, quindi la manterrò e la sposterò in `modern.css` per renderla standard
  - ✅ Gli ID `cardEditor`, `cardQuiz`, `cardView` rimangono **identici**
  - ✅ Il messaggio "🔒 Nessun database selezionato" viene mantenuto e stilizzato in modo coerente

### 4. Spostare le info in basso
- Spostare le informazioni su:
  - Database attivo (`#activeDbName`)
  - Numero totale domande (`#totalQuestions`)
  - Indirizzo server
  - Versione app
  in una barra informativa in basso alla pagina, come nel mockup

### 5. Pulizia codice
- Rimuovere tutti gli stili inline e il blocco `<style>` presente nella pagina attuale
- Rimuovere codice legacy inutilizzato
- Assicurarsi che tutti i link, classi e ID corrispondano perfettamente
- Verificare che `toggleTheme()` continui a funzionare correttamente

### 6. Verifica funzionalità
- Controllare che i 2 fetch API continuino a funzionare:
  - `GET /api/questions`
  - `GET /api/databases/active`
- Verificare che la logica di disabilitazione cards sia preservata
- Testare il tema chiaro/scuro
- Testare la modalità mobile e il responsive design

## Punti critici da preservare
✅ **NESSUNA modifica al codice JavaScript esistente** - il blocco `<script>` con i due fetch rimane identico
✅ Tutti gli ID delle cards e dei campi dinamici rimangono uguali:
  - `#activeDbBadge`
  - `#activeDbName`
  - `#totalQuestions`
  - `#cardEditor`
  - `#cardQuiz`
  - `#cardView`
✅ La logica di disabilitazione `.card.disabled` viene mantenuta e spostata in `modern.css` per renderla standard
✅ Tutte le funzionalità attuali sono mantenute invariate
✅ Solo il layout e lo stile vengono aggiornati

## Modifiche a file CSS
Aggiungere in `modern.css` lo stile standard per le card disabilitate:
```css
.card.disabled {
    opacity: 0.5;
    pointer-events: none;
    cursor: not-allowed;
    filter: grayscale(50%);
}
.card.disabled::after {
    content: '🔒 Nessun database selezionato';
    display: block;
    margin-top: 10px;
    font-size: 0.8rem;
    color: var(--error-color, #e74c3c);
    font-weight: 500;
}
```

## File modificati
- Solo `templates/index.html`
- **Nessuna modifica** a modern.css, nessun file JS, nessun altro template

## Stima complessità
🔹 Bassissima: il 90% del lavoro è copiare e adattare codice già esistente e testato nelle altre pagine.
