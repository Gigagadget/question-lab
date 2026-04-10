// ---------- FRONTEND LOGIC ----------
const API_BASE_URL = '/api';

document.addEventListener('DOMContentLoaded', function() {
    // Load active database name
    document.getElementById('btnNewQuestion')?.addEventListener('click', createNewQuestion);
    fetch('/api/databases/active')
        .then(res => res.json())
        .then(data => {
            const dbName = data.active_database || 'Nessuno';
            document.getElementById('activeDbName').textContent = dbName;
            // Show/hide blocker based on active database
            const blocker = document.getElementById('noDbBlocker');
            if (blocker) {
                if (!data.active_database) {
                    blocker.style.display = 'flex';
                } else {
                    blocker.style.display = 'none';
                }
            }
        })
        .catch(err => console.error('Error loading active database:', err));
});

let questions = [];
let selectedId = null;
let categories = {
    primary_domains: [],
    subdomains: [],
    subdomains_by_primary: {}
};
let autoSaveTimer = null;
let isDirty = false;
let saveInProgress = false;
let showDuplicatesOnly = false;
const DEFAULT_PRIMARY_DOMAIN = 'indefinito';
const DEFAULT_SUBDOMAIN = 'indefinito';
let lastNormalizationWarningSignature = '';
let lastNormalizationWarningAt = 0;

// Flag feature
let filterFlaggedOnly = false;

// Selezione multipla
let selectedQuestionIds = new Set(); // ID delle domande selezionate per azioni batch

// DOM elements
const questionsListDiv = document.getElementById('questionsList');
const formContentDiv = document.getElementById('formContent');
const statusSpan = document.getElementById('statusMsg');
const questionCountSpan = document.getElementById('questionCountDisplay');
const searchInput = document.getElementById('searchInput');
const autoSaveIndicator = document.getElementById('autoSaveIndicator');
const toggleDuplicatesBtn = document.getElementById('toggleDuplicatesBtn');
const normalizationAlertEl = document.getElementById('normalizationAlert');
const normalizationAlertTextEl = document.getElementById('normalizationAlertText');
const normalizationAlertDetailsEl = document.getElementById('normalizationAlertDetails');
const normalizationAlertDetailsBtn = document.getElementById('normalizationAlertDetailsBtn');
const normalizationAlertCloseBtn = document.getElementById('normalizationAlertCloseBtn');
const normalizationToastEl = document.getElementById('normalizationToast');

// Filter elements
let primaryDomainFilter = null;
let subdomainFilter = null;
let filterNoAnswers = null;
let filterWithAnswers = null;
let filterNoCorrect = null;
let filterHasCorrect = null;
let categoriesModalPrimaryContext = '';
let normalizationToastTimeout = null;

function setupNormalizationAlertUi() {
    if (normalizationAlertCloseBtn) {
        normalizationAlertCloseBtn.addEventListener('click', () => {
            if (normalizationAlertEl) normalizationAlertEl.style.display = 'none';
            if (normalizationAlertDetailsEl) normalizationAlertDetailsEl.style.display = 'none';
            if (normalizationAlertDetailsBtn) normalizationAlertDetailsBtn.textContent = 'Dettagli';
        });
    }

    if (normalizationAlertDetailsBtn) {
        normalizationAlertDetailsBtn.addEventListener('click', () => {
            if (!normalizationAlertDetailsEl) return;
            const isOpen = normalizationAlertDetailsEl.style.display !== 'none';
            normalizationAlertDetailsEl.style.display = isOpen ? 'none' : 'block';
            normalizationAlertDetailsBtn.textContent = isOpen ? 'Dettagli' : 'Nascondi';
        });
    }
}

function showNormalizationToast(message) {
    if (!normalizationToastEl) return;
    normalizationToastEl.textContent = message;
    normalizationToastEl.classList.add('show');

    if (normalizationToastTimeout) clearTimeout(normalizationToastTimeout);
    normalizationToastTimeout = setTimeout(() => {
        normalizationToastEl.classList.remove('show');
    }, 3200);
}

setupNormalizationAlertUi();

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
    const primary = (primaryDomain || '').trim();
    if (!primary) {
        return categories.subdomains || [DEFAULT_SUBDOMAIN];
    }
    return categories.subdomains_by_primary?.[primary] || [DEFAULT_SUBDOMAIN];
}

