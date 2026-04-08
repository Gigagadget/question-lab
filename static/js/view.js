// View Mode - Read-only question browser
const API_BASE_URL = '/api';

let questions = [];
let filteredQuestions = [];
let selectedId = null;
let showCorrectAnswers = false;
let categories = {
    primary_domains: [],
    subdomains: [],
    subdomains_by_primary: {}
};
const DEFAULT_PRIMARY_DOMAIN = 'indefinito';
const DEFAULT_SUBDOMAIN = 'indefinito';

// DOM elements
const questionsListDiv = document.getElementById('questionsList');
const detailPanel = document.getElementById('detailPanel');
const statusSpan = document.getElementById('statusMsg');
const questionCountSpan = document.getElementById('questionCount');
const viewCounter = document.getElementById('viewCounter');
const searchInput = document.getElementById('searchInput');
const primaryDomainCheckboxes = document.getElementById('primaryDomainCheckboxes');
const subdomainCheckboxes = document.getElementById('subdomainCheckboxes');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const toggleCorrectBtn = document.getElementById('toggleCorrectBtn');
const navPrevBtn = document.getElementById('navPrevBtn');
const navNextBtn = document.getElementById('navNextBtn');
const btnHome = document.getElementById('btnHome');
const btnExportDoc = document.getElementById('btnExportDoc');
const btnExportPdf = document.getElementById('btnExportPdf');
const sortSelect = document.getElementById('sortSelect');

// Selected categories
let selectedPrimaryDomains = new Set();
let selectedSubdomainsByPrimary = {};

function sortWithDefaultFirst(values, defaultValue = DEFAULT_SUBDOMAIN) {
    const uniq = [...new Set((values || []).filter(v => typeof v === 'string' && v.trim() !== '').map(v => v.trim()))]
        .sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
    const idx = uniq.indexOf(defaultValue);
    if (idx > -1) {
        uniq.splice(idx, 1);
        uniq.unshift(defaultValue);
    }
    return uniq;
}

function normalizeCategoriesData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};

    let primaryDomains = Array.isArray(data.primary_domains) ? data.primary_domains : [];
    primaryDomains = sortWithDefaultFirst([...primaryDomains, DEFAULT_PRIMARY_DOMAIN], DEFAULT_PRIMARY_DOMAIN);

    const map = {};
    const rawMap = data.subdomains_by_primary && typeof data.subdomains_by_primary === 'object'
        ? data.subdomains_by_primary
        : {};

    primaryDomains.forEach(primary => {
        let subs = Array.isArray(rawMap[primary]) ? rawMap[primary] : [];
        if (primary === DEFAULT_PRIMARY_DOMAIN) {
            subs = [DEFAULT_SUBDOMAIN];
        }
        subs = sortWithDefaultFirst([...subs, DEFAULT_SUBDOMAIN]);
        map[primary] = subs;
    });

    let allSubs = [];
    Object.values(map).forEach(subs => {
        allSubs.push(...subs);
    });
    if (Array.isArray(data.subdomains)) {
        allSubs.push(...data.subdomains);
    }
    allSubs = sortWithDefaultFirst([...allSubs, DEFAULT_SUBDOMAIN]);

    return {
        primary_domains: primaryDomains,
        subdomains: allSubs,
        subdomains_by_primary: map
    };
}

function getSubdomainsForPrimary(primaryDomain) {
    return categories.subdomains_by_primary?.[primaryDomain] || [DEFAULT_SUBDOMAIN];
}

function ensureSelectedSubdomainsForPrimary(primaryDomain) {
    if (!selectedSubdomainsByPrimary[primaryDomain]) {
        selectedSubdomainsByPrimary[primaryDomain] = new Set(getSubdomainsForPrimary(primaryDomain));
    }
}

function getDisplayedSubdomainTotals() {
    let total = 0;
    let selected = 0;
    categories.primary_domains.forEach(function(primary) {
        if (!selectedPrimaryDomains.has(primary)) return;
        const subs = getSubdomainsForPrimary(primary);
        total += subs.length;
        ensureSelectedSubdomainsForPrimary(primary);
        selected += selectedSubdomainsByPrimary[primary].size;
    });
    return { selected, total };
}

