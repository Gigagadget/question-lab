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
const detailContent = document.getElementById('detailContent');
const statusSpan = document.getElementById('statusMsg');
const questionCountSpan = document.getElementById('questionCount');
const viewCounter = document.getElementById('viewCounter');
const searchInput = document.getElementById('searchInput');
const toggleCorrectBtn = document.getElementById('toggleCorrectBtn');
const navPrevBtn = document.getElementById('navPrevBtn');
const navNextBtn = document.getElementById('navNextBtn');
const btnExportDoc = document.getElementById('btnExportDoc');
const btnExportPdf = document.getElementById('btnExportPdf');
const sortSelect = document.getElementById('sortSelect');

// New DOM elements for popover
const btnFilters = document.getElementById('btnFilters');
const filtersBadge = document.getElementById('filtersBadge');
const filtersPopover = document.getElementById('filtersPopover');
const filtersPopoverOverlay = document.getElementById('filtersPopoverOverlay');
const filtersPopoverClose = document.getElementById('filtersPopoverClose');
const popoverDomainSearch = document.getElementById('popoverDomainSearch');
const popoverFilterHierarchy = document.getElementById('popoverFilterHierarchy');
const popoverCloseBtn = document.getElementById('popoverCloseBtn');
const popoverResetBtn = document.getElementById('popoverResetBtn');
const activeFiltersBar = document.getElementById('activeFiltersBar');
const activeFiltersTags = document.getElementById('activeFiltersTags');
const clearAllFiltersBtn = document.getElementById('clearAllFiltersBtn');

// Expansion state for domains (both sidebar and popover)
const expandedDomains = new Set();

// ACTIVE filter state (applied directly on click)
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

function ensureSelectedSubdomainsForPrimary(primaryDomain, targetObj) {
    if (!targetObj[primaryDomain]) {
        targetObj[primaryDomain] = new Set(getSubdomainsForPrimary(primaryDomain));
    }
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
    return str.replace(/[&<>"']/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return m;
    });
}

// ==================== POPOVER MANAGEMENT ====================

function openFiltersPopover() {
    // Render popover filters with current active state
    renderPopoverFilters();

    // Show popover
    filtersPopover.style.display = 'flex';
    filtersPopoverOverlay.style.display = 'block';

    // Clear search input
    popoverDomainSearch.value = '';
}

function closeFiltersPopover() {
    filtersPopover.style.display = 'none';
    filtersPopoverOverlay.style.display = 'none';
}

function resetFiltersSelectAll() {
    // Select all domains and subdomains
    selectedPrimaryDomains = new Set(categories.primary_domains);
    selectedSubdomainsByPrimary = {};
    categories.primary_domains.forEach(function(primary) {
        selectedSubdomainsByPrimary[primary] = new Set(getSubdomainsForPrimary(primary));
    });

    renderPopoverFilters();
    applyFilters();
}

// ==================== RENDER POPOVER FILTERS ====================

function renderPopoverFilters(domainFilter = '') {
    const lowerFilter = domainFilter.toLowerCase();

    let html = '';

    categories.primary_domains.forEach(function(domain) {
        // Filter domains based on search
        if (lowerFilter && !domain.toLowerCase().includes(lowerFilter)) {
            // Check if any subdomain matches
            const subs = getSubdomainsForPrimary(domain);
            const hasMatchingSub = subs.some(s => s.toLowerCase().includes(lowerFilter));
            if (!hasMatchingSub) return;
        }

        const isSelected = selectedPrimaryDomains.has(domain);
        const isExpanded = expandedDomains.has(domain);
        const subs = getSubdomainsForPrimary(domain);
        ensureSelectedSubdomainsForPrimary(domain, selectedSubdomainsByPrimary);
        const selectedSubCount = selectedSubdomainsByPrimary[domain].size;

        html += '<div class="domain-item' + (isExpanded ? ' expanded' : '') + '" data-domain="' + escapeHtml(domain) + '">';

        // Domain header chip
        html += '<button class="domain-header' + (isSelected ? ' selected' : '') + '" data-domain="' + escapeHtml(domain) + '">';
        html += '<span class="domain-expander">';
        html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
        html += '<polyline points="9 18 15 12 9 6"></polyline>';
        html += '</svg>';
        html += '</span>';
        html += '<span class="domain-name">' + escapeHtml(domain) + '</span>';
        html += '<span class="domain-count">' + selectedSubCount + '/' + subs.length + '</span>';
        html += '</button>';

        // Subdomain container (collapsed by default)
        html += '<div class="subdomain-container">';

        // Subdomain actions
        html += '<div class="subdomain-actions">';
        html += '<button onclick="window.popoverSelectAllSub(\'' + escapeHtml(domain) + '\')">Tutti</button>';
        html += '<button onclick="window.popoverSelectNoneSub(\'' + escapeHtml(domain) + '\')">Nessuno</button>';
        html += '</div>';

        // Subdomain chips
        html += '<div class="subdomain-chips">';
        subs.forEach(function(s) {
            const chipSelected = selectedSubdomainsByPrimary[domain].has(s);
            html += '<div class="subdomain-chip' + (chipSelected ? ' selected' : '') + '" data-primary="' + escapeHtml(domain) + '" data-sub="' + escapeHtml(s) + '">';
            html += escapeHtml(s);
            html += '</div>';
        });
        html += '</div>';

        html += '</div>';
        html += '</div>';
    });

    if (!html) {
        html = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:0.85rem;">Nessun risultato</div>';
    }

    popoverFilterHierarchy.innerHTML = html;

    // Add event listeners
    setupPopoverEventListeners();
}