function populateSubdomainSelect(selectEl, primaryDomain, preferredValue = '', includeEmptyOption = true, emptyLabel = '-- Seleziona --') {
    if (!selectEl) return;
    const subs = getSubdomainsForPrimary(primaryDomain);
    const options = [];
    if (includeEmptyOption) {
        options.push(`<option value="">${emptyLabel}</option>`);
    }
    options.push(...subs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`));
    selectEl.innerHTML = options.join('');

    if (preferredValue && subs.includes(preferredValue)) {
        selectEl.value = preferredValue;
    } else if (includeEmptyOption) {
        selectEl.value = '';
    } else {
        selectEl.value = subs[0] || DEFAULT_SUBDOMAIN;
    }
}

function refreshFilterSubdomainOptions(preferredValue = '') {
    if (!subdomainFilter) return;
    const selectedPrimary = primaryDomainFilter?.value || '';
    const keepValue = preferredValue || subdomainFilter.value || '';
    populateSubdomainSelect(subdomainFilter, selectedPrimary, keepValue, true, 'Tutti i Sottodomini');
}

function refreshQuestionSubdomainOptions(preferredValue = '') {
    const primarySelect = document.getElementById('field_primary_domain');
    const subdomainSelect = document.getElementById('field_subdomain');
    if (!primarySelect || !subdomainSelect) return;
    populateSubdomainSelect(subdomainSelect, primarySelect.value, preferredValue || subdomainSelect.value, false);
}

function toggleQuestionFlag(id) {
    const question = questions.find(q => q.id === id);
    if (!question) return;
    
    // Toggle status, default false if not present
    question.flagged = !(question.flagged || false);
    
    markDirty();
    renderQuestionList();
    renderFormForId(id);
}

function refreshCurrentFormCategorySelects() {
    const primarySelect = document.getElementById('field_primary_domain');
    if (primarySelect) {
        const currentPrimary = primarySelect.value;
        primarySelect.innerHTML = categories.primary_domains.map(d =>
            `<option value="${escapeHtml(d)}" ${currentPrimary === d ? 'selected' : ''}>${escapeHtml(d)}</option>`
        ).join('');
        if (!categories.primary_domains.includes(primarySelect.value)) {
            primarySelect.value = categories.primary_domains[0] || DEFAULT_PRIMARY_DOMAIN;
        }
        refreshQuestionSubdomainOptions();
    }
    createFilterUI();
}

async function refreshCategoriesFromServer() {
    const response = await fetch(`${API_BASE_URL}/categories`);
    if (!response.ok) {
        throw new Error('Errore nel recupero delle categorie');
    }
    const categoriesData = await response.json();
    categories = normalizeCategoriesData(categoriesData);
    return categories;
}

// Helper: show status message
let statusTimeout;
function setStatus(msg, isError = false) {
    if (!msg) {
        statusSpan.textContent = '';
        return;
    }
    if (statusTimeout) clearTimeout(statusTimeout);
    statusSpan.textContent = msg;
    statusSpan.style.color = isError ? '#c44536' : '#2c7da0';
    statusTimeout = setTimeout(() => {
        if (!isDirty) {
            statusSpan.textContent = 'Pronto';
            statusSpan.style.color = '#2c7da0';
        }
    }, 3000);
}

// Auto-save functionality - intelligent debounced
function markDirty() {
    if (saveInProgress) return;
    
    isDirty = true;
    autoSaveIndicator.style.color = '#e67e22';
    autoSaveIndicator.textContent = '● Modifiche in sospeso';
    
    // Clear existing timer
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    
    // Save after 300ms from last keystroke
    autoSaveTimer = setTimeout(() => {
        saveCurrentQuestion(selectedId);
    }, 300);
}

function clearDirty() {
    isDirty = false;
    autoSaveIndicator.style.color = '#27ae60';
    autoSaveIndicator.textContent = '● Auto';
}

function notifyCategoryNormalizationWarning(warnings) {
    const info = warnings?.category_normalization;
    if (!info || !info.count) return false;

    const examples = Array.isArray(info.examples)
        ? info.examples.filter(v => typeof v === 'string' && v.trim() !== '').slice(0, 5)
        : [];

    const signature = `${info.count}|${examples.join(',')}`;
    const now = Date.now();
    if (signature === lastNormalizationWarningSignature && (now - lastNormalizationWarningAt) < 15000) {
        return false;
    }

    lastNormalizationWarningSignature = signature;
    lastNormalizationWarningAt = now;

    const details = examples.length ? ` (es: ${examples.join(', ')})` : '';
    const message = `⚠️ ${info.count} domande riallineate a categorie valide${details}`;

    if (normalizationAlertEl && normalizationAlertTextEl) {
        normalizationAlertTextEl.textContent = message;
        normalizationAlertEl.style.display = 'block';
    }

    const changes = Array.isArray(info.changes) ? info.changes : [];
    if (normalizationAlertDetailsEl && normalizationAlertDetailsBtn) {
        if (changes.length > 0) {
            normalizationAlertDetailsBtn.style.display = 'inline-block';
            normalizationAlertDetailsEl.innerHTML = `
                <ul>
                    ${changes.map(c => {
                        const id = escapeHtml(String(c?.id || 'sconosciuto'));
                        const beforePrimary = escapeHtml(String(c?.before?.primary_domain ?? '')) || '∅';
                        const beforeSub = escapeHtml(String(c?.before?.subdomain ?? '')) || '∅';
                        const afterPrimary = escapeHtml(String(c?.after?.primary_domain ?? '')) || '∅';
                        const afterSub = escapeHtml(String(c?.after?.subdomain ?? '')) || '∅';
                        return `<li><strong>${id}</strong>: ${beforePrimary} / ${beforeSub} → ${afterPrimary} / ${afterSub}</li>`;
                    }).join('')}
                </ul>
            `;
            normalizationAlertDetailsEl.style.display = 'none';
            normalizationAlertDetailsBtn.textContent = 'Dettagli';
        } else {
            normalizationAlertDetailsBtn.style.display = 'none';
            normalizationAlertDetailsEl.style.display = 'none';
            normalizationAlertDetailsEl.innerHTML = '';
        }
    }

    showNormalizationToast(message);
    setStatus(message, true);
    return true;
}

// Fetch all questions
async function loadQuestions() {
    try {
        setStatus('Caricamento...');
        const response = await fetch(`${API_BASE_URL}/questions`);
        if (!response.ok) throw new Error('Recupero fallito');
        const data = await response.json();
        questions = data.questions;
        categories = normalizeCategoriesData(data.categories);
        const warningShown = notifyCategoryNormalizationWarning(data.warnings);

        // Create filter UI
        createFilterUI();

        // Get answer filter elements
        filterNoAnswers = document.getElementById('filterNoAnswers');
        filterWithAnswers = document.getElementById('filterWithAnswers');
        filterNoCorrect = document.getElementById('filterNoCorrect');
        filterHasCorrect = document.getElementById('filterHasCorrect');

        // Add event listeners for answer filters
        if (filterNoAnswers) filterNoAnswers.addEventListener('change', () => renderQuestionList());
        if (filterWithAnswers) filterWithAnswers.addEventListener('change', () => renderQuestionList());
        if (filterNoCorrect) filterNoCorrect.addEventListener('change', () => renderQuestionList());
        if (filterHasCorrect) filterHasCorrect.addEventListener('change', () => renderQuestionList());
        
        // Flagged filter
        const filterFlaggedEl = document.getElementById('filterFlaggedOnly');
        if (filterFlaggedEl) {
            filterFlaggedEl.checked = filterFlaggedOnly;
            filterFlaggedEl.addEventListener('change', () => {
                filterFlaggedOnly = filterFlaggedEl.checked;
                renderQuestionList();
            });
        }

        // Batch action buttons
        document.getElementById('btnBatchSelectAll')?.addEventListener('click', selectAllVisibleQuestions);
        document.getElementById('btnBatchDelete')?.addEventListener('click', batchDeleteQuestions);
        document.getElementById('btnBatchCategory')?.addEventListener('click', batchChangeCategory);
        document.getElementById('btnBatchClear')?.addEventListener('click', clearBatchSelection);

        renderQuestionList();

        if (questions.length > 0 && !selectedId) {
            selectQuestion(questions[0].id);
        } else if (selectedId && questions.find(q => q.id === selectedId)) {
            renderFormForId(selectedId);
        } else if (questions.length === 0) {
            selectedId = null;
            formContentDiv.innerHTML = `<div style="text-align:center; padding:40px; color:#94a3b8;">Nessuna domanda. Clicca "Nuova" per crearne una.</div>`;
        } else {
            selectQuestion(questions[0].id);
        }

        if (!warningShown) {
            setStatus(`Caricate ${questions.length} domande`);
        }
        clearDirty();
    } catch (err) {
        console.error(err);
        setStatus('Errore nel caricamento delle domande. Assicurati che il backend sia in esecuzione', true);
        questionsListDiv.innerHTML = `<div class="empty-list">Errore nel caricamento dei dati. Assicurati che il backend sia in esecuzione.</div>`;
    }
}

// Create filter UI with categories from server
function createFilterUI() {
    const domainsContainer = document.getElementById('filterDomains');
    const actionsContainer = document.getElementById('filterActions');
    if (!domainsContainer || !actionsContainer) return;

    // Save current filter values before recreating
    const savedPrimaryDomain = primaryDomainFilter?.value || '';
    const savedSubdomain = subdomainFilter?.value || '';

    domainsContainer.innerHTML = `
        <div class="filter-label">Dominio</div>
        <select id="primaryDomainFilter" class="filter-select-modern" style="margin-bottom: 12px;">
            <option value="">Tutti i Domini</option>
            ${categories.primary_domains.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
        </select>
        <div class="filter-label">Sottodominio</div>
        <select id="subdomainFilter" class="filter-select-modern"></select>
    `;

    actionsContainer.innerHTML = `
        <button id="clearFiltersBtn" class="btn-outline">↺ Azzera filtri</button>
        <button id="refreshCategoriesBtn" class="btn-outline">⟳ Aggiorna</button>
    `;

    primaryDomainFilter = document.getElementById('primaryDomainFilter');
    subdomainFilter = document.getElementById('subdomainFilter');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const refreshCategoriesBtn = document.getElementById('refreshCategoriesBtn');

    // Restore filter values
    if (primaryDomainFilter) {
        primaryDomainFilter.value = savedPrimaryDomain;
        primaryDomainFilter.addEventListener('change', () => {
            refreshFilterSubdomainOptions('');
            renderQuestionList();
        });
    }
    if (subdomainFilter) {
        subdomainFilter.addEventListener('change', () => renderQuestionList());
    }
    refreshFilterSubdomainOptions(savedSubdomain);

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (primaryDomainFilter) primaryDomainFilter.value = '';
            refreshFilterSubdomainOptions('');
            if (subdomainFilter) subdomainFilter.value = '';
            if (filterNoAnswers) filterNoAnswers.checked = false;
            if (filterWithAnswers) filterWithAnswers.checked = false;
            if (filterNoCorrect) filterNoCorrect.checked = false;
            if (filterHasCorrect) filterHasCorrect.checked = false;
            const flaggedEl = document.getElementById('filterFlaggedOnly');
            if (flaggedEl) { flaggedEl.checked = false; filterFlaggedOnly = false; }
            if (showDuplicatesOnly) { showDuplicatesOnly = false; updateToggleDuplicatesBtn(); }
            renderQuestionList();
        });
    }
    if (refreshCategoriesBtn) {
        refreshCategoriesBtn.addEventListener('click', async () => {
            try {
                await refreshCategoriesFromServer();
                createFilterUI();
                // Also update the form if open
                if (selectedId) {
                    renderFormForId(selectedId);
                }
                setStatus('Categorie aggiornate');
            } catch (err) {
                console.error(err);
                setStatus('Errore nell\'aggiornamento delle categorie', true);
            }
        });
    }
}

// Filter questions
function filterQuestions(questionsList) {
    let filtered = [...questionsList];
    
    // Search filter
    const searchTerm = searchInput.value.toLowerCase();
    if (searchTerm) {
        filtered = filtered.filter(q =>
            q.id.toLowerCase().includes(searchTerm) ||
            (q.raw_text && q.raw_text.toLowerCase().includes(searchTerm))
        );
    }
    
    // Primary domain filter
    const primaryDomain = primaryDomainFilter?.value;
    if (primaryDomain) {
        filtered = filtered.filter(q => q.primary_domain === primaryDomain);
    }
    
    // Subdomain filter
    const subdomain = subdomainFilter?.value;
    if (subdomain) {
        filtered = filtered.filter(q => q.subdomain === subdomain);
    }
    
    // Answer filters
    const noAnswersChecked = filterNoAnswers?.checked;
    const withAnswersChecked = filterWithAnswers?.checked;
    const noCorrectChecked = filterNoCorrect?.checked;
    const hasCorrectChecked = filterHasCorrect?.checked;

    if (noAnswersChecked || withAnswersChecked || noCorrectChecked || hasCorrectChecked) {
        filtered = filtered.filter(q => {
            const answers = q.answers || {};
            // Count ONLY non-empty answers (match backend logic)
            const nonEmptyAnswers = Object.values(answers).filter(v => v && v.trim()).length;
            const hasAnswers = nonEmptyAnswers > 0;
            // Count ONLY valid correct answers (exclude "null" and empty values - match backend logic)
            const validCorrect = (q.correct || []).filter(c => c && c !== "null").length;
            const hasCorrect = validCorrect > 0;

            if (noAnswersChecked && !hasAnswers) return true;
            if (withAnswersChecked && hasAnswers) return true;
            if (noCorrectChecked && hasAnswers && !hasCorrect) return true;
            if (hasCorrectChecked && hasCorrect) return true;

            return false;
        });
    }
    
    // Show duplicates only filter
    if (showDuplicatesOnly) {
        filtered = filtered.filter(q => q.duplicate_count > 0);
    }
    
    // Flagged only filter
    if (filterFlaggedOnly) {
        filtered = filtered.filter(q => q.flagged || false);
    }
    
    return filtered;
}

// Render question list
function renderQuestionList() {
    const filtered = filterQuestions(questions);

    questionCountSpan.textContent = filtered.length;
    updateBatchActionUI(); // Aggiorna contatore e bottoni azioni batch

    if (filtered.length === 0) {
        questionsListDiv.innerHTML = `<div class="empty-list">Nessuna domanda trovata</div>`;
        return;
    }


    questionsListDiv.innerHTML = filtered.map(q => {
        const isDuplicate = q.duplicate_count > 0;
        const isSelected = selectedQuestionIds.has(q.id);
        const isFlagged = q.flagged || false;
        const answerKeys = q.answers ? Object.keys(q.answers) : [];
        const validCorrect = (q.correct || []).filter(c => c && c !== "null");
        const hasAnswers = answerKeys.length > 0;
        const hasCorrectAnswer = validCorrect.length > 0;

        // Determine status badge
        let statusBadge = '';
        if (!hasCorrectAnswer) {
            statusBadge = '<span class="status-badge status-unanswered">Senza corretta</span>';
        } else if (!hasAnswers) {
            statusBadge = '<span class="status-badge status-unanswered">Senza risposta</span>';
        } else {
            statusBadge = '<span class="status-badge status-answered">Con risposta</span>';
        }

        if (isFlagged) {
            statusBadge += `<span class="status-badge status-flag">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                    <line x1="4" y1="22" x2="4" y2="15"></line>
                </svg>
            </span>`;
        }

        return `
            <div class="question-card-modern ${selectedId === q.id ? 'selected' : ''} ${isSelected ? 'batch-selected' : ''} ${isDuplicate ? 'duplicate-item' : ''} ${isFlagged ? 'flagged-item' : ''}" data-id="${q.id}">
                <div class="card-header">
                    <span class="question-id-modern">${escapeHtml(q.id)}</span>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        ${isDuplicate ? `<span class="status-badge status-duplicate">dup</span>` : ''}
                        ${statusBadge}
                        <input type="checkbox" class="batch-select-checkbox" data-id="${q.id}" ${isSelected ? 'checked' : ''}>
                    </div>
                </div>
                <div class="question-text-modern">${escapeHtml(q.raw_text ? q.raw_text.substring(0, 80) : 'Nessun testo disponibile')}${q.raw_text?.length > 80 ? '...' : ''}</div>
                <div class="question-meta-modern">
                    <span>
                        <svg class="meta-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
                        ${escapeHtml(q.primary_domain || 'nessun dominio')}
                    </span>
                    <span>
                        <svg class="meta-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
                        ${escapeHtml(q.subdomain || 'nessun sottodominio')}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    // Event listener per le checkbox
    document.querySelectorAll('.batch-select-checkbox').forEach(el => {
        el.addEventListener('change', (e) => {
            e.stopPropagation(); // Previeni il click sul question-item
            const id = el.getAttribute('data-id');
            toggleBatchSelection(id);
        });
    });

    // Event listener per i question-item (click sul testo carica la domanda)
    document.querySelectorAll('.question-card-modern').forEach(el => {
        el.addEventListener('click', (e) => {
            // Se non è un click sulla checkbox, carica la domanda
            if (!e.target.classList.contains('batch-select-checkbox')) {
                const id = el.getAttribute('data-id');
                selectQuestion(id);
            }
        });
    });
}

function scrollToSelectedQuestion() {
    // Piccolo delay per attendere che il DOM sia aggiornato dopo il render
    setTimeout(() => {
        const selectedElement = document.querySelector('.question-card-modern.selected');
        if (selectedElement) {
            selectedElement.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth',
                inline: 'nearest'
            });
        }
    }, 50);
}