function renderSubdomainFilters() {
    var subHtml = '<div class="filter-header">';
    subHtml += '<span class="filter-label">📂 Sottodomini <span class="filter-count" id="subCount">0/0</span></span>';
    subHtml += '<div class="filter-actions">';
    subHtml += '<button onclick="window.selectAllSub()">Tutti</button>';
    subHtml += '<button onclick="window.selectNoneSub()">Nessuno</button>';
    subHtml += '</div></div>';

    const selectedPrimaryList = categories.primary_domains.filter(function(primary) {
        return selectedPrimaryDomains.has(primary);
    });

    if (selectedPrimaryList.length === 0) {
        subHtml += '<div class="empty-list" style="padding: 8px;">Seleziona almeno un dominio per vedere i sottodomini relativi.</div>';
        subdomainCheckboxes.innerHTML = subHtml;
        updateFilterCounts();
        return;
    }

    selectedPrimaryList.forEach(function(primary) {
        const subs = getSubdomainsForPrimary(primary);
        ensureSelectedSubdomainsForPrimary(primary);
        const selectedSet = selectedSubdomainsByPrimary[primary];

        subHtml += '<div style="margin-bottom: 10px;">';
        subHtml += '<div style="font-size: 0.78rem; color: #475569; margin: 4px 0;"><strong>' + escapeHtml(primary) + '</strong></div>';
        subHtml += '<div class="checkbox-group">';
        subs.forEach(function(s) {
            const checked = selectedSet.has(s) ? 'checked' : '';
            subHtml += '<label class="checkbox-label"><input type="checkbox" class="subdomain-cb" data-primary="' + escapeHtml(primary) + '" value="' + escapeHtml(s) + '" ' + checked + '><span>' + escapeHtml(s) + '</span></label>';
        });
        subHtml += '</div></div>';
    });

    subdomainCheckboxes.innerHTML = subHtml;

    document.querySelectorAll('.subdomain-cb').forEach(function(cb) {
        cb.addEventListener('change', function() {
            const primary = this.getAttribute('data-primary');
            const sub = this.value;
            ensureSelectedSubdomainsForPrimary(primary);
            if (this.checked) {
                selectedSubdomainsByPrimary[primary].add(sub);
            } else {
                selectedSubdomainsByPrimary[primary].delete(sub);
            }
            updateFilterCounts();
            applyFilters();
        });
    });

    updateFilterCounts();
}

// Helper: show status message
let statusTimeout;
function setStatus(msg) {
    if (statusTimeout) clearTimeout(statusTimeout);
    statusSpan.textContent = msg;
    statusTimeout = setTimeout(() => {
        statusSpan.textContent = 'Pronto';
    }, 2000);
}

// Escape HTML
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&';
        if (m === '<') return '<';
        if (m === '>') return '>';
        return m;
    });
}

// Fetch all questions
async function loadQuestions() {
    try {
        setStatus('Caricamento...');
        const response = await fetch(API_BASE_URL + '/questions');
        if (!response.ok) throw new Error('Recupero fallito');
        const data = await response.json();
        
        questions = data.questions;
        categories = normalizeCategoriesData(data.categories);
        
        // Populate filter dropdowns
        populateFilters();
        
        // Apply initial filters
        applyFilters();
        
        setStatus('Caricate ' + questions.length + ' domande');
    } catch (err) {
        console.error(err);
        setStatus('Errore caricamento');
        questionsListDiv.innerHTML = '<div class="empty-list">Errore nel caricamento. Assicurati che il backend sia in esecuzione.</div>';
    }
}