function setupPopoverEventListeners() {
    // Domain header clicks
    document.querySelectorAll('.popover-filter-hierarchy .domain-header').forEach(function(header) {
        const domain = header.getAttribute('data-domain');

        // Expander click: toggle expansion only
        const expander = header.querySelector('.domain-expander');
        if (expander) {
            expander.addEventListener('click', function(e) {
                e.stopPropagation();
                if (expandedDomains.has(domain)) {
                    expandedDomains.delete(domain);
                    header.parentElement.classList.remove('expanded');
                } else {
                    expandedDomains.add(domain);
                    header.parentElement.classList.add('expanded');
                }
            });
        }

        // Header click: toggle domain selection
        header.addEventListener('click', function(e) {
            if (e.target === expander || (expander && expander.contains(e.target))) return;
            togglePendingDomain(domain);
        });
    });

    // Subdomain chip clicks
    document.querySelectorAll('.popover-filter-hierarchy .subdomain-chip').forEach(function(chip) {
        chip.addEventListener('click', function() {
            const primary = this.getAttribute('data-primary');
            const sub = this.getAttribute('data-sub');
            ensureSelectedSubdomainsForPrimary(primary, selectedSubdomainsByPrimary);

            if (this.classList.contains('selected')) {
                selectedSubdomainsByPrimary[primary].delete(sub);
                this.classList.remove('selected');
            } else {
                selectedSubdomainsByPrimary[primary].add(sub);
                this.classList.add('selected');
            }

            updatePopoverDomainCount(primary);
            applyFilters();
        });
    });
}

function togglePendingDomain(domain) {
    const header = document.querySelector('.popover-filter-hierarchy .domain-header[data-domain="' + escapeHtml(domain) + '"]');

    if (selectedPrimaryDomains.has(domain)) {
        selectedPrimaryDomains.delete(domain);
        if (header) header.classList.remove('selected');
    } else {
        selectedPrimaryDomains.add(domain);
        ensureSelectedSubdomainsForPrimary(domain, selectedSubdomainsByPrimary);
        if (header) header.classList.add('selected');
    }

    updatePopoverDomainCount(domain);
    applyFilters();
}

function updatePopoverDomainCount(domain) {
    const item = document.querySelector('.popover-filter-hierarchy .domain-item[data-domain="' + escapeHtml(domain) + '"]');
    if (!item) return;

    const countEl = item.querySelector('.domain-count');
    const subs = getSubdomainsForPrimary(domain);
    ensureSelectedSubdomainsForPrimary(domain, selectedSubdomainsByPrimary);
    const selectedCount = selectedSubdomainsByPrimary[domain].size;

    if (countEl) {
        countEl.textContent = selectedCount + '/' + subs.length;
    }
}

// Popover select all/none for specific domain
function popoverSelectAllSub(domain) {
    if (!selectedPrimaryDomains.has(domain)) return;
    selectedSubdomainsByPrimary[domain] = new Set(getSubdomainsForPrimary(domain));
    updatePopoverDomainCount(domain);
    renderPopoverFilters(popoverDomainSearch.value);
    applyFilters();
}