function selectQuestion(id) {
    selectedId = id;
    renderQuestionList();
    renderFormForId(id);
    scrollToSelectedQuestion();
}

// ==================== SELEZIONE MULTIPLA E AZIONI BATCH ====================

// Toggle selezione di una domanda
function toggleBatchSelection(id) {
    if (selectedQuestionIds.has(id)) {
        selectedQuestionIds.delete(id);
    } else {
        selectedQuestionIds.add(id);
    }
    renderQuestionList(); // Per aggiornare lo stile
}

// Seleziona tutte le domande visibili (filtrate)
function selectAllVisibleQuestions() {
    const filtered = filterQuestions(questions);
    filtered.forEach(q => selectedQuestionIds.add(q.id));
    renderQuestionList();
}

// Deseleziona tutte
function clearBatchSelection() {
    selectedQuestionIds.clear();
    renderQuestionList();
}

// Aggiorna UI per azioni batch (contatore e bottoni)
function updateBatchActionUI() {
    const count = selectedQuestionIds.size;
    const batchActionsDiv = document.getElementById('batchActionsDiv');
    if (!batchActionsDiv) return;

    if (count > 0) {
        batchActionsDiv.style.display = 'flex';
        const countSpan = document.getElementById('batchCountSpan');
        if (countSpan) {
            countSpan.textContent = `${count} selez.`;
        }
    } else {
        batchActionsDiv.style.display = 'none';
    }
}

// Elimina domande selezionate
async function batchDeleteQuestions() {
    const count = selectedQuestionIds.size;
    if (count === 0) return;

    if (!confirm(`Eliminare ${count} domande selezionate?`)) return;

    // Salva lo stato dei filtri
    const currentFilters = {
        search: searchInput?.value || '',
        primaryDomain: primaryDomainFilter?.value || '',
        subdomain: subdomainFilter?.value || '',
        noAnswers: filterNoAnswers?.checked || false,
        withAnswers: filterWithAnswers?.checked || false,
        noCorrect: filterNoCorrect?.checked || false,
        showDuplicates: showDuplicatesOnly
    };

    // Rimuovi le domande selezionate
    const idsToDelete = Array.from(selectedQuestionIds);
    questions = questions.filter(q => !selectedQuestionIds.has(q.id));

    // Determina la prossima domanda da selezionare
    const filtered = filterQuestions(questions);
    if (filtered.length > 0) {
        selectedId = filtered[0].id;
    } else {
        selectedId = null;
        formContentDiv.innerHTML = `<div style="text-align:center; padding:40px;">Nessuna domanda. Creane una nuova.</div>`;
    }

    // Ripristina i filtri
    if (searchInput) searchInput.value = currentFilters.search;
    if (primaryDomainFilter) primaryDomainFilter.value = currentFilters.primaryDomain;
    refreshFilterSubdomainOptions(currentFilters.subdomain);
    if (filterNoAnswers) filterNoAnswers.checked = currentFilters.noAnswers;
    if (filterWithAnswers) filterWithAnswers.checked = currentFilters.withAnswers;
    if (filterNoCorrect) filterNoCorrect.checked = currentFilters.noCorrect;
    showDuplicatesOnly = currentFilters.showDuplicates;

    // Pulisci selezione
    selectedQuestionIds.clear();

    renderQuestionList();
    if (selectedId) renderFormForId(selectedId);
    await saveAllToServer(false);
    setStatus(`Eliminate ${count} domande`);
}