// Populate filter checkboxes
function populateFilters() {
    // Primary domains with new layout
    var primaryHtml = '<div class="filter-header">';
    primaryHtml += '<span class="filter-label">🏷️ Domini <span class="filter-count" id="primaryCount">0/' + categories.primary_domains.length + '</span></span>';
    primaryHtml += '<div class="filter-actions">';
    primaryHtml += '<button onclick="window.selectAllPrimary()">Tutti</button>';
    primaryHtml += '<button onclick="window.selectNonePrimary()">Nessuno</button>';
    primaryHtml += '</div></div>';
    primaryHtml += '<div class="checkbox-group">';
    categories.primary_domains.forEach(function(d) {
        primaryHtml += '<label class="checkbox-label"><input type="checkbox" class="primary-domain-cb" value="' + escapeHtml(d) + '" checked><span>' + escapeHtml(d) + '</span></label>';
    });
    primaryHtml += '</div>';
    primaryDomainCheckboxes.innerHTML = primaryHtml;
    
    // Add event listeners
    document.querySelectorAll('.primary-domain-cb').forEach(function(cb) {
        cb.addEventListener('change', function() {
            if (this.checked) {
                selectedPrimaryDomains.add(this.value);
                ensureSelectedSubdomainsForPrimary(this.value);
            } else {
                selectedPrimaryDomains.delete(this.value);
            }
            renderSubdomainFilters();
            updateFilterCounts();
            applyFilters();
        });
    });
    
    // Initialize selected sets
    selectedPrimaryDomains = new Set(categories.primary_domains);
    selectedSubdomainsByPrimary = {};
    categories.primary_domains.forEach(function(primary) {
        selectedSubdomainsByPrimary[primary] = new Set(getSubdomainsForPrimary(primary));
    });
    renderSubdomainFilters();
    
    // Update counts after initialization
    updateFilterCounts();
}

// Update filter counts display
function updateFilterCounts() {
    var primaryCountEl = document.getElementById('primaryCount');
    if (primaryCountEl) {
        primaryCountEl.textContent = selectedPrimaryDomains.size + '/' + categories.primary_domains.length;
    }
    
    var subCountEl = document.getElementById('subCount');
    if (subCountEl) {
        const subTotals = getDisplayedSubdomainTotals();
        subCountEl.textContent = subTotals.selected + '/' + subTotals.total;
    }
}

// Select all/none functions
function selectAllPrimary() {
    document.querySelectorAll('.primary-domain-cb').forEach(function(cb) {
        cb.checked = true;
        selectedPrimaryDomains.add(cb.value);
        selectedSubdomainsByPrimary[cb.value] = new Set(getSubdomainsForPrimary(cb.value));
    });
    renderSubdomainFilters();
    updateFilterCounts();
    applyFilters();
}

function selectNonePrimary() {
    document.querySelectorAll('.primary-domain-cb').forEach(function(cb) {
        cb.checked = false;
        selectedPrimaryDomains.delete(cb.value);
    });
    renderSubdomainFilters();
    updateFilterCounts();
    applyFilters();
}

function selectAllSub() {
    categories.primary_domains.forEach(function(primary) {
        if (!selectedPrimaryDomains.has(primary)) return;
        selectedSubdomainsByPrimary[primary] = new Set(getSubdomainsForPrimary(primary));
    });
    renderSubdomainFilters();
    updateFilterCounts();
    applyFilters();
}

function selectNoneSub() {
    categories.primary_domains.forEach(function(primary) {
        if (!selectedPrimaryDomains.has(primary)) return;
        selectedSubdomainsByPrimary[primary] = new Set();
    });
    renderSubdomainFilters();
    updateFilterCounts();
    applyFilters();
}

// Sort questions based on selected option
function sortQuestions(questionsToSort) {
    const sortBy = sortSelect ? sortSelect.value : 'id';
    
    if (sortBy === 'category') {
        // Sort by primary_domain, then by subdomain, then by id
        return questionsToSort.sort(function(a, b) {
            var domainA = (a.primary_domain || 'zzz').toLowerCase();
            var domainB = (b.primary_domain || 'zzz').toLowerCase();
            if (domainA !== domainB) return domainA.localeCompare(domainB);
            
            var subA = (a.subdomain || 'zzz').toLowerCase();
            var subB = (b.subdomain || 'zzz').toLowerCase();
            if (subA !== subB) return subA.localeCompare(subB);
            
            return a.id.localeCompare(b.id, undefined, {numeric: true, sensitivity: 'base'});
        });
    } else {
        // Sort by ID numerically
        return questionsToSort.sort(function(a, b) {
            return a.id.localeCompare(b.id, undefined, {numeric: true, sensitivity: 'base'});
        });
    }
}