function popoverSelectNoneSub(domain) {
    if (!selectedPrimaryDomains.has(domain)) return;
    selectedSubdomainsByPrimary[domain] = new Set();
    updatePopoverDomainCount(domain);
    renderPopoverFilters(popoverDomainSearch.value);
    applyFilters();
}

// ==================== ACTIVE FILTERS BAR ====================

function renderActiveFiltersBar() {
    let tagsHtml = '';
    let hasFilters = false;

    categories.primary_domains.forEach(function(domain) {
        if (!selectedPrimaryDomains.has(domain)) return;

        ensureSelectedSubdomainsForPrimary(domain, selectedSubdomainsByPrimary);
        const selectedSubs = selectedSubdomainsByPrimary[domain];
        const allSubs = getSubdomainsForPrimary(domain);

        // If all subdomains are selected, show just the domain
        if (selectedSubs.size === allSubs.length) {
            hasFilters = true;
            tagsHtml += '<span class="filter-tag">' + escapeHtml(domain) +
                '<button class="remove-tag-btn" onclick="removeDomainFilter(\'' + escapeHtml(domain) + '\')" title="Rimuovi">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                '</button></span>';
        } else {
            // Show individual subdomains
            selectedSubs.forEach(function(sub) {
                hasFilters = true;
                tagsHtml += '<span class="filter-tag">' + escapeHtml(domain) + ' › ' + escapeHtml(sub) +
                    '<button class="remove-tag-btn" onclick="removeSubdomainFilter(\'' + escapeHtml(domain) + '\', \'' + escapeHtml(sub) + '\')" title="Rimuovi">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                    '</button></span>';
            });
        }
    });

    activeFiltersTags.innerHTML = tagsHtml;
    activeFiltersBar.style.display = hasFilters ? 'flex' : 'none';

    // Update badge on filter button
    updateFiltersBadge();
}

function updateFiltersBadge() {
    let domainCount = selectedPrimaryDomains.size;
    let subCount = 0;

    categories.primary_domains.forEach(function(domain) {
        if (!selectedPrimaryDomains.has(domain)) return;
        ensureSelectedSubdomainsForPrimary(domain, selectedSubdomainsByPrimary);
        subCount += selectedSubdomainsByPrimary[domain].size;
    });

    const totalFilters = domainCount;
    if (totalFilters > 0 && filtersBadge) {
        filtersBadge.style.display = 'inline-flex';
        filtersBadge.textContent = totalFilters;
        btnFilters.classList.add('has-filters');
    } else if (filtersBadge) {
        filtersBadge.style.display = 'none';
        btnFilters.classList.remove('has-filters');
    }
}

function removeDomainFilter(domain) {
    selectedPrimaryDomains.delete(domain);
    delete selectedSubdomainsByPrimary[domain];
    applyFilters();
}

function removeSubdomainFilter(domain, sub) {
    ensureSelectedSubdomainsForPrimary(domain, selectedSubdomainsByPrimary);
    selectedSubdomainsByPrimary[domain].delete(sub);

    // If no subdomains left, remove the domain too
    if (selectedSubdomainsByPrimary[domain].size === 0) {
        selectedPrimaryDomains.delete(domain);
        delete selectedSubdomainsByPrimary[domain];
    }

    applyFilters();
}

function clearAllFilters() {
    selectedPrimaryDomains.clear();
    selectedSubdomainsByPrimary = {};
    applyFilters();
}

// ==================== LOAD & APPLY ====================

// Fetch all questions
async function loadQuestions() {
    try {
        setStatus('Caricamento...');
        const response = await fetch(API_BASE_URL + '/questions');
        if (!response.ok) throw new Error('Recupero fallito');
        const data = await response.json();

        questions = data.questions;
        categories = normalizeCategoriesData(data.categories);

        // Initialize default selection (all selected)
        if (selectedPrimaryDomains.size === 0) {
            selectedPrimaryDomains = new Set(categories.primary_domains);
            selectedSubdomainsByPrimary = {};
            categories.primary_domains.forEach(function(primary) {
                selectedSubdomainsByPrimary[primary] = new Set(getSubdomainsForPrimary(primary));
            });
        }

        // Apply initial filters
        applyFilters();

        setStatus('Caricate ' + questions.length + ' domande');
    } catch (err) {
        console.error(err);
        setStatus('Errore caricamento');
        questionsListDiv.innerHTML = '<div class="empty-list">Errore nel caricamento. Assicurati che il backend sia in esecuzione.</div>';
    }
}