// Cambia categoria alle domande selezionate
async function batchChangeCategory() {
    const count = selectedQuestionIds.size;
    if (count === 0) return;

    const modal = document.createElement('div');
    modal.id = 'batchCategoryModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <h3 style="padding: 0px 20px;">🏷️ Cambia Categoria</h3>
            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px; padding: 0px 20px;">Seleziona la nuova categoria per ${count} domande</p>
            <div>
                <div class="form-group">
                    <label class="form-label">Nuovo Dominio Principale</label>
                    <select id="batchPrimaryDomain" class="form-input">
                        <option value="">-- Seleziona --</option>
                        ${categories.primary_domains.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Nuovo Sottodominio</label>
                    <select id="batchSubdomain" class="form-input" disabled>
                        <option value="">-- Seleziona prima un dominio --</option>
                    </select>
                </div>
            </div>
            <div style="display: flex; gap: 10px;">
                <button id="btnBatchCategoryCancel" class="btn-outline" style="flex: 1;">Annulla</button>
                <button id="btnBatchCategoryConfirm" class="btn-primary" style="flex: 1;">Applica</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.classList.add('show');

    // Close handler
    modal.querySelector('.close-modal').addEventListener('click', () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); });
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); } });

    // Event listener
    const batchPrimarySelect = document.getElementById('batchPrimaryDomain');
    const batchSubdomainSelect = document.getElementById('batchSubdomain');

    const refreshBatchSubdomains = () => {
        const selectedPrimary = batchPrimarySelect?.value || '';
        if (!selectedPrimary) {
            if (batchSubdomainSelect) {
                batchSubdomainSelect.disabled = true;
                batchSubdomainSelect.innerHTML = '<option value="">-- Seleziona prima un dominio --</option>';
            }
            return;
        }
        if (batchSubdomainSelect) {
            batchSubdomainSelect.disabled = false;
            populateSubdomainSelect(batchSubdomainSelect, selectedPrimary, '', true, '-- Seleziona --');
        }
    };

    batchPrimarySelect?.addEventListener('change', refreshBatchSubdomains);
    refreshBatchSubdomains();

    document.getElementById('btnBatchCategoryCancel')?.addEventListener('click', () => {
        modal.remove();
    });

    document.getElementById('btnBatchCategoryConfirm')?.addEventListener('click', async () => {
        const newPrimaryDomain = document.getElementById('batchPrimaryDomain')?.value;
        const newSubdomain = document.getElementById('batchSubdomain')?.value;

        if (!newPrimaryDomain && !newSubdomain) {
            alert('Seleziona almeno una categoria!');
            return;
        }

        if (newSubdomain && !newPrimaryDomain) {
            alert('Per cambiare sottodominio devi selezionare anche il dominio principale.');
            return;
        }

        // Aggiorna le domande selezionate
        let updatedCount = 0;
        questions.forEach(q => {
            if (selectedQuestionIds.has(q.id)) {
                if (newPrimaryDomain) {
                    q.primary_domain = newPrimaryDomain;
                    if (newSubdomain) {
                        q.subdomain = newSubdomain;
                    } else {
                        const allowedSubs = getSubdomainsForPrimary(newPrimaryDomain);
                        if (!allowedSubs.includes(q.subdomain)) {
                            q.subdomain = allowedSubs.includes(DEFAULT_SUBDOMAIN)
                                ? DEFAULT_SUBDOMAIN
                                : (allowedSubs[0] || DEFAULT_SUBDOMAIN);
                        }
                    }
                }
                updatedCount++;
            }
        });

        // Pulisci selezione
        selectedQuestionIds.clear();

        // Aggiorna filtri per riflettere le nuove categorie
        if (primaryDomainFilter && newPrimaryDomain) {
            primaryDomainFilter.value = newPrimaryDomain;
        }
        if (subdomainFilter) {
            if (newSubdomain) {
                subdomainFilter.value = newSubdomain;
            } else if (newPrimaryDomain) {
                // Only domain changed, reset subdomain filter to "all"
                refreshFilterSubdomainOptions('');
            }
        }

        renderQuestionList();
        if (selectedId) renderFormForId(selectedId);
        await saveAllToServer(false);
        setStatus(`Categoria aggiornata per ${updatedCount} domande`);
        modal.remove();
    });

    // Chiudi modal cliccando fuori
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Modifica la parte degli event listener per includere anche i select
function renderFormForId(id) {
    const question = questions.find(q => q.id === id);
    if (!question) {
        formContentDiv.innerHTML = `<div style="color:red;">Domanda non trovata</div>`;
        return;
    }
    
    // Get current position info
    const filtered = filterQuestions(questions);
    const currentIndex = filtered.findIndex(q => q.id === id);
    const total = filtered.length;
    
    // Detail actions header (mockup compliant)
    const isFlagged = question.flagged || false;
    const isDuplicate = question.duplicate_count > 0;
    
    const detailActionsHtml = `
        <div class="detail-actions">
            <div class="detail-title-row">
                <button id="btnFlagQuestion" class="btn-flag" title="${isFlagged ? 'Rimuovi flag' : 'Segna'}" ${isFlagged ? 'data-flagged="true"' : ''}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFlagged ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                        <line x1="4" y1="22" x2="4" y2="15"></line>
                    </svg>
                </button>
                <div class="id-group">
                    <input type="text" class="detail-id-input" id="field_id" value="${escapeHtml(question.id)}" placeholder="es., Q1257" maxlength="50">
                    <div id="idError" style="color: #c44536; font-size: 0.65rem; margin-top: 2px; display: none;"></div>
                </div>
            </div>
            <div class="nav-buttons-modern">
                <button id="navPrevBtn" class="nav-btn-modern" ${currentIndex === 0 ? 'disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <span class="nav-btn-text">Prec</span>
                </button>
                <span class="nav-counter">${currentIndex + 1} / ${total}</span>
                <button id="navNextBtn" class="nav-btn-modern" ${currentIndex === total - 1 ? 'disabled' : ''}>
                    <span class="nav-btn-text">Succ</span>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
            </div>
        </div>
        <div class="detail-secondary-actions">
            <button id="btnDuplicate" class="btn-secondary-action">📑 Duplica</button>
            <button id="btnDeleteQuestion" class="btn-secondary-action btn-delete-action">🗑️ Elimina</button>
        </div>
    `;

    // Get all answer letters from question
    const answerLetters = Object.keys(question.answers || {}).sort();
    let answersHtml = `<div class="answers-list" id="answersGrid">`;

    answerLetters.forEach(letter => {
        const answerValue = question.answers?.[letter] || '';
        answersHtml += `
            <div class="answer-row" data-letter="${letter}">
                <input type="checkbox" class="answer-check-modern" data-letter="${letter}" ${question.correct?.includes(letter) ? 'checked' : ''}>
                <span class="answer-letter">${letter}</span>
                <input type="text" class="answer-input answer-text-modern" data-letter="${letter}" value="${escapeHtml(answerValue)}" placeholder="Testo risposta">
                <button type="button" class="remove-answer" data-letter="${letter}" title="Elimina risposta">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        `;
    });
    answersHtml += `</div>`;

    // No separate correct checkboxes section - now integrated directly in answer rows
    let correctHtml = '';

    // Duplicate info - combined ID and text
    let duplicateHtml = '';
    if (question.duplicate_count > 0 && question.duplicate_ids && question.duplicate_texts) {
        const duplicatesList = [];
        for (let i = 0; i < question.duplicate_ids.length; i++) {
            duplicatesList.push({
                id: question.duplicate_ids[i],
                text: question.duplicate_texts[i]
            });
        }

        duplicateHtml = `
            <div class="accordion">
                <div class="accordion-header" onclick="window.toggleAccordion(this)">
                    <span>Duplicati (${question.duplicate_count})</span>
                    <svg class="accordion-arrow" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M6 4L10 8L6 12"/>
                    </svg>
                </div>
                <div class="accordion-content">
                    ${duplicatesList.map(d => `
                        <div class="duplicate-item-detail">
                            <span class="duplicate-id">${escapeHtml(d.id)}</span>
                            <span class="duplicate-text">${escapeHtml(d.text)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Form fields
    const fieldsHtml = `
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">Dominio</label>
                <select class="form-input" id="field_primary_domain">
                    ${categories.primary_domains.map(d => `<option value="${escapeHtml(d)}" ${question.primary_domain === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Sottodominio</label>
                <select class="form-input" id="field_subdomain"></select>
            </div>
        </div>
    `;

    // Answers section with header
    const answersSectionHtml = `
        <div class="answers-header">
            <label class="form-label">Risposte (seleziona quelle corrette)</label>
            <button type="button" id="addAnswerBtn" class="btn-icon-modern">+ Aggiungi risposta</button>
        </div>
        ${answersHtml}
    `;

    const formHtml = `
        <div class="detail-card">
            ${detailActionsHtml}
            ${fieldsHtml}
            <div class="form-group">
                <label class="form-label">Domanda</label>
                <textarea class="form-input" id="field_raw_text" placeholder="Testo della domanda...">${escapeHtml(question.raw_text || '')}</textarea>
            </div>
            ${answersSectionHtml}
            <div class="form-group">
                ${correctHtml}
            </div>
            <div class="form-group">
                <label class="form-label">Note</label>
                <textarea class="form-input" id="field_notes" placeholder="Aggiungi note...">${escapeHtml(question.notes || '')}</textarea>
            </div>
            ${duplicateHtml}
        </div>
    `;
    
    formContentDiv.innerHTML = formHtml;

    const formPrimarySelect = document.getElementById('field_primary_domain');
    refreshQuestionSubdomainOptions(question.subdomain);
    formPrimarySelect?.addEventListener('change', () => {
        refreshQuestionSubdomainOptions('');
    });

    // Navigation buttons handlers
    document.getElementById('navPrevBtn')?.addEventListener('click', navigateToPrevious);
    document.getElementById('navNextBtn')?.addEventListener('click', navigateToNext);
    
    // Add answer button handler
    document.getElementById('addAnswerBtn')?.addEventListener('click', addNewAnswer);
    
    // Add remove handlers for all answer buttons
    document.querySelectorAll('.remove-answer').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const letter = btn.getAttribute('data-letter');
            removeAnswer(letter);
        });
    });
    
    // Add handler for answer checkboxes (correct answers)
    document.querySelectorAll('.answer-check-modern').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const letter = checkbox.getAttribute('data-letter');
            const answerInput = document.querySelector(`.answer-input[data-letter="${letter}"]`);
            
            // Prevent marking empty answer as correct
            if (checkbox.checked && answerInput && !answerInput.value.trim()) {
                checkbox.checked = false;
                setStatus('Non puoi segnare come corretta una risposta vuota', true);
                return;
            }
            
            if (!Array.isArray(question.correct)) question.correct = [];
            
            if (checkbox.checked) {
                if (!question.correct.includes(letter)) {
                    question.correct.push(letter);
                }
            } else {
                question.correct = question.correct.filter(l => l !== letter);
            }
            
            markDirty();
        });
    });

    document.getElementById('btnDeleteQuestion')?.addEventListener('click', () => deleteQuestionById(id));
    document.getElementById('btnDuplicate')?.addEventListener('click', () => duplicateQuestion(id));
    document.getElementById('btnFlagQuestion')?.addEventListener('click', () => toggleQuestionFlag(id));
    document.getElementById('field_id')?.addEventListener('change', () => {
        validateId(id);
        markDirty();
    });
    document.getElementById('field_id')?.addEventListener('input', () => markDirty());
    
    // Per tutti i campi input, textarea, select
    const inputs = formContentDiv.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.removeEventListener('change', markDirty);
        input.removeEventListener('input', markDirty);
        input.addEventListener('change', () => markDirty());
        input.addEventListener('input', () => markDirty());
    });

    // Per i checkbox delle risposte corrette
    const correctCheckboxes = formContentDiv.querySelectorAll('.correct-checkbox');
    correctCheckboxes.forEach(cb => {
        cb.removeEventListener('change', markDirty);
        cb.addEventListener('change', () => markDirty());
    });
}

// Add new answer
function addNewAnswer() {
    const answersGrid = document.getElementById('answersGrid');
    const currentLetters = Array.from(answersGrid.querySelectorAll('.answer-row')).map(f => f.getAttribute('data-letter'));
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let newLetter = '';
    
    for (let i = 0; i < letters.length; i++) {
        if (!currentLetters.includes(letters[i])) {
            newLetter = letters[i];
            break;
        }
    }
    
    if (!newLetter) {
        setStatus('Numero massimo di risposte raggiunto', true);
        return;
    }
    
    const newAnswerHtml = `
        <div class="answer-row" data-letter="${newLetter}">
            <input type="checkbox" class="answer-check-modern" data-letter="${newLetter}">
            <span class="answer-letter">${newLetter}</span>
            <input type="text" class="answer-input answer-text-modern" data-letter="${newLetter}" value="" placeholder="Testo risposta">
            <button type="button" class="remove-answer" data-letter="${newLetter}" title="Elimina risposta">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `;
    
    answersGrid.insertAdjacentHTML('beforeend', newAnswerHtml);
    
    // Add remove handler
    const removeBtn = answersGrid.querySelector(`.remove-answer[data-letter="${newLetter}"]`);
    if (removeBtn) {
        removeBtn.addEventListener('click', () => removeAnswer(newLetter));
    }
    
    // Add input handlers
    const newInput = answersGrid.querySelector(`.answer-input[data-letter="${newLetter}"]`);
    if (newInput) {
        newInput.addEventListener('input', () => markDirty());
        newInput.addEventListener('change', () => markDirty());
        newInput.focus();
    }
    
    // Add checkbox handler
    const newCheckbox = answersGrid.querySelector(`.answer-check-modern[data-letter="${newLetter}"]`);
    if (newCheckbox) {
        newCheckbox.addEventListener('change', (e) => {
            const answerInput = document.querySelector(`.answer-input[data-letter="${newLetter}"]`);
            
            // Prevent marking empty answer as correct
            if (newCheckbox.checked && answerInput && !answerInput.value.trim()) {
                newCheckbox.checked = false;
                setStatus('Non puoi segnare come corretta una risposta vuota', true);
                return;
            }
            
            if (!Array.isArray(question.correct)) question.correct = [];
            
            if (newCheckbox.checked) {
                if (!question.correct.includes(newLetter)) {
                    question.correct.push(newLetter);
                }
            } else {
                question.correct = question.correct.filter(l => l !== newLetter);
            }
            
            markDirty();
        });
    }
    
    const correctOptions = document.getElementById('correctOptions');
    const correctCheckboxHtml = `
        <label class="correct-check">
            <input type="checkbox" class="correct-checkbox" value="${newLetter}"> ${newLetter}
        </label>
    `;
    correctOptions.insertAdjacentHTML('beforeend', correctCheckboxHtml);
    
    const newCb = correctOptions.querySelector(`.correct-checkbox[value="${newLetter}"]`);
    if (newCb) {
        newCb.addEventListener('change', () => markDirty());
    }
    
    markDirty();
}

function removeAnswer(letter) {
    const answerRow = document.querySelector(`.answer-row[data-letter="${letter}"]`);
    if (answerRow) answerRow.remove();
    
    markDirty();
}

function toggleAccordion(header) {
    header.classList.toggle('open');
    const content = header.nextElementSibling;
    content.classList.toggle('open');
}

function validateId(originalId) {
    const newId = document.getElementById('field_id')?.value.trim();
    const idError = document.getElementById('idError');
    
    if (!newId) {
        idError.textContent = 'L\'ID non può essere vuoto';
        idError.style.display = 'block';
        return false;
    }
    
    if (newId !== originalId && questions.some(q => q.id === newId)) {
        idError.textContent = `L'ID "${newId}" esiste già. Usa un ID univoco.`;
        idError.style.display = 'block';
        return false;
    }
    
    idError.style.display = 'none';
    return true;
}

function collectFormData(originalId = null) {
    if (!validateId(originalId)) return null;
    
    const newId = document.getElementById('field_id')?.value.trim();
    const raw_text = document.getElementById('field_raw_text')?.value || '';
    const primary_domain = document.getElementById('field_primary_domain')?.value || '';
    const subdomain = document.getElementById('field_subdomain')?.value || '';
    const notes = document.getElementById('field_notes')?.value || '';
    
    // Collect answers
    const answers = {};
    const answerInputs = document.querySelectorAll('.answer-input');
    answerInputs.forEach(inp => {
        const letter = inp.getAttribute('data-letter');
        if (letter) answers[letter] = inp.value;
    });
    
    // Collect correct from modern answer checkboxes
    const correct = [];
    const checkboxes = document.querySelectorAll('.answer-check-modern');
    checkboxes.forEach(cb => {
        const letter = cb.getAttribute('data-letter');
        const answerInput = document.querySelector(`.answer-input[data-letter="${letter}"]`);
        // Only add to correct if checkbox is checked AND answer is not empty
        if (cb.checked && letter && answerInput && answerInput.value.trim()) {
            correct.push(letter);
        }
    });
    if (correct.length === 0) correct.push("null");
    
    // Preserve original data for fields not in form
    const originalQuestion = questions.find(q => q.id === originalId);
    const mergedQuestion = { ...originalQuestion };
    
    mergedQuestion.id = newId;
    mergedQuestion.raw_text = raw_text;
    mergedQuestion.primary_domain = primary_domain;
    mergedQuestion.subdomain = subdomain;
    mergedQuestion.answers = answers;
    mergedQuestion.correct = correct;
    mergedQuestion.notes = notes;
    
    return mergedQuestion;
}

async function saveCurrentQuestion(existingId, showStatus = false) {
    if (saveInProgress) return;

    const updatedData = collectFormData(existingId);
    if (!updatedData) return;

    saveInProgress = true;

    if (showStatus) {
        setStatus('Salvataggio...');
    }

    const index = questions.findIndex(q => q.id === existingId);
    if (index !== -1) {
        questions[index] = updatedData;
        renderQuestionList();

        // Update the selected ID if it changed
        if (updatedData.id !== existingId) {
            selectedId = updatedData.id;
        }

        // Save to server
        try {
            const response = await fetch(`${API_BASE_URL}/questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(questions)
            });

            if (!response.ok) throw new Error('Salvataggio fallito');

            const result = await response.json();
            if (result.categories) {
                categories = normalizeCategoriesData(result.categories);
                createFilterUI(); // This now preserves filter values
            }
            const warningShown = notifyCategoryNormalizationWarning(result.warnings);

            if (showStatus && !warningShown) {
                setStatus('Salvato!');
                setTimeout(() => {
                    if (!isDirty) setStatus('Pronto');
                }, 1000);
            }

            clearDirty();
        } catch (err) {
            console.error(err);
            if (showStatus) {
                setStatus('Errore salvataggio', true);
            }
        } finally {
            saveInProgress = false;
        }
    } else {
        saveInProgress = false;
        if (showStatus) {
            setStatus('Errore: domanda non trovata', true);
        }
    }
}

async function deleteQuestionById(id) {
    if (!confirm(`Eliminare definitivamente la domanda ${id}?`)) return;

    const index = questions.findIndex(q => q.id === id);
    if (index !== -1) {
        // Rimuovi dalla selezione multipla se presente
        selectedQuestionIds.delete(id);

        // Save current filter state
        const currentFilters = {
            search: searchInput?.value || '',
            primaryDomain: primaryDomainFilter?.value || '',
            subdomain: subdomainFilter?.value || '',
            noAnswers: filterNoAnswers?.checked || false,
            withAnswers: filterWithAnswers?.checked || false,
            noCorrect: filterNoCorrect?.checked || false,
            showDuplicates: showDuplicatesOnly
        };

        // Determine next question to select
        const filtered = filterQuestions(questions);
        const currentIndex = filtered.findIndex(q => q.id === id);
        let nextId = null;

        if (filtered.length > 1) {
            // Try to select next question, or previous if at the end
            if (currentIndex < filtered.length - 1) {
                nextId = filtered[currentIndex + 1].id;
            } else if (currentIndex > 0) {
                nextId = filtered[currentIndex - 1].id;
            }
        }

        questions.splice(index, 1);

        // Restore filters and select next question
        if (nextId) {
            selectedId = nextId;
        } else {
            selectedId = null;
            formContentDiv.innerHTML = `<div style="text-align:center; padding:40px;">Nessuna domanda. Crea una nuova domanda.</div>`;
        }

        // Restore filter values
        if (searchInput) searchInput.value = currentFilters.search;
        if (primaryDomainFilter) primaryDomainFilter.value = currentFilters.primaryDomain;
        refreshFilterSubdomainOptions(currentFilters.subdomain);
        if (filterNoAnswers) filterNoAnswers.checked = currentFilters.noAnswers;
        if (filterWithAnswers) filterWithAnswers.checked = currentFilters.withAnswers;
        if (filterNoCorrect) filterNoCorrect.checked = currentFilters.noCorrect;
        showDuplicatesOnly = currentFilters.showDuplicates;

        renderQuestionList();
        if (nextId) renderFormForId(nextId);
        await saveAllToServer(false); // Don't refresh filters
        setStatus(`Eliminata "${id}" con successo`);
    }
}

async function duplicateQuestion(id) {
    const original = questions.find(q => q.id === id);
    if (!original) return;

    // Save current filter state
    const currentFilters = {
        search: searchInput?.value || '',
        primaryDomain: primaryDomainFilter?.value || '',
        subdomain: subdomainFilter?.value || '',
        noAnswers: filterNoAnswers?.checked || false,
        withAnswers: filterWithAnswers?.checked || false,
        noCorrect: filterNoCorrect?.checked || false,
        showDuplicates: showDuplicatesOnly
    };

    let baseId = original.id;
    let newId = `${baseId}_copy`;
    let counter = 1;
    while (questions.some(q => q.id === newId)) {
        newId = `${baseId}_copy${counter++}`;
    }

    const duplicated = JSON.parse(JSON.stringify(original));
    duplicated.id = newId;
    duplicated.duplicate_count = 0;
    duplicated.duplicate_ids = [];
    duplicated.duplicate_texts = [];
    duplicated.is_master = false;

    questions.push(duplicated);

    // Restore filters
    if (searchInput) searchInput.value = currentFilters.search;
    if (primaryDomainFilter) primaryDomainFilter.value = currentFilters.primaryDomain;
    refreshFilterSubdomainOptions(currentFilters.subdomain);
    if (filterNoAnswers) filterNoAnswers.checked = currentFilters.noAnswers;
    if (filterWithAnswers) filterWithAnswers.checked = currentFilters.withAnswers;
    if (filterNoCorrect) filterNoCorrect.checked = currentFilters.noCorrect;
    showDuplicatesOnly = currentFilters.showDuplicates;

    renderQuestionList();
    selectQuestion(newId);
    await saveAllToServer(false); // Don't refresh filters
    setStatus(`Duplicata come "${newId}"`);
}

async function saveAllToServer(refreshFilters = true) {
    try {
        setStatus('Salvataggio in corso...');
        const response = await fetch(`${API_BASE_URL}/questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(questions)
        });
        if (!response.ok) throw new Error('Salvataggio fallito');
        const result = await response.json();
        if (result.categories && refreshFilters) {
            categories = normalizeCategoriesData(result.categories);
            createFilterUI(); // Refresh filter UI only if needed
        }
        const warningShown = notifyCategoryNormalizationWarning(result.warnings);
        if (!warningShown) {
            setStatus(result.message || 'Tutte le modifiche sono state salvate con successo!');
        }
        clearDirty();
    } catch (err) {
        console.error(err);
        setStatus('Errore nel salvataggio sul server', true);
    }
}

async function createNewQuestion() {
    let maxNum = 0;
    const idPattern = /^Q(\d+)$/;
    questions.forEach(q => {
        const match = q.id.match(idPattern);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    });
    const newId = `Q${maxNum + 1}`;
    
    const newQuestion = {
        id: newId,
        raw_text: "Nuova domanda",
        normalized_text: "",
        primary_domain: categories.primary_domains[0] || DEFAULT_PRIMARY_DOMAIN,
        subdomain: getSubdomainsForPrimary(categories.primary_domains[0] || DEFAULT_PRIMARY_DOMAIN)[0] || DEFAULT_SUBDOMAIN,
        question_type: "",
        answers: { A: "" },
        correct: ["null"],
        notes: "",
        embedding_vector: "",
        cluster_id: "",
        cluster_label: "",
        confidence_score: "",
        classification_validated: false,
        status: "active",
        is_master: false,
        is_active: true,
        duplicate_count: 0,
        duplicate_ids: [],
        duplicate_texts: [],
        duplicate_similarities: [],
        duplicate_reasons: [],
        all_answers_versions: [],
        merge_metadata: {}
    };
    
    questions.push(newQuestion);
    renderQuestionList();
    selectQuestion(newId);
    await saveAllToServer();
    setStatus(`Nuova domanda "${newId}" aggiunta`);
}

// Updated showStats function
async function showStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/stats`);
        if (!response.ok) throw new Error('Recupero statistiche fallito');
        const stats = await response.json();
        
        const modal = document.getElementById('statsModal');
        const content = document.getElementById('statsContent');
        
        // Sort categories
        const primaryDomainsSorted = Object.entries(stats.primary_domain_count).sort((a, b) => b[1] - a[1]);
        const subdomainsSorted = Object.entries(stats.subdomain_count).sort((a, b) => b[1] - a[1]);
        
        // Calculate percentages for progress bars
        const total = stats.total_questions || 1;
        const percentageOneAnswer = total > 0 ? ((stats.questions_with_one_answer / total) * 100).toFixed(1) : 0;
        const percentageNoAnswers = total > 0 ? ((stats.questions_with_no_answers / total) * 100).toFixed(1) : 0;
        const percentageNoCorrect = total > 0 ? ((stats.questions_with_no_correct / total) * 100).toFixed(1) : 0;
        const percentageDuplicates = total > 0 ? ((stats.total_duplicates / total) * 100).toFixed(1) : 0;
        const percentageFlagged = total > 0 ? ((stats.questions_flagged / total) * 100).toFixed(1) : 0;
        
        // Generate random colors for categories (consistent for each domain)
        const categoryColors = [
            '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', 
            '#ef4444', '#ec489a', '#06b6d4', '#84cc16'
        ];
        
        content.innerHTML = `
            <!-- Card Panoramica -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon">📋</div>
                    <div class="stat-value">${stats.total_questions}</div>
                    <div class="stat-label">Totale Domande</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">🚩</div>
                    <div class="stat-value">${stats.questions_flagged}</div>
                    <div class="stat-label">
                        Domande Flaggate
                        ${percentageFlagged > 0 ? `<span class="warning-badge">⚠️ ${percentageFlagged}%</span>` : ''}
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">🔄</div>
                    <div class="stat-value">${stats.total_duplicates}</div>
                    <div class="stat-label">
                        Domande con Duplicati
                        ${percentageDuplicates > 0 ? `<span class="warning-badge">⚠️ ${percentageDuplicates}%</span>` : ''}
                    </div>
                </div>
            </div>

            <!-- Statistiche Risposte -->
            <div class="stats-section">
                <h3 class="section-title">📝 Statistiche Risposte</h3>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon">✏️</div>
                        <div class="stat-value">${stats.questions_with_one_answer}</div>
                        <div class="stat-label">Una sola risposta</div>
                        <div class="progress-bar-container">
                            <div class="progress-bar" style="width: ${percentageOneAnswer}%"></div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">❌</div>
                        <div class="stat-value">${stats.questions_with_no_answers}</div>
                        <div class="stat-label">Senza risposte</div>
                        <div class="progress-bar-container">
                            <div class="progress-bar" style="width: ${percentageNoAnswers}%"></div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">⚠️</div>
                        <div class="stat-value">${stats.questions_with_no_correct}</div>
                        <div class="stat-label">Senza risposta corretta</div>
                        <div class="progress-bar-container">
                            <div class="progress-bar" style="width: ${percentageNoCorrect}%"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Distribuzione per Dominio -->
            <div class="stats-section">
                <h3 class="section-title">🏷️ Distribuzione per Dominio Principale</h3>
                <div class="distribution-list">
                    ${primaryDomainsSorted.map(([domain, count], index) => `
                        <div class="distribution-item">
                            <span class="category-name">
                                <span class="category-badge" style="background: ${categoryColors[index % categoryColors.length]};"></span>
                                ${escapeHtml(domain)}
                            </span>
                            <span class="category-count">${count}</span>
                        </div>
                    `).join('')}
                </div>
                ${primaryDomainsSorted.length === 0 ? '<p style="color:#94a3b8; text-align:center; padding: 20px;">Nessun dato disponibile</p>' : ''}
            </div>

            <!-- Distribuzione per Sottodominio -->
            <div class="stats-section">
                <h3 class="section-title">📂 Distribuzione per Sottodominio</h3>
                <div class="distribution-list">
                    ${subdomainsSorted.map(([sub, count], index) => `
                        <div class="distribution-item">
                            <span class="category-name">
                                <span class="category-badge" style="background: ${categoryColors[(index + 3) % categoryColors.length]};"></span>
                                ${escapeHtml(sub)}
                            </span>
                            <span class="category-count">${count}</span>
                        </div>
                    `).join('')}
                </div>
                ${subdomainsSorted.length === 0 ? '<p style="color:#94a3b8; text-align:center; padding: 20px;">Nessun dato disponibile</p>' : ''}
            </div>
        `;
        modal.classList.add('show');
    } catch (err) {
        console.error(err);
        setStatus('Errore nel caricamento statistiche', true);
    }
}

// Backup selection state
let selectedBackups = new Set();

async function showBackups() {
    try {
        const response = await fetch(`${API_BASE_URL}/backups`);
        if (!response.ok) throw new Error('Recupero backup fallito');
        const data = await response.json();

        const modal = document.getElementById('backupModal');
        const content = document.getElementById('backupContent');
        const actionsDiv = document.getElementById('backupActions');

        selectedBackups.clear();
        updateBackupSelectionUI();

        if (data.backups.length === 0) {
            content.innerHTML = '<p style="color: var(--text-secondary); padding: 20px 0; text-align: center;">Nessun backup disponibile.</p>';
            actionsDiv.style.display = 'none';
        } else {
            content.innerHTML = `
                <ul style="list-style: none; padding: 0; margin: 0;">
                    ${data.backups.map(backup => `
                        <li style="padding: 12px 0; border-bottom: 1px solid var(--border-light, #e2e8f0); display: flex; align-items: center; gap: 10px;">
                            <input type="checkbox" class="backup-checkbox" data-name="${backup.name}" style="width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent-blue);">
                            <div style="flex: 1; min-width: 0;">
                                <strong style="font-size: 13px;">${backup.name}</strong><br>
                                <small style="color: var(--text-secondary); font-size: 0.8rem;">${(backup.size / 1024).toFixed(1)} KB · ${new Date(backup.modified).toLocaleString()}</small>
                            </div>
                            <button class="btn-restore" data-name="${backup.name}" style="padding: 6px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: transparent; cursor: pointer; font-size: 12px; font-family: inherit; color: var(--accent-blue); transition: all 0.2s; white-space: nowrap;">Ripristina</button>
                            <button class="btn-delete-backup" data-name="${backup.name}" style="padding: 6px 12px; border: 1px solid rgba(220,38,38,0.3); border-radius: 8px; background: transparent; cursor: pointer; font-size: 12px; font-family: inherit; color: #dc2626; transition: all 0.2s; white-space: nowrap;">Elimina</button>
                        </li>
                    `).join('')}
                </ul>
            `;
            actionsDiv.style.display = 'flex';

            document.querySelectorAll('.backup-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const name = e.target.getAttribute('data-name');
                    toggleBackupSelection(name);
                });
            });

            document.querySelectorAll('.btn-restore').forEach(btn => {
                btn.addEventListener('click', () => window.restoreBackup(btn.getAttribute('data-name')));
                btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--bg-tertiary)'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
            });

            document.querySelectorAll('.btn-delete-backup').forEach(btn => {
                btn.addEventListener('click', () => deleteSingleBackup(btn.getAttribute('data-name')));
                btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(220,38,38,0.08)'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
            });

            // Select all button handler
            const selectAllBtn = document.getElementById('btnSelectAllBackups');
            if (selectAllBtn) {
                selectAllBtn.addEventListener('click', () => {
                    const allCheckboxes = document.querySelectorAll('.backup-checkbox');
                    const allSelected = selectedBackups.size === allCheckboxes.length;

                    if (allSelected) {
                        selectedBackups.clear();
                        allCheckboxes.forEach(cb => { cb.checked = false; });
                    } else {
                        allCheckboxes.forEach(cb => {
                            cb.checked = true;
                            selectedBackups.add(cb.getAttribute('data-name'));
                        });
                    }
                    updateBackupSelectionUI();
                });

                selectAllBtn.addEventListener('mouseenter', () => {
                    selectAllBtn.style.background = 'var(--bg-tertiary, #f1f5f9)';
                });
                selectAllBtn.addEventListener('mouseleave', () => {
                    selectAllBtn.style.background = 'transparent';
                });
            }
        }
        modal.classList.add('show');
    } catch (err) {
        console.error(err);
        setStatus('Errore nel caricamento dei backup', true);
    }
}

async function deleteSingleBackup(backupName) {
    if (!confirm(`Eliminare il backup "${backupName}"?`)) return;
    try {
        const response = await fetch(`${API_BASE_URL}/backups`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backups: [backupName] })
        });
        if (!response.ok) throw new Error('Cancellazione backup fallita');
        const result = await response.json();
        setStatus(result.message);
        showBackups();
    } catch (err) {
        console.error(err);
        setStatus('Errore nella cancellazione del backup', true);
    }
}

function toggleBackupSelection(name) {
    if (selectedBackups.has(name)) {
        selectedBackups.delete(name);
    } else {
        selectedBackups.add(name);
    }
    updateBackupSelectionUI();
}

function updateBackupSelectionUI() {
    const count = selectedBackups.size;
    const countSpan = document.getElementById('selectedBackupsCount');
    const deleteBtn = document.getElementById('btnDeleteSelectedBackups');
    const selectAllBtn = document.getElementById('btnSelectAllBackups');

    if (countSpan) {
        countSpan.textContent = `${count} selezionati`;
    }
    if (deleteBtn) {
        deleteBtn.disabled = count === 0;
        deleteBtn.style.opacity = count === 0 ? '0.5' : '1';
    }
    if (selectAllBtn) {
        const allCheckboxes = document.querySelectorAll('.backup-checkbox');
        const allSelected = allCheckboxes.length > 0 && allCheckboxes.length === count;
        selectAllBtn.textContent = allSelected ? 'Deseleziona tutti' : 'Seleziona tutti';
    }
}

async function deleteSelectedBackups() {
    const count = selectedBackups.size;
    if (count === 0) return;

    if (!confirm(`Eliminare ${count} backup selezionati?`)) return;

    try {
        const response = await fetch(`${API_BASE_URL}/backups`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backups: Array.from(selectedBackups) })
        });

        if (!response.ok) throw new Error('Cancellazione backup fallita');

        const result = await response.json();
        setStatus(result.message);
        
        // Refresh backup list
        showBackups();
    } catch (err) {
        console.error(err);
        setStatus('Errore nella cancellazione dei backup', true);
    }
}

function selectAllBackups() {
    const selectAllCb = document.getElementById('selectAllBackups');
    const isChecked = selectAllCb.checked;
    const allCheckboxes = document.querySelectorAll('.backup-checkbox');
    
    allCheckboxes.forEach(cb => {
        cb.checked = isChecked;
        const name = cb.getAttribute('data-name');
        if (isChecked) {
            selectedBackups.add(name);
        } else {
            selectedBackups.delete(name);
        }
    });
    
    updateBackupSelectionUI();
}

async function restoreBackup(backupName) {
    if (!confirm(`Ripristinare da ${backupName}? Il database corrente verrà salvato in un backup prima di procedere.`)) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/backups/${backupName}`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Ripristino fallito');
        const result = await response.json();
        setStatus(result.message);
        await loadQuestions();
        document.getElementById('backupModal').style.display = 'none';
    } catch (err) {
        console.error(err);
        setStatus('Errore nel ripristino del backup', true);
    }
}