// Apply filters
function applyFilters() {
    let filtered = questions.slice();
    
    // Search filter
    const searchTerm = searchInput.value.toLowerCase().trim();
    if (searchTerm) {
        filtered = filtered.filter(function(q) {
            return q.id.toLowerCase().includes(searchTerm) ||
                (q.raw_text && q.raw_text.toLowerCase().includes(searchTerm));
        });
    }
    
    // Primary domain filter - only if not all selected
    if (selectedPrimaryDomains.size < categories.primary_domains.length) {
        filtered = filtered.filter(function(q) {
            return selectedPrimaryDomains.has(q.primary_domain);
        });
    }
    
    // Subdomain filter relativo al dominio selezionato
    filtered = filtered.filter(function(q) {
        const primary = q.primary_domain;
        if (!selectedPrimaryDomains.has(primary)) return false;

        ensureSelectedSubdomainsForPrimary(primary);
        const allowed = selectedSubdomainsByPrimary[primary];
        return allowed.has(q.subdomain);
    });
    
    // Apply sorting
    filteredQuestions = sortQuestions(filtered);
    renderQuestionList();
    updateCounter();
}

// Render question list
function renderQuestionList() {
    questionCountSpan.textContent = filteredQuestions.length + ' domande';
    
    if (filteredQuestions.length === 0) {
        questionsListDiv.innerHTML = '<div class="empty-list">Nessuna domanda trovata</div>';
        return;
    }
    
    var html = '';
    filteredQuestions.forEach(function(q) {
        var isSelected = selectedId === q.id;
        var preview = q.raw_text ? q.raw_text.substring(0, 80) : 'Nessun testo';
        var moreText = q.raw_text && q.raw_text.length > 80 ? '...' : '';
        
        // Determine status badge
        let statusBadge = '';
        const hasAnswers = q.answers && q.answers.length > 0;
        const hasCorrectAnswer = q.correct_options && q.correct_options.length > 0;
        
        if (!hasAnswers) {
            statusBadge = '<span class="status-badge status-unanswered">Senza risposta</span>';
        } else if (!hasCorrectAnswer) {
            statusBadge = '<span class="status-badge status-unanswered">Senza corretta</span>';
        } else {
            statusBadge = '<span class="status-badge status-answered">Con risposta</span>';
        }
        
        html += `<div class="question-card-modern ${isSelected ? 'selected' : ''}" data-id="${q.id}">
            <div class="card-header">
                <span class="question-id-modern">${escapeHtml(q.id)}</span>
                ${statusBadge}
            </div>
            <div class="question-text-modern">${escapeHtml(preview)}${moreText}</div>
            <div class="question-meta-modern">
                <span>🧠 ${escapeHtml(q.primary_domain || 'N/D')}</span>
                <span>📁 ${escapeHtml(q.subdomain || 'N/D')}</span>
            </div>
        </div>`;
    });
    questionsListDiv.innerHTML = html;
    
    // Add click handlers
    document.querySelectorAll('.question-card-modern').forEach(function(el) {
        el.addEventListener('click', function() {
            var id = el.getAttribute('data-id');
            selectQuestion(id);
        });
    });
}

// Select a question
function selectQuestion(id) {
    selectedId = id;
    renderQuestionList();
    renderDetailView(id);
    updateCounter();
    updateNavButtons();
    scrollToSelectedQuestion();
}

// Scroll to selected question in the list
function scrollToSelectedQuestion() {
    var selectedElement = document.querySelector('.question-card-modern.selected');
    if (selectedElement) {
        selectedElement.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
        });
    }
}

// Update counter
function updateCounter() {
    var currentIndex = filteredQuestions.findIndex(function(q) { return q.id === selectedId; });
    if (currentIndex === -1) {
        viewCounter.textContent = 'Domanda 0 di ' + filteredQuestions.length;
    } else {
        viewCounter.textContent = 'Domanda ' + (currentIndex + 1) + ' di ' + filteredQuestions.length;
    }
}

// Update navigation buttons
function updateNavButtons() {
    var currentIndex = filteredQuestions.findIndex(function(q) { return q.id === selectedId; });
    navPrevBtn.disabled = currentIndex <= 0;
    navNextBtn.disabled = currentIndex === -1 || currentIndex >= filteredQuestions.length - 1;
}