// Sort questions based on selected option
function sortQuestions(questionsToSort) {
    const sortBy = sortSelect ? sortSelect.value : 'id';

    if (sortBy === 'category') {
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

        ensureSelectedSubdomainsForPrimary(primary, selectedSubdomainsByPrimary);
        const allowed = selectedSubdomainsByPrimary[primary];
        return allowed.has(q.subdomain);
    });

    // Apply sorting
    filteredQuestions = sortQuestions(filtered);
    renderQuestionList();
    renderActiveFiltersBar();
    updateCounter();
    updateNavButtons();
}

// Render question list
function renderQuestionList() {
    if (questionCountSpan) {
        questionCountSpan.textContent = filteredQuestions.length + ' domande';
    }

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
        const hasAnswers = q.answers && typeof q.answers === 'object' && Object.keys(q.answers).length > 0;
        const correctArr = Array.isArray(q.correct) ? q.correct : [];
        const hasCorrectAnswer = correctArr.length > 0;

        if (!hasAnswers) {
            statusBadge = '<span class="status-badge status-unanswered">Nessuna opzione</span>';
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
                <span>
                    <svg class="meta-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
                    ${escapeHtml(q.primary_domain || 'N/D')}
                </span>
                <span>
                    <svg class="meta-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
                    ${escapeHtml(q.subdomain || 'N/D')}
                </span>
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
        viewCounter.textContent = '0 / ' + filteredQuestions.length;
    } else {
        viewCounter.textContent = (currentIndex + 1) + ' / ' + filteredQuestions.length;
    }
    updateMobileCounter();
}

// Sync mobile counter with desktop counter
function updateMobileCounter() {
    var viewMobileCounter = document.getElementById('viewMobileCounter');
    if (viewMobileCounter && viewCounter) {
        viewMobileCounter.textContent = viewCounter.textContent;
    }
}

// Update navigation buttons
function updateNavButtons() {
    var currentIndex = filteredQuestions.findIndex(function(q) { return q.id === selectedId; });
    var isFirst = currentIndex <= 0;
    var isLast = currentIndex === -1 || currentIndex >= filteredQuestions.length - 1;

    // Desktop hidden arrows
    if (navPrevBtn) navPrevBtn.disabled = isFirst;
    if (navNextBtn) navNextBtn.disabled = isLast;

    // Detail panel nav buttons
    var detailPrev = document.getElementById('detailPrevBtn');
    var detailNext = document.getElementById('detailNextBtn');
    if (detailPrev) detailPrev.disabled = isFirst;
    if (detailNext) detailNext.disabled = isLast;

    // Mobile nav buttons
    var mobilePrev = document.getElementById('navPrevBtnMobile');
    var mobileNext = document.getElementById('navNextBtnMobile');
    if (mobilePrev) mobilePrev.disabled = isFirst;
    if (mobileNext) mobileNext.disabled = isLast;
}