async function showCategoriesModal() {
    try {
        await refreshCategoriesFromServer();
    } catch (err) {
        console.error('Errore nell\'aggiornamento delle categorie:', err);
    }

    if (!categories.primary_domains.includes(categoriesModalPrimaryContext)) {
        categoriesModalPrimaryContext = categories.primary_domains[0] || DEFAULT_PRIMARY_DOMAIN;
    }

    const subdomainsForContext = getSubdomainsForPrimary(categoriesModalPrimaryContext);

    const modal = document.getElementById('categoriesModal');
    const content = document.getElementById('categoriesContent');
    const mergeContent = document.getElementById('cmMergeContent');
    const healthContent = document.getElementById('cmHealthContent');

    // Tab 1: Manage - Tree + Detail UI
    // Don't reset state if already opened (preserve expanded/selection)
    if (!window._cmTreeStateInitialized) {
        CategoriesManager.resetTreeState();
        window._cmTreeStateInitialized = true;
    }

    // Ensure manage tab is active
    content.classList.add('active');
    mergeContent.classList.remove('active');
    healthContent.classList.remove('active');

    // Ensure manage tab button is active
    document.querySelectorAll('.cm-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === 'manage');
    });

    const treeHtml = CategoriesManager.renderManageTree(categories, questions);
    content.innerHTML = treeHtml;

    // Show modal AFTER inserting content
    modal.classList.add('show');

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
        const refreshManageTab = async () => {
            // 1. Salva stato PRIMA di qualsiasi modifica
            const ts = CategoriesManager.getTreeState();
            const expandedBefore = new Set(ts.expandedPrimaries);
            const selectedBefore = ts.selectedNode ? { ...ts.selectedNode } : null;

            // 2. Fetch dati freschi
            await refreshCategoriesFromServer();
            await loadQuestions();

            // 3. Reset stato
            CategoriesManager.resetTreeState();

            // 4. Ripristina stato salvato
            const newTs = CategoriesManager.getTreeState();
            expandedBefore.forEach(p => newTs.expandedPrimaries.add(p));
            if (selectedBefore) newTs.selectedNode = selectedBefore;

            // 5. Renderizza UNA sola volta con stato ripristinato
            content.innerHTML = CategoriesManager.renderManageTree(categories, questions);
            CategoriesManager.attachTreeHandlers(categories, refreshManageTab);
        };

        CategoriesManager.attachTreeHandlers(categories, refreshManageTab);
    });

    // Tab 2: Merge wizard
    mergeContent.innerHTML = CategoriesManager.renderMergeWizard(categories);
    CategoriesManager.attachMergeWizardHandlers(async (result) => {
        await refreshCategoriesFromServer();
        await loadQuestions();
        showCategoriesModal();
        setStatus(`Merge completato: ${result.updated_questions} domande aggiornate`);
    }, categories);

    // Tab 3: Health dashboard
    try {
        const health = await CategoriesManager.fetchHealth();
        healthContent.innerHTML = CategoriesManager.renderHealthDashboard(health);
    } catch (err) {
        healthContent.innerHTML = `<p style="color: #c44536; text-align: center;">Errore nel caricamento health: ${escapeHtml(err.message)}</p>`;
    }

    modal.classList.add('show');
}