// Render detail view (read-only)
function renderDetailView(id) {
    var question = questions.find(function(q) { return q.id === id; });
    if (!question) {
        detailPanel.innerHTML = '<div class="view-placeholder">' +
            '<div class="placeholder-icon">⚠️</div>' +
            '<h3>Domanda non trovata</h3>' +
            '</div>';
        return;
    }
    
    // Build answers HTML
    var answerLetters = Object.keys(question.answers || {}).sort();
    var correctAnswers = Array.isArray(question.correct) ? question.correct : [];
    
    var answersHtml = '';
    answerLetters.forEach(function(letter) {
        var answerText = question.answers[letter] || '';
        var isCorrect = correctAnswers.includes(letter);
        var showCorrect = showCorrectAnswers && isCorrect;
        
        answersHtml += '<div class="view-answer ' + (showCorrect ? 'correct' : '') + '">' +
            '<span class="view-answer-letter">' + letter + '</span>' +
            '<span class="view-answer-text">' + escapeHtml(answerText) + '</span>' +
            (showCorrect ? '<span class="view-correct-badge">✓ Corretta</span>' : '') +
            '</div>';
    });
    
    // Notes section
    var notesHtml = '';
    if (question.notes && question.notes.trim()) {
        notesHtml = '<div class="view-notes">' +
            '<div class="view-notes-label">📝 Note</div>' +
            '<div class="view-notes-text">' + escapeHtml(question.notes) + '</div>' +
            '</div>';
    }
    
    // Edit button
    var editButtonHtml = '<button class="view-edit-btn" onclick="window.openInEditor(\'' + escapeHtml(question.id) + '\')">✏️ Modifica</button>';
    
    detailPanel.innerHTML = '<div class="detail-card">' +
        '<div class="view-detail-content">' +
            '<div class="view-detail-header">' +
                '<span class="view-detail-id">' + escapeHtml(question.id) + '</span>' +
                '<span class="view-detail-domain">' + escapeHtml(question.primary_domain || 'N/D') + '</span>' +
                '<span class="view-detail-subdomain">' + escapeHtml(question.subdomain || 'N/D') + '</span>' +
                editButtonHtml +
            '</div>' +
            '<div class="view-question-text">' +
                escapeHtml(question.raw_text || 'Nessun testo disponibile') +
            '</div>' +
            '<div class="view-answers-section">' +
                '<div class="view-answers-title">Risposte</div>' +
                (answersHtml || '<div class="view-no-answers">Nessuna risposta disponibile</div>') +
            '</div>' +
            notesHtml +
        '</div>' +
    '</div>';
}

// Toggle correct answers visibility
function toggleCorrectAnswers() {
    showCorrectAnswers = !showCorrectAnswers;
    if (showCorrectAnswers) {
        toggleCorrectBtn.textContent = '🙈 Nascondi Risposte';
        toggleCorrectBtn.classList.add('active');
    } else {
        toggleCorrectBtn.textContent = '👁️ Mostra Risposte';
        toggleCorrectBtn.classList.remove('active');
    }
    // Re-render detail if a question is selected
    if (selectedId) {
        renderDetailView(selectedId);
    }
}

// Navigation
function navigateToPrevious() {
    var currentIndex = filteredQuestions.findIndex(function(q) { return q.id === selectedId; });
    if (currentIndex > 0) {
        selectQuestion(filteredQuestions[currentIndex - 1].id);
    }
}

function navigateToNext() {
    var currentIndex = filteredQuestions.findIndex(function(q) { return q.id === selectedId; });
    if (currentIndex < filteredQuestions.length - 1) {
        selectQuestion(filteredQuestions[currentIndex + 1].id);
    }
}

// Event listeners
btnHome.addEventListener('click', function() {
    window.location.href = '/';
});

// Help button functionality
const btnHelp = document.getElementById('btnHelp');
const helpModal = document.getElementById('helpModal');
const helpClose = helpModal.querySelector('.close');

btnHelp.addEventListener('click', function() {
    helpModal.style.display = 'block';
});