// Render detail view (read-only)
function renderDetailView(id) {
    var question = questions.find(function(q) { return q.id === id; });
    if (!question) {
        detailContent.innerHTML = '<div class="view-placeholder">' +
            '<div class="placeholder-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>' +
            '<h3>Domanda non trovata</h3>' +
            '</div>';
        return;
    }

    // Build answers HTML
    var answerLetters = Object.keys(question.answers || {}).sort();
    var correctAnswers = Array.isArray(question.correct) ? question.correct : [];

    var answersHtml = '';
    var hasAnyAnswers = false;
    answerLetters.forEach(function(letter) {
        var answerText = question.answers[letter] || '';
        var isCorrect = correctAnswers.includes(letter);
        var showCorrect = showCorrectAnswers && isCorrect;

        if (answerText) hasAnyAnswers = true;

        answersHtml += '<div class="view-answer ' + (showCorrect ? 'correct' : '') + '">' +
            '<span class="view-answer-letter">' + letter + '</span>' +
            '<span class="view-answer-text">' + escapeHtml(answerText) + '</span>' +
            (showCorrect ? '<span class="view-correct-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Corretta</span>' : '') +
            '</div>';
    });

    // Empty state message
    var noAnswersMsg = '';
    if (answerLetters.length === 0) {
        noAnswersMsg = '<div class="view-no-answers">Nessuna opzione disponibile</div>';
    } else if (!hasAnyAnswers) {
        noAnswersMsg = '<div class="view-no-answers">Opzioni vuote</div>';
    } else if (correctAnswers.length === 0) {
        noAnswersMsg = '<div class="view-no-answers">Nessuna risposta corretta impostata</div>';
    }

    // Notes section
    var notesHtml = '';
    if (question.notes && question.notes.trim()) {
        notesHtml = '<div class="view-notes">' +
            '<div class="view-notes-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:middle;margin-right:4px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Note</div>' +
            '<div class="view-notes-text">' + escapeHtml(question.notes) + '</div>' +
            '</div>';
    }

    // Edit button
    var editButtonHtml = '<button class="view-edit-btn" onclick="window.openInEditor(\'' + escapeHtml(question.id) + '\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:middle;margin-right:4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Modifica</button>';

    detailContent.innerHTML = '<div class="detail-card">' +
        '<div class="view-detail-content">' +
            '<div class="view-detail-header">' +
                '<span class="view-detail-id">' + escapeHtml(question.id) + '</span>' +
                '<span class="view-detail-domain"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>' + escapeHtml(question.primary_domain || 'N/D') + '</span>' +
                '<span class="view-detail-subdomain"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:middle;margin-right:4px;"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>' + escapeHtml(question.subdomain || 'N/D') + '</span>' +
                editButtonHtml +
            '</div>' +
            '<div class="view-question-text">' +
                escapeHtml(question.raw_text || 'Nessun testo disponibile') +
            '</div>' +
            '<div class="view-answers-section">' +
                (answersHtml || noAnswersMsg) +
            '</div>' +
            notesHtml +
        '</div>' +
    '</div>';
}

// Toggle correct answers visibility
function toggleCorrectAnswers() {
    showCorrectAnswers = !showCorrectAnswers;
    if (showCorrectAnswers) {
        toggleCorrectBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:middle;margin-right:4px;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Nascondi Risposte';
        toggleCorrectBtn.classList.add('active');
    } else {
        toggleCorrectBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:middle;margin-right:4px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Mostra Risposte';
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

// Open question in editor
function openInEditor(questionId) {
    window.location.href = '/editor?id=' + encodeURIComponent(questionId);
}

// Export to DOC
async function exportToDoc() {
    if (filteredQuestions.length === 0) {
        setStatus('Nessuna domanda da esportare');
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

        const blob = await response.blob();

        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'questions_export.docx';
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
                filename = filenameMatch[1].replace(/['"]/g, '');
            }
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        setStatus('DOC esportato con successo!');
    } catch (err) {
        console.error(err);
        setStatus('Errore durante l\'esportazione DOC');
    }
}

// Export to PDF
async function exportToPdf() {
    if (filteredQuestions.length === 0) {
        setStatus('Nessuna domanda da esportare');
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

        const blob = await response.blob();

        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'questions_export.pdf';
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
                filename = filenameMatch[1].replace(/['"]/g, '');
            }
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        setStatus('PDF esportato con successo!');
    } catch (err) {
        console.error(err);
        setStatus('Errore durante l\'esportazione PDF');
    }
}

// Check for active database and show/hide blocker
function checkActiveDatabase() {
    fetch('/api/databases/active')
        .then(res => res.json())
        .then(data => {
            const blocker = document.getElementById('noDbBlocker');
            const activeDbNameEl = document.getElementById('activeDbName');
            if (blocker) {
                if (!data.active_database) {
                    blocker.style.display = 'flex';
                    if (activeDbNameEl) activeDbNameEl.textContent = '';
                } else {
                    blocker.style.display = 'none';
                    if (activeDbNameEl) activeDbNameEl.textContent = data.active_database;
                }
            }
        })
        .catch(err => {
            console.error('Error loading active database:', err);
            const blocker = document.getElementById('noDbBlocker');
            if (blocker) blocker.style.display = 'flex';
        });
}

// ==================== EVENT LISTENERS ====================

// Filters popover
if (btnFilters) {
    btnFilters.addEventListener('click', function(e) {
        e.stopPropagation();
        if (filtersPopover.style.display === 'flex') {
            closeFiltersPopover();
        } else {
            openFiltersPopover();
        }
    });
}

// Close popover
if (filtersPopoverClose) {
    filtersPopoverClose.addEventListener('click', closeFiltersPopover);
}

if (filtersPopoverOverlay) {
    filtersPopoverOverlay.addEventListener('click', closeFiltersPopover);
}

// Popover search
if (popoverDomainSearch) {
    popoverDomainSearch.addEventListener('input', function() {
        renderPopoverFilters(this.value);
    });
}

// Popover buttons
if (popoverCloseBtn) {
    popoverCloseBtn.addEventListener('click', closeFiltersPopover);
}

if (popoverResetBtn) {
    popoverResetBtn.addEventListener('click', resetFiltersSelectAll);
}

// Active filters bar
if (clearAllFiltersBtn) {
    clearAllFiltersBtn.addEventListener('click', clearAllFilters);
}

// Search input
if (searchInput) {
    searchInput.addEventListener('input', function() { applyFilters(); });
}

// Sort select
if (sortSelect) {
    sortSelect.addEventListener('change', function() { applyFilters(); });
}

// Toggle correct
if (toggleCorrectBtn) {
    toggleCorrectBtn.addEventListener('click', toggleCorrectAnswers);
}

// Navigation
if (navPrevBtn) {
    navPrevBtn.addEventListener('click', navigateToPrevious);
}
if (navNextBtn) {
    navNextBtn.addEventListener('click', navigateToNext);
}

// Export buttons
if (btnExportDoc) {
    btnExportDoc.addEventListener('click', exportToDoc);
}
if (btnExportPdf) {
    btnExportPdf.addEventListener('click', exportToPdf);
}

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
        } else if (event.key === 'Escape') {
            // Close popover with Escape
            if (filtersPopover.style.display === 'flex') {
                closeFiltersPopover();
            }
        }
    }
});