// Tab switching
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('cm-tab-btn')) {
        const tabName = e.target.dataset.tab;
        const content = document.getElementById('categoriesContent');
        const mergeContent = document.getElementById('cmMergeContent');
        const healthContent = document.getElementById('cmHealthContent');

        // Update active button
        document.querySelectorAll('.cm-tab-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        
        // Update active content
        document.querySelectorAll('.cm-tab-content').forEach(content => content.classList.remove('active'));
        
        let targetId;
        if (tabName === 'manage') {
            targetId = 'categoriesContent';
        } else if (tabName === 'merge') {
            targetId = 'cmMergeContent';
        } else if (tabName === 'health') {
            targetId = 'cmHealthContent';
        }
        
        const targetContent = document.getElementById(targetId);
        if (targetContent) {
            targetContent.classList.add('active');
        }

        // Refresh content if needed
        if (tabName === 'health') {
            CategoriesManager.fetchHealth().then(health => {
                document.getElementById('cmHealthContent').innerHTML = CategoriesManager.renderHealthDashboard(health);
            }).catch(err => {
                document.getElementById('cmHealthContent').innerHTML = `<p style="color: #c44536;">Errore: ${escapeHtml(err.message)}</p>`;
            });
        } else if (tabName === 'merge') {
            mergeContent.innerHTML = CategoriesManager.renderMergeWizard(categories);
            CategoriesManager.attachMergeWizardHandlers(async (result) => {
                await refreshCategoriesFromServer();
                await loadQuestions();
                showCategoriesModal();
                setStatus(`Merge completato: ${result.updated_questions} domande aggiornate`);
            }, categories);
        } else if (tabName === 'manage') {
            window._cmTreeStateInitialized = false;
            (async () => {
                await refreshCategoriesFromServer();
                await loadQuestions();
                CategoriesManager.resetTreeState();
                content.innerHTML = CategoriesManager.renderManageTree(categories, questions);
                const refreshManageTab = async () => {
                    const ts = CategoriesManager.getTreeState();
                    const expandedBefore = new Set(ts.expandedPrimaries);
                    const selectedBefore = ts.selectedNode ? { ...ts.selectedNode } : null;

                    await refreshCategoriesFromServer();
                    await loadQuestions();

                    CategoriesManager.resetTreeState();

                    const newTs = CategoriesManager.getTreeState();
                    expandedBefore.forEach(p => newTs.expandedPrimaries.add(p));
                    if (selectedBefore) newTs.selectedNode = selectedBefore;

                    content.innerHTML = CategoriesManager.renderManageTree(categories, questions);
                    CategoriesManager.attachTreeHandlers(categories, refreshManageTab);
                };
                CategoriesManager.attachTreeHandlers(categories, refreshManageTab);
            })();
        }
    }
});

