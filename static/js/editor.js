// ---------- FRONTEND LOGIC ----------
const API_BASE_URL = '/api';

document.addEventListener('DOMContentLoaded', function() {
    const btnHome = document.getElementById('btnHome');
    if (btnHome) {
        btnHome.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
});

let questions = [];
let selectedId = null;
let categories = {
    primary_domains: [],
    subdomains: []
};
let autoSaveTimer = null;
let isDirty = false;
let saveInProgress = false;
let showDuplicatesOnly = false;

// Selezione multipla
let selectedQuestionIds = new Set(); // ID delle domande selezionate per azioni batch

// DOM elements
const questionsListDiv = document.getElementById('questionsList');
const formContentDiv = document.getElementById('formContent');
const statusSpan = document.getElementById('statusMsg');
const questionCountSpan = document.getElementById('questionCount');
const searchInput = document.getElementById('searchInput');
const autoSaveIndicator = document.getElementById('autoSaveIndicator');
const toggleDuplicatesBtn = document.getElementById('toggleDuplicatesBtn');

// Filter elements
let primaryDomainFilter = null;
let subdomainFilter = null;
let filterNoAnswers = null;
let filterWithAnswers = null;
let filterNoCorrect = null;

// Helper: show status message
let statusTimeout;
function setStatus(msg, isError = false) {
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

// Auto-save functionality - immediate save
function markDirty() {
    if (saveInProgress) return;
    
    isDirty = true;
    autoSaveIndicator.style.color = '#e67e22';
    autoSaveIndicator.textContent = '● Salvataggio...';
    
    // Save immediately
    saveCurrentQuestion(selectedId);
}

function clearDirty() {
    isDirty = false;
    autoSaveIndicator.style.color = '#27ae60';
    autoSaveIndicator.textContent = '● Auto';
}

// Fetch all questions
async function loadQuestions() {
    try {
        setStatus('Caricamento...');
        const response = await fetch(`${API_BASE_URL}/questions`);
        if (!response.ok) throw new Error('Recupero fallito');
        const data = await response.json();
        questions = data.questions;
        categories = data.categories;

        // Create filter UI
        createFilterUI();

        // Get answer filter elements
        filterNoAnswers = document.getElementById('filterNoAnswers');
        filterWithAnswers = document.getElementById('filterWithAnswers');
        filterNoCorrect = document.getElementById('filterNoCorrect');

        // Add event listeners for answer filters
        if (filterNoAnswers) filterNoAnswers.addEventListener('change', () => renderQuestionList());
        if (filterWithAnswers) filterWithAnswers.addEventListener('change', () => renderQuestionList());
        if (filterNoCorrect) filterNoCorrect.addEventListener('change', () => renderQuestionList());

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

        setStatus(`Caricate ${questions.length} domande`);
        clearDirty();
    } catch (err) {
        console.error(err);
        setStatus('Errore nel caricamento delle domande. Assicurati che il backend sia in esecuzione', true);
        questionsListDiv.innerHTML = `<div class="empty-list">Errore nel caricamento dei dati. Assicurati che il backend sia in esecuzione.</div>`;
    }
}

// Create filter UI with categories from server
function createFilterUI() {
    const searchBox = document.querySelector('.search-box');
    if (!searchBox) return;

    // Save current filter values before recreating
    const savedPrimaryDomain = primaryDomainFilter?.value || '';
    const savedSubdomain = subdomainFilter?.value || '';

    // Check if filter container already exists
    let filterContainer = document.getElementById('filterContainer');
    if (!filterContainer) {
        filterContainer = document.createElement('div');
        filterContainer.id = 'filterContainer';
        filterContainer.style.cssText = 'margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;';
        searchBox.appendChild(filterContainer);
    }

    filterContainer.innerHTML = `
        <select id="primaryDomainFilter" style="flex: 1; min-width: 150px;">
            <option value="">Tutti i Domini</option>
            ${categories.primary_domains.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
        </select>
        <select id="subdomainFilter" style="flex: 1; min-width: 150px;">
            <option value="">Tutti i Sottodomini</option>
            ${categories.subdomains.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
        </select>
        <button id="clearFiltersBtn" class="small-btn">Azzera Filtri</button>
        <button id="refreshCategoriesBtn" class="small-btn" style="background: #5a6e7a;">🔄 Aggiorna</button>
    `;

    primaryDomainFilter = document.getElementById('primaryDomainFilter');
    subdomainFilter = document.getElementById('subdomainFilter');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const refreshCategoriesBtn = document.getElementById('refreshCategoriesBtn');

    // Restore filter values
    if (primaryDomainFilter) {
        primaryDomainFilter.value = savedPrimaryDomain;
        primaryDomainFilter.addEventListener('change', () => renderQuestionList());
    }
    if (subdomainFilter) {
        subdomainFilter.value = savedSubdomain;
        subdomainFilter.addEventListener('change', () => renderQuestionList());
    }
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            if (primaryDomainFilter) primaryDomainFilter.value = '';
            if (subdomainFilter) subdomainFilter.value = '';
            renderQuestionList();
        });
    }
    if (refreshCategoriesBtn) {
        refreshCategoriesBtn.addEventListener('click', async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/categories`);
                if (response.ok) {
                    const categoriesData = await response.json();
                    categories.primary_domains = categoriesData.primary_domains;
                    categories.subdomains = categoriesData.subdomains;
                    createFilterUI();
                    // Also update the form if open
                    if (selectedId) {
                        renderFormForId(selectedId);
                    }
                    setStatus('Categorie aggiornate');
                }
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
    
    if (noAnswersChecked || withAnswersChecked || noCorrectChecked) {
        filtered = filtered.filter(q => {
            const answers = q.answers || {};
            const hasAnswers = Object.keys(answers).length > 0;
            const hasCorrect = (q.correct || []).length > 0;
            
            if (noAnswersChecked && !hasAnswers) return true;
            if (withAnswersChecked && hasAnswers) return true;
            if (noCorrectChecked && hasAnswers && !hasCorrect) return true;
            
            return false;
        });
    }
    
    // Show duplicates only filter
    if (showDuplicatesOnly) {
        filtered = filtered.filter(q => q.duplicate_count > 0);
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
        return `
            <div class="question-item ${selectedId === q.id ? 'selected' : ''} ${isSelected ? 'batch-selected' : ''} ${isDuplicate ? 'duplicate-item' : ''}" data-id="${q.id}">
                <div class="question-item-content" style="display: flex; gap: 8px; align-items: flex-start;">
                    <input type="checkbox" class="batch-select-checkbox" data-id="${q.id}" ${isSelected ? 'checked' : ''} style="margin-top: 3px; cursor: pointer;">
                    <div style="flex: 1; min-width: 0;">
                        <div class="question-id">
                            ${escapeHtml(q.id)}
                            ${isDuplicate ? `<span class="duplicate-badge">${q.duplicate_count} duplicati</span>` : ''}
                        </div>
                        <div class="question-preview">${escapeHtml(q.raw_text ? q.raw_text.substring(0, 80) : 'Nessun testo disponibile')}${q.raw_text?.length > 80 ? '...' : ''}</div>
                        <div class="question-meta" style="font-size: 0.7rem; color: #6c757d; margin-top: 4px;">
                            ${escapeHtml(q.primary_domain || 'nessun dominio')} / ${escapeHtml(q.subdomain || 'nessun sottodominio')}
                        </div>
                    </div>
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
    document.querySelectorAll('.question-item').forEach(el => {
        el.addEventListener('click', (e) => {
            // Se non è un click sulla checkbox, carica la domanda
            if (!e.target.classList.contains('batch-select-checkbox')) {
                const id = el.getAttribute('data-id');
                selectQuestion(id);
            }
        });
    });
}

function selectQuestion(id) {
    selectedId = id;
    renderQuestionList();
    renderFormForId(id);
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
    let batchActionsDiv = document.getElementById('batchActionsDiv');

    if (!batchActionsDiv) {
        // Crea i bottoni se non esistono
        const listHeader = document.querySelector('.list-header');
        if (listHeader) {
            const existingActions = listHeader.querySelector('#batchActionsDiv');
            if (!existingActions) {
                const div = document.createElement('div');
                div.id = 'batchActionsDiv';
                div.style.cssText = 'display: none; gap: 6px; margin-left: auto; align-items: center;';
                div.innerHTML = `
                    <span id="batchCountSpan" style="font-size: 0.7rem; color: #2c7da0; background: #e0f2fe; padding: 2px 8px; border-radius: 12px; white-space: nowrap;"></span>
                    <button id="btnBatchSelectAll" class="small-btn" style="background: #2c6e2f; flex: 1;">✓ Seleziona Tutte</button>
                    <button id="btnBatchDelete" class="small-btn" style="background: #c44536; flex: 1;">🗑️ Elimina</button>
                    <button id="btnBatchCategory" class="small-btn" style="background: #2c7da0; flex: 1;">🏷️ Categoria</button>
                    <button id="btnBatchClear" class="small-btn" style="background: #6c757d; flex: 1;">✕ Deseleziona</button>
                `;
                listHeader.appendChild(div);
                batchActionsDiv = div;

                // Aggiungi event listener
                document.getElementById('btnBatchSelectAll')?.addEventListener('click', selectAllVisibleQuestions);
                document.getElementById('btnBatchDelete')?.addEventListener('click', batchDeleteQuestions);
                document.getElementById('btnBatchCategory')?.addEventListener('click', batchChangeCategory);
                document.getElementById('btnBatchClear')?.addEventListener('click', clearBatchSelection);
            }
        }
    }

    // Mostra/nascondi e aggiorna contatore
    if (count > 0) {
        if (batchActionsDiv) {
            batchActionsDiv.style.display = 'flex';
            const countSpan = document.getElementById('batchCountSpan');
            if (countSpan) {
                countSpan.textContent = `${count} selez.`;
            }
        }
    } else {
        if (batchActionsDiv) batchActionsDiv.style.display = 'none';
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
    if (subdomainFilter) subdomainFilter.value = currentFilters.subdomain;
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

    // Crea un modal per selezionare le nuove categorie
    const modal = document.createElement('div');
    modal.id = 'batchCategoryModal';
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <span class="close" onclick="document.getElementById('batchCategoryModal').style.display='none'">&times;</span>
            <h3>🏷️ Cambia Categoria a ${count} domande</h3>
            <div style="margin: 20px 0;">
                <div class="form-group">
                    <label>Nuovo Dominio Principale</label>
                    <select id="batchPrimaryDomain" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #cbd5e1;">
                        <option value="">-- Seleziona --</option>
                        ${categories.primary_domains.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Nuovo Sottodominio</label>
                    <select id="batchSubdomain" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #cbd5e1;">
                        <option value="">-- Seleziona --</option>
                        ${categories.subdomains.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div style="display: flex; gap: 10px;">
                <button id="btnBatchCategoryCancel" class="small-btn" style="background: #6c757d; flex: 1;">Annulla</button>
                <button id="btnBatchCategoryConfirm" class="small-btn" style="background: #2c7da0; flex: 1;">Applica</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Event listener
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

        // Aggiorna le domande selezionate
        let updatedCount = 0;
        questions.forEach(q => {
            if (selectedQuestionIds.has(q.id)) {
                if (newPrimaryDomain) q.primary_domain = newPrimaryDomain;
                if (newSubdomain) q.subdomain = newSubdomain;
                updatedCount++;
            }
        });

        // Pulisci selezione
        selectedQuestionIds.clear();

        // Aggiorna filtri se necessario
        if (primaryDomainFilter && newPrimaryDomain && primaryDomainFilter.value !== newPrimaryDomain) {
            primaryDomainFilter.value = newPrimaryDomain;
        }
        if (subdomainFilter && newSubdomain && subdomainFilter.value !== newSubdomain) {
            subdomainFilter.value = newSubdomain;
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
    
    // Navigation buttons
    const navButtonsHtml = `
        <div class="nav-buttons">
            <button id="navPrevBtn" class="small-btn" ${currentIndex === 0 ? 'disabled style="opacity:0.5;"' : ''}>◀ Prec</button>
            <span style="font-size:0.7rem; color:#6c757d;">${currentIndex + 1} / ${total}</span>
            <button id="navNextBtn" class="small-btn" ${currentIndex === total - 1 ? 'disabled style="opacity:0.5;"' : ''}>Succ ▶</button>
        </div>
    `;
    
    // Get all answer letters from question
    const answerLetters = Object.keys(question.answers || {}).sort();
    let answersHtml = `<div class="answers-grid" id="answersGrid">`;
    
    answerLetters.forEach(letter => {
        const answerValue = question.answers?.[letter] || '';
        answersHtml += `
            <div class="answer-field" data-letter="${letter}">
                <span class="answer-letter">${letter}:</span>
                <input type="text" class="answer-input" data-letter="${letter}" value="${escapeHtml(answerValue)}" placeholder="Testo risposta">
                <div class="answer-actions">
                    <button type="button" class="remove-answer" data-letter="${letter}">✖</button>
                </div>
            </div>
        `;
    });
    answersHtml += `</div>`;

    let correctHtml = `<div><strong>Risposte Corrette</strong></div><div class="correct-options" id="correctOptions">`;
    answerLetters.forEach(letter => {
        const isChecked = Array.isArray(question.correct) && question.correct.includes(letter);
        correctHtml += `
            <label class="correct-check">
                <input type="checkbox" class="correct-checkbox" value="${letter}" ${isChecked ? 'checked' : ''}> ${letter}
            </label>
        `;
    });
    correctHtml += `</div>`;

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
                    <span>📋 Duplicati (${question.duplicate_count})</span>
                    <span class="arrow">▶</span>
                </div>
                <div class="accordion-content">
                    <div class="duplicate-info">
                        ${duplicatesList.map(d => `
                            <div class="duplicate-item-detail">
                                <strong>${escapeHtml(d.id)}</strong><br>
                                ${escapeHtml(d.text)}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // Top bar with ID and categories
    const topBarHtml = `
        <div class="form-top-bar">
            <div class="form-group">
                <label>ID</label>
                <input type="text" id="field_id" value="${escapeHtml(question.id)}" placeholder="es., Q1257">
                <div id="idError" style="color: #c44536; font-size: 0.7rem; margin-top: 2px; display: none;"></div>
            </div>
            <div class="form-group">
                <label>Dominio</label>
                <select id="field_primary_domain">
                    ${categories.primary_domains.map(d => `<option value="${escapeHtml(d)}" ${question.primary_domain === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Sottodominio</label>
                <select id="field_subdomain">
                    ${categories.subdomains.map(s => `<option value="${escapeHtml(s)}" ${question.subdomain === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
                </select>
            </div>
        </div>
    `;

    // Action buttons row
    const actionButtonsRowHtml = `
        <div class="action-buttons-row">
            <button id="btnUpdateQuestion" class="primary">💾 Aggiorna</button>
            <button id="btnDeleteQuestion" class="danger">🗑️ Elimina</button>
            <button id="btnDuplicate" class="warning">📑 Duplica</button>
            <button id="manageCategoriesBtn" class="info small-btn" style="margin-left: auto;">🏷️ Categorie</button>
        </div>
    `;

    // Answers section with header
    const answersSectionHtml = `
        <div class="answers-header">
            <label>Risposte</label>
            <button type="button" id="addAnswerBtn" class="small-btn">+ Aggiungi</button>
        </div>
        ${answersHtml}
    `;

    const formHtml = `
        ${navButtonsHtml}
        ${topBarHtml}
        ${actionButtonsRowHtml}
        <div class="form-group">
            <label>Testo Domanda</label>
            <textarea id="field_raw_text" placeholder="Testo della domanda...">${escapeHtml(question.raw_text || '')}</textarea>
        </div>
        ${answersSectionHtml}
        <div class="form-group">
            ${correctHtml}
        </div>
        <div class="form-group">
            <label>Note</label>
            <textarea id="field_notes" placeholder="Aggiungi note...">${escapeHtml(question.notes || '')}</textarea>
        </div>
        ${duplicateHtml}
    `;
    
    formContentDiv.innerHTML = formHtml;

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
    
    document.getElementById('btnUpdateQuestion')?.addEventListener('click', () => saveCurrentQuestion(id, true));
    document.getElementById('btnDeleteQuestion')?.addEventListener('click', () => deleteQuestionById(id));
    document.getElementById('btnDuplicate')?.addEventListener('click', () => duplicateQuestion(id));
    document.getElementById('manageCategoriesBtn')?.addEventListener('click', showCategoriesModal);
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
    const currentLetters = Array.from(answersGrid.querySelectorAll('.answer-field')).map(f => f.getAttribute('data-letter'));
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
        <div class="answer-field" data-letter="${newLetter}">
            <span class="answer-letter">${newLetter}:</span>
            <input type="text" class="answer-input" data-letter="${newLetter}" value="" placeholder="Testo risposta">
            <div class="answer-actions">
                <button type="button" class="remove-answer" data-letter="${newLetter}">✖</button>
            </div>
        </div>
    `;
    
    answersGrid.insertAdjacentHTML('beforeend', newAnswerHtml);
    
    const removeBtn = answersGrid.querySelector(`.remove-answer[data-letter="${newLetter}"]`);
    if (removeBtn) {
        removeBtn.addEventListener('click', () => removeAnswer(newLetter));
    }
    
    const newInput = answersGrid.querySelector(`.answer-input[data-letter="${newLetter}"]`);
    if (newInput) {
        newInput.addEventListener('input', () => markDirty());
        newInput.addEventListener('change', () => markDirty());
    }
    
    const correctOptions = document.getElementById('correctOptions');
    const newCheckbox = `
        <label class="correct-check">
            <input type="checkbox" class="correct-checkbox" value="${newLetter}"> ${newLetter}
        </label>
    `;
    correctOptions.insertAdjacentHTML('beforeend', newCheckbox);
    
    const newCb = correctOptions.querySelector(`.correct-checkbox[value="${newLetter}"]`);
    if (newCb) {
        newCb.addEventListener('change', () => markDirty());
    }
    
    markDirty();
}

function removeAnswer(letter) {
    const answerField = document.querySelector(`.answer-field[data-letter="${letter}"]`);
    if (answerField) answerField.remove();
    
    const checkbox = document.querySelector(`.correct-checkbox[value="${letter}"]`);
    if (checkbox) checkbox.closest('.correct-check')?.remove();
    
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
    
    // Collect correct
    const correct = [];
    const checkboxes = document.querySelectorAll('.correct-checkbox');
    checkboxes.forEach(cb => {
        if (cb.checked) correct.push(cb.value);
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
                categories = result.categories;
                createFilterUI(); // This now preserves filter values
            }

            if (showStatus) {
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
        if (subdomainFilter) subdomainFilter.value = currentFilters.subdomain;
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
    if (subdomainFilter) subdomainFilter.value = currentFilters.subdomain;
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
            categories = result.categories;
            createFilterUI(); // Refresh filter UI only if needed
        }
        setStatus(result.message || 'Tutte le modifiche sono state salvate con successo!');
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
        primary_domain: categories.primary_domains[0] || "indefinito",
        subdomain: categories.subdomains[0] || "indefinito",
        question_type: "",
        answers: { A: "", B: "", C: "", D: "", E: "", F: "" },
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
        
        content.innerHTML = `
            <div class="stats-section">
                <h4>📊 Panoramica Generale</h4>
                <div class="stats-total">
                    <span>Totale Domande:</span>
                    <strong>${stats.total_questions}</strong>
                </div>
                <div class="stats-total" style="background: #fff3e0; margin-top: 5px;">
                    <span>Domande con Duplicati:</span>
                    <strong>${stats.total_duplicates}</strong>
                </div>
            </div>
            
            <div class="stats-section">
                <h4>📝 Statistiche Risposte</h4>
                <div class="stats-grid">
                    <div class="stats-item">
                        <span class="category-name">Domande con una sola risposta:</span>
                        <span class="category-count">${stats.questions_with_one_answer}</span>
                    </div>
                    <div class="stats-item">
                        <span class="category-name">Domande senza risposte:</span>
                        <span class="category-count">${stats.questions_with_no_answers}</span>
                    </div>
                    <div class="stats-item">
                        <span class="category-name">Domande senza risposte corrette:</span>
                        <span class="category-count">${stats.questions_with_no_correct}</span>
                    </div>
                </div>
            </div>
            
            <div class="stats-section">
                <h4>🏷️ Distribuzione per Dominio Principale</h4>
                <div class="stats-grid">
                    ${primaryDomainsSorted.map(([domain, count]) => `
                        <div class="stats-item">
                            <span class="category-name">${escapeHtml(domain)}</span>
                            <span class="category-count">${count}</span>
                        </div>
                    `).join('')}
                </div>
                ${primaryDomainsSorted.length === 0 ? '<p style="color:#94a3b8; text-align:center;">Nessun dato disponibile</p>' : ''}
            </div>
            
            <div class="stats-section">
                <h4>📂 Distribuzione per Sottodominio</h4>
                <div class="stats-grid">
                    ${subdomainsSorted.map(([sub, count]) => `
                        <div class="stats-item">
                            <span class="category-name">${escapeHtml(sub)}</span>
                            <span class="category-count">${count}</span>
                        </div>
                    `).join('')}
                </div>
                ${subdomainsSorted.length === 0 ? '<p style="color:#94a3b8; text-align:center;">Nessun dato disponibile</p>' : ''}
            </div>
        `;
        modal.style.display = 'block';
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

        // Reset selection
        selectedBackups.clear();
        updateBackupSelectionUI();

        if (data.backups.length === 0) {
            content.innerHTML = '<p>Nessun backup disponibile.</p>';
            actionsDiv.style.display = 'none';
        } else {
            content.innerHTML = `
                <ul style="list-style: none; padding: 0;">
                    ${data.backups.map(backup => `
                        <li style="padding: 10px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 10px;">
                            <input type="checkbox" class="backup-checkbox" data-name="${backup.name}" style="cursor: pointer;">
                            <div style="flex: 1;">
                                <strong>${backup.name}</strong><br>
                                <small>Dimensione: ${(backup.size / 1024).toFixed(2)} KB | Modificato: ${new Date(backup.modified).toLocaleString()}</small>
                            </div>
                            <button onclick="window.restoreBackup('${backup.name}')" style="padding: 4px 12px;">Ripristina</button>
                        </li>
                    `).join('')}
                </ul>
            `;
            actionsDiv.style.display = 'block';

            // Add event listeners for checkboxes
            document.querySelectorAll('.backup-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const name = e.target.getAttribute('data-name');
                    toggleBackupSelection(name);
                });
            });
        }
        modal.style.display = 'block';
    } catch (err) {
        console.error(err);
        setStatus('Errore nel caricamento dei backup', true);
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
    const selectAllCb = document.getElementById('selectAllBackups');
    
    if (countSpan) {
        countSpan.textContent = `${count} selezionati`;
    }
    if (deleteBtn) {
        deleteBtn.disabled = count === 0;
    }
    if (selectAllCb) {
        // Check if all backups are selected
        const allCheckboxes = document.querySelectorAll('.backup-checkbox');
        selectAllCb.checked = allCheckboxes.length > 0 && allCheckboxes.length === count;
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
    // Refresh categories from server first
    try {
        const response = await fetch(`${API_BASE_URL}/categories`);
        if (response.ok) {
            const categoriesData = await response.json();
            categories.primary_domains = categoriesData.primary_domains;
            categories.subdomains = categoriesData.subdomains;
        }
    } catch (err) {
        console.error('Errore nell\'aggiornamento delle categorie:', err);
    }
    
    const modal = document.getElementById('categoriesModal');
    const content = document.getElementById('categoriesContent');
    
    content.innerHTML = `
        <h4>Domini Principali</h4>
        <div id="primaryDomainsList">
            ${categories.primary_domains.map(d => `
                <div class="category-item">
                    <span>${escapeHtml(d)}</span>
                    <div class="category-actions">
                        ${d !== 'indefinito' ? `
                            <button onclick="window.renameCategory('primary_domain', '${escapeHtml(d)}')" class="small-btn" style="background: #e67e22;">✏️ Rinomina</button>
                            <button onclick="window.removeCategory('primary_domain', '${escapeHtml(d)}')" class="danger small-btn">Rimuovi</button>
                        ` : '<span style="color: #94a3b8; font-size: 0.8rem;">(predefinito)</span>'}
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="add-category">
            <input type="text" id="newPrimaryDomain" placeholder="Nuovo dominio principale" onkeypress="if(event.key==='Enter') window.addCategory('primary_domain')">
            <button onclick="window.addCategory('primary_domain')" class="primary small-btn">Aggiungi</button>
        </div>
        
        <h4 style="margin-top: 20px;">Sottodomini</h4>
        <div id="subdomainsList">
            ${categories.subdomains.map(s => `
                <div class="category-item">
                    <span>${escapeHtml(s)}</span>
                    <div class="category-actions">
                        ${s !== 'indefinito' ? `
                            <button onclick="window.renameCategory('subdomain', '${escapeHtml(s)}')" class="small-btn" style="background: #e67e22;">✏️ Rinomina</button>
                            <button onclick="window.removeCategory('subdomain', '${escapeHtml(s)}')" class="danger small-btn">Rimuovi</button>
                        ` : '<span style="color: #94a3b8; font-size: 0.8rem;">(predefinito)</span>'}
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="add-category">
            <input type="text" id="newSubdomain" placeholder="Nuovo sottodominio" onkeypress="if(event.key==='Enter') window.addCategory('subdomain')">
            <button onclick="window.addCategory('subdomain')" class="primary small-btn">Aggiungi</button>
        </div>
        <div style="margin-top: 15px; font-size: 0.8rem; color: #27ae60; text-align: center; padding: 10px; background: #e8f5e9; border-radius: 8px;">
            💡 Suggerimento: Le categorie vengono salvate in un file separato e appariranno immediatamente nei menu a tendina!
        </div>
    `;
    
    modal.style.display = 'block';
}

async function addCategory(type) {
    const input = document.getElementById(type === 'primary_domain' ? 'newPrimaryDomain' : 'newSubdomain');
    const value = input.value.trim();
    if (!value) {
        setStatus('Inserisci un nome per la categoria', true);
        return;
    }

        setStatus(`Aggiunta categoria "${value}"...`);
    
    try {
        const response = await fetch(`${API_BASE_URL}/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'add',
                type: type,
                value: value
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Aggiunta categoria fallita');
        }
        
        const result = await response.json();
        categories = result.categories;
        input.value = '';
        
        // Refresh the modal to show new categories
        showCategoriesModal();
        
        // Update the select dropdowns in the form if they exist
        const primarySelect = document.getElementById('field_primary_domain');
        const subdomainSelect = document.getElementById('field_subdomain');
        
        if (primarySelect && type === 'primary_domain') {
            const currentValue = primarySelect.value;
            primarySelect.innerHTML = categories.primary_domains.map(d => 
                `<option value="${escapeHtml(d)}" ${currentValue === d ? 'selected' : ''}>${escapeHtml(d)}</option>`
            ).join('');
        }
        
        if (subdomainSelect && type === 'subdomain') {
            const currentValue = subdomainSelect.value;
            subdomainSelect.innerHTML = categories.subdomains.map(s => 
                `<option value="${escapeHtml(s)}" ${currentValue === s ? 'selected' : ''}>${escapeHtml(s)}</option>`
            ).join('');
        }
        
        // Update filter UI
        createFilterUI();
        
        setStatus(`Categoria "${value}" aggiunta con successo!`);
    } catch (err) {
        console.error(err);
        setStatus(err.message || 'Errore nell\'aggiunta della categoria', true);
    }
}

async function removeCategory(type, value) {
    if (!confirm(`Rimuovere la categoria "${value}"? Le domande che la utilizzano verranno impostate su "indefinito".`)) return;
    
    setStatus(`Rimozione categoria "${value}"...`);
    
    try {
        const response = await fetch(`${API_BASE_URL}/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'remove',
                type: type,
                value: value
            })
        });
        
        if (!response.ok) throw new Error('Rimozione categoria fallita');
        
        const result = await response.json();
        categories = result.categories;
        
        // Refresh the modal
        showCategoriesModal();
        
        // Reload questions to update any affected questions
        await loadQuestions();
        
        setStatus(`Categoria "${value}" rimossa`);
    } catch (err) {
        console.error(err);
        setStatus('Errore nella rimozione della categoria', true);
    }
}

async function renameCategory(type, oldValue) {
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
                new_value: trimmedValue
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Rinomina categoria fallita');
        }
        
        const result = await response.json();
        categories = result.categories;
        
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

function toggleShowDuplicates() {
    showDuplicatesOnly = !showDuplicatesOnly;
    if (toggleDuplicatesBtn) {
        if (showDuplicatesOnly) {
            toggleDuplicatesBtn.classList.add('active');
            toggleDuplicatesBtn.style.background = '#e67e22';
            toggleDuplicatesBtn.textContent = '🔍 Mostra Tutto';
        } else {
            toggleDuplicatesBtn.classList.remove('active');
            toggleDuplicatesBtn.style.background = '';
            toggleDuplicatesBtn.textContent = '🔍 Mostra Duplicati';
        }
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
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.renameCategory = renameCategory;

// Event listeners
searchInput.addEventListener('input', () => renderQuestionList());

document.getElementById('btnNew').addEventListener('click', createNewQuestion);
document.getElementById('btnSaveAll').addEventListener('click', saveAllToServer);
document.getElementById('btnReload').addEventListener('click', loadQuestions);
document.getElementById('btnStats').addEventListener('click', showStats);
document.getElementById('btnBackup').addEventListener('click', showBackups);
if (toggleDuplicatesBtn) {
    toggleDuplicatesBtn.addEventListener('click', toggleShowDuplicates);
}

// Backup actions
document.getElementById('btnDeleteSelectedBackups')?.addEventListener('click', deleteSelectedBackups);
document.getElementById('selectAllBackups')?.addEventListener('change', selectAllBackups);

// Help button functionality
const btnHelp = document.getElementById('btnHelp');
const helpModal = document.getElementById('helpModal');
const helpClose = helpModal?.querySelector('.close');

if (btnHelp && helpModal) {
    btnHelp.addEventListener('click', function() {
        helpModal.style.display = 'block';
    });
}

if (helpClose) {
    helpClose.addEventListener('click', function() {
        helpModal.style.display = 'none';
    });
}

// Modal close handlers
document.querySelectorAll('.modal .close').forEach(close => {
    close.addEventListener('click', function() {
        this.closest('.modal').style.display = 'none';
    });
});

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
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
loadQuestions();
checkUrlParameter();