// Make functions global
window.openInEditor = openInEditor;
window.popoverSelectAllSub = popoverSelectAllSub;
window.popoverSelectNoneSub = popoverSelectNoneSub;
window.removeDomainFilter = removeDomainFilter;
window.removeSubdomainFilter = removeSubdomainFilter;

// Check database on page load
checkActiveDatabase();

// Initial load
loadQuestions();

// === Mobile navigation ===
const navPrevBtnMobile = document.getElementById('navPrevBtnMobile');
const navNextBtnMobile = document.getElementById('navNextBtnMobile');

if (navPrevBtnMobile) {
    navPrevBtnMobile.addEventListener('click', navigateToPrevious);
}
if (navNextBtnMobile) {
    navNextBtnMobile.addEventListener('click', navigateToNext);
}

// === Panel collapse toggles ===
const toggleQuestions = document.getElementById('toggleQuestions');
const questionsPanelEl = document.querySelector('.questions-panel');
const detailPanelEl = document.getElementById('detailPanel');

if (toggleQuestions && questionsPanelEl) {
    toggleQuestions.addEventListener('click', function() {
        questionsPanelEl.classList.toggle('collapsed');
    });
}

// === Detail panel nav ===
const detailPrevBtn = document.getElementById('detailPrevBtn');
const detailNextBtn = document.getElementById('detailNextBtn');

if (detailPrevBtn) {
    detailPrevBtn.addEventListener('click', navigateToPrevious);
}
if (detailNextBtn) {
    detailNextBtn.addEventListener('click', navigateToNext);
}

// === Mobile panel tabs ===
const mobileTabs = document.querySelectorAll('.mobile-panel-tab');
if (mobileTabs.length > 0) {
    mobileTabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            const panelName = this.getAttribute('data-panel');

            mobileTabs.forEach(function(t) { t.classList.remove('active'); });
            this.classList.add('active');

            if (questionsPanelEl) questionsPanelEl.classList.remove('mobile-active');
            if (detailPanelEl) detailPanelEl.classList.remove('mobile-active');

            if (panelName === 'questions' && questionsPanelEl) {
                questionsPanelEl.classList.add('mobile-active');
            } else if (panelName === 'detail' && detailPanelEl) {
                detailPanelEl.classList.add('mobile-active');
            }
        });
    });
}

// === Help modal ===
const btnHelp = document.getElementById('btnHelpSidebar');
const helpModal = document.getElementById('helpModal');
const helpClose = helpModal ? helpModal.querySelector('.close-modal') : null;

if (btnHelp) {
    btnHelp.addEventListener('click', function() {
        if (helpModal) helpModal.style.display = 'block';
    });
}

if (helpClose) {
    helpClose.addEventListener('click', function() {
        helpModal.style.display = 'none';
    });
}

window.addEventListener('click', function(event) {
    if (event.target === helpModal) {
        helpModal.style.display = 'none';
    }
});