async function addCategory(type) {
    const input = document.getElementById(type === 'primary_domain' ? 'newPrimaryDomain' : 'newSubdomain');
    const value = input.value.trim();
    if (!value) {
        setStatus('Inserisci un nome per la categoria', true);
        return;
    }

        setStatus(`Aggiunta categoria "${value}"...`);
    
    try {
        const primaryContext = (document.getElementById('modalPrimaryContext')?.value || categoriesModalPrimaryContext || '').trim();
        const response = await fetch(`${API_BASE_URL}/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'add',
                type: type,
                value: value,
                ...(type === 'subdomain' ? { primary_domain: primaryContext } : {})
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Aggiunta categoria fallita');
        }
        
        const result = await response.json();
        categories = normalizeCategoriesData(result.categories);
        input.value = '';
        if (type === 'subdomain' && primaryContext) {
            categoriesModalPrimaryContext = primaryContext;
        }
        
        // Refresh the modal to show new categories
        showCategoriesModal();
        refreshCurrentFormCategorySelects();
        
        setStatus(`Categoria "${value}" aggiunta con successo!`);
    } catch (err) {
        console.error(err);
        setStatus(err.message || 'Errore nell\'aggiunta della categoria', true);
    }
}

async function removeCategory(type, value, primaryDomain = '') {
    if (!confirm(`Rimuovere la categoria "${value}"? Le domande che la utilizzano verranno impostate su "indefinito".`)) return;
    
    setStatus(`Rimozione categoria "${value}"...`);
    
    try {
        const response = await fetch(`${API_BASE_URL}/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'remove',
                type: type,
                value: value,
                ...(type === 'subdomain' ? { primary_domain: primaryDomain || categoriesModalPrimaryContext } : {})
            })
        });
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Rimozione categoria fallita');
        }
        
        const result = await response.json();
        categories = normalizeCategoriesData(result.categories);
        
        // Refresh the modal
        showCategoriesModal();
        
        // Reload questions to update any affected questions
        await loadQuestions();
        
        setStatus(`Categoria "${value}" rimossa`);
    } catch (err) {
        console.error(err);
        setStatus(err.message || 'Errore nella rimozione della categoria', true);
    }
}