helpClose.addEventListener('click', function() {
    helpModal.style.display = 'none';
});

// Close modal when clicking outside of it
window.addEventListener('click', function(event) {
    if (event.target === helpModal) {
        helpModal.style.display = 'none';
    }
});

searchInput.addEventListener('input', function() { applyFilters(); });
sortSelect.addEventListener('change', function() { applyFilters(); });
clearFiltersBtn.addEventListener('click', function() {
    searchInput.value = '';
    selectAllPrimary();
    selectAllSub();
});

toggleCorrectBtn.addEventListener('click', toggleCorrectAnswers);
navPrevBtn.addEventListener('click', navigateToPrevious);
navNextBtn.addEventListener('click', navigateToNext);

// Keyboard navigation
document.addEventListener('keydown', function(event) {
    var activeElement = document.activeElement;
    var isInputFocused = activeElement.tagName === 'INPUT' || 
                          activeElement.tagName === 'TEXTAREA' || 
                          activeElement.tagName === 'SELECT';
    
    if (!isInputFocused) {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            navigateToPrevious();
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            navigateToNext();
        }
    }
});

// Open question in editor
function openInEditor(questionId) {
    window.location.href = '/editor?id=' + encodeURIComponent(questionId);
}

// Export to DOC
async function exportToDoc() {
    if (filteredQuestions.length === 0) {
        setStatus('Nessuna domanda da esportare', true);
        return;
    }
    
    try {
        setStatus('Generazione DOC...');
        
        const sortBy = sortSelect ? sortSelect.value : 'id';
        
        const response = await fetch(API_BASE_URL + '/export/doc', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                questions: filteredQuestions,
                sort_by: sortBy
            })
        });
        
        if (!response.ok) {
            throw new Error('Esportazione fallita');
        }
        
        // Get the blob from response
        const blob = await response.blob();
        
        // Get filename from Content-Disposition header or use default
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'questions_export.docx';
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
                filename = filenameMatch[1].replace(/['"]/g, '');
            }
        }
        
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        setStatus('DOC esportato con successo!');
    } catch (err) {
        console.error(err);
        setStatus('Errore durante l\'esportazione DOC', true);
    }
}

// Export to PDF
async function exportToPdf() {
    if (filteredQuestions.length === 0) {
        setStatus('Nessuna domanda da esportare', true);
        return;
    }
    
    try {
        setStatus('Generazione PDF...');
        
        const sortBy = sortSelect ? sortSelect.value : 'id';
        
        const response = await fetch(API_BASE_URL + '/export/pdf', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                questions: filteredQuestions,
                sort_by: sortBy
            })
        });
        
        if (!response.ok) {
            throw new Error('Esportazione fallita');
        }
        
        // Get the blob from response
        const blob = await response.blob();
        
        // Get filename from Content-Disposition header or use default
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'questions_export.pdf';
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
                filename = filenameMatch[1].replace(/['"]/g, '');
            }
        }
        
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        setStatus('PDF esportato con successo!');
    } catch (err) {
        console.error(err);
        setStatus('Errore durante l\'esportazione PDF', true);
    }
}

// Export button event listeners
btnExportDoc.addEventListener('click', exportToDoc);
btnExportPdf.addEventListener('click', exportToPdf);

// Check for active database and show/hide blocker
function checkActiveDatabase() {
    fetch('/api/databases/active')
        .then(res => res.json())
        .then(data => {
            const blocker = document.getElementById('noDbBlocker');
            if (blocker) {
                if (!data.active_database) {
                    blocker.style.display = 'flex';
                } else {
                    blocker.style.display = 'none';
                }
            }
        })
        .catch(err => {
            console.error('Error loading active database:', err);
            const blocker = document.getElementById('noDbBlocker');
            if (blocker) blocker.style.display = 'flex';
        });
}

// Check database on page load
checkActiveDatabase();

// Make functions global
window.openInEditor = openInEditor;
window.selectAllPrimary = selectAllPrimary;
window.selectNonePrimary = selectNonePrimary;
window.selectAllSub = selectAllSub;
window.selectNoneSub = selectNoneSub;

// Initial load
loadQuestions();