async function renameCategory(type, oldValue, primaryDomain = '') {
    const typeName = type === 'primary_domain' ? 'dominio principale' : 'sottodominio';
    const newValue = prompt(`Inserisci il nuovo nome per "${oldValue}":`, oldValue);
    
    if (!newValue || newValue.trim() === '') return;
    
    const trimmedValue = newValue.trim();
    
    if (trimmedValue === oldValue) {
        setStatus('Il nome non è cambiato', true);
        return;
    }
    
    setStatus(`Rinomina categoria "${oldValue}" in "${trimmedValue}"...`);
    
    try {
        const response = await fetch(`${API_BASE_URL}/categories/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: type,
                old_value: oldValue,
                new_value: trimmedValue,
                ...(type === 'subdomain' ? { primary_domain: primaryDomain || categoriesModalPrimaryContext } : {})
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Rinomina categoria fallita');
        }
        
        const result = await response.json();
        categories = normalizeCategoriesData(result.categories);
        
        // Refresh the modal
        showCategoriesModal();
        
        // Reload questions to update any affected questions
        await loadQuestions();
        
        setStatus(`Categoria "${oldValue}" rinominata in "${trimmedValue}". ${result.updated_questions} domande aggiornate.`);
    } catch (err) {
        console.error(err);
        setStatus(err.message || 'Errore nella rinomina della categoria', true);
    }
}

function updateToggleDuplicatesBtn() {
    if (toggleDuplicatesBtn) {
        if (showDuplicatesOnly) {
            toggleDuplicatesBtn.classList.add('active');
            toggleDuplicatesBtn.textContent = 'Mostra tutti';
        } else {
            toggleDuplicatesBtn.classList.remove('active');
            toggleDuplicatesBtn.textContent = 'Mostra duplicati';
        }
    }
}

function toggleShowDuplicates() {
    showDuplicatesOnly = !showDuplicatesOnly;
    if (showDuplicatesOnly) {
        toggleDuplicatesBtn?.classList.add('active');
        toggleDuplicatesBtn.textContent = 'Mostra tutti';
    } else {
        toggleDuplicatesBtn?.classList.remove('active');
        toggleDuplicatesBtn.textContent = 'Mostra duplicati';
    }
    renderQuestionList();
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Navigation functions
function getCurrentQuestionIndex() {
    const filtered = filterQuestions(questions);
    return filtered.findIndex(q => q.id === selectedId);
}

function navigateToPrevious() {
    const filtered = filterQuestions(questions);
    const currentIndex = getCurrentQuestionIndex();
    if (currentIndex > 0) {
        selectQuestion(filtered[currentIndex - 1].id);
        setStatus(`Domanda ${currentIndex + 1} di ${filtered.length}`);
    }
}

function navigateToNext() {
    const filtered = filterQuestions(questions);
    const currentIndex = getCurrentQuestionIndex();
    if (currentIndex < filtered.length - 1) {
        selectQuestion(filtered[currentIndex + 1].id);
        setStatus(`Domanda ${currentIndex + 2} di ${filtered.length}`);
    }
}

// Make functions global for modal buttons
window.toggleAccordion = toggleAccordion;
window.restoreBackup = restoreBackup;
window.deleteSingleBackup = deleteSingleBackup;
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.renameCategory = renameCategory;

// Event listeners
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        searchInput.addEventListener('input', () => renderQuestionList());
        document.getElementById('btnCategories').addEventListener('click', showCategoriesModal);
        document.getElementById('btnReload').addEventListener('click', async () => {
            if (isDirty) {
                const confirmed = confirm('Ci sono modifiche non salvate. Procedere con la ricarica?');
                if (!confirmed) return;
            }
            await loadQuestions();
        });
        document.getElementById('btnStats').addEventListener('click', showStats);
        document.getElementById('btnBackup')?.addEventListener('click', showBackups);
        document.getElementById('btnBackupSidebar')?.addEventListener('click', showBackups);
    });
}

// Settings dropdown toggle
const btnSettings = document.getElementById('btnSettings');
const dropdownMenu = btnSettings?.nextElementSibling;

if (btnSettings && dropdownMenu) {
    btnSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('active');
    });

    // Chiudi quando si clicca fuori
    document.addEventListener('click', (e) => {
        if (!btnSettings.contains(e.target) && !dropdownMenu.contains(e.target)) {
            dropdownMenu.classList.remove('active');
        }
    });
    
    // Chiudi il menu quando si clicca sui pulsanti interni
    dropdownMenu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.remove('active');
        });
    });
}
if (toggleDuplicatesBtn) {
    toggleDuplicatesBtn.addEventListener('click', toggleShowDuplicates);
}

// Backup actions
document.getElementById('btnDeleteSelectedBackups')?.addEventListener('click', deleteSelectedBackups);

// Panel collapse toggles
document.getElementById('toggleFilters')?.addEventListener('click', () => {
    const panel = document.getElementById('filtersPanel');
    panel?.classList.toggle('collapsed');
});

document.getElementById('toggleQuestions')?.addEventListener('click', () => {
    const panel = document.getElementById('questionsPanel');
    panel?.classList.toggle('collapsed');
});

// Help button functionality
const helpModal = document.getElementById('helpModal');
const helpClose = helpModal?.querySelector('.close-modal');

['btnHelp', 'btnHelpSidebar'].forEach(btnId => {
    const btn = document.getElementById(btnId);
    if (btn && helpModal) {
        btn.addEventListener('click', function() {
            helpModal.classList.add('show');
        });
    }
});

if (helpClose) {
    helpClose.addEventListener('click', function() {
        helpModal.classList.remove('show');
    });
}

// Modal close handlers
function setupModalCloseHandlers() {
    document.querySelectorAll('.modal .close, .modal .close-modal').forEach(close => {
        close.addEventListener('click', function() {
            this.closest('.modal').classList.remove('show');
        });
    });
}

setupModalCloseHandlers();

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('show');
    }
};

// Add keyboard navigation
document.addEventListener('keydown', function(event) {
    // Check if focus is not on an input or textarea
    const activeElement = document.activeElement;
    const isInputFocused = activeElement.tagName === 'INPUT' || 
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

// Check for URL parameter and select question
function checkUrlParameter() {
    const urlParams = new URLSearchParams(window.location.search);
    const questionId = urlParams.get('id');
    if (questionId) {
        // Wait for questions to load, then select the question
        const checkInterval = setInterval(() => {
            if (questions.length > 0) {
                clearInterval(checkInterval);
                const question = questions.find(q => q.id === questionId);
                if (question) {
                    selectQuestion(questionId);
                    setStatus(`Domanda ${questionId} caricata dalla modalità visualizzazione`);
                } else {
                    setStatus(`Domanda ${questionId} non trovata`, true);
                }
            }
        }, 100);
    }
}

// Initial load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        loadQuestions();
        checkUrlParameter();
        // Update theme icons on initial load
        updateThemeIcons();
    });
} else {
    loadQuestions();
    checkUrlParameter();
    updateThemeIcons();
}

function updateThemeIcons() {
    const moonIcon = document.querySelector('.theme-icon-moon');
    const sunIcon = document.querySelector('.theme-icon-sun');
    if (moonIcon && sunIcon) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        moonIcon.style.display = isDark ? 'block' : 'none';
        sunIcon.style.display = isDark ? 'none' : 'block';
    }
}

// Listen for theme changes to update icons
document.addEventListener('themeChanged', updateThemeIcons);
