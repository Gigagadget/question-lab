/**
 * Categories Manager - Gestione avanzata categorie
 * Preview impatto, merge categorie, dashboard integrità
 */

const CategoriesManager = (() => {
    const API_BASE = '/api/categories';
    const DEFAULT_SUBDOMAIN = 'indefinito';

    // Stato interno
    let currentHealthData = null;
    let previewResult = null;

    // Stato per il tree manager
    let treeState = {
        expandedPrimaries: new Set(),     // Quali primary sono espansi
        selectedNode: null,                // { type: 'primary'|'sub', name: string, primary?: string }
        searchQuery: '',                   // Filtro ricerca
        subPage: 1,                        // Pagina corrente subs nel dettaglio
        subsPerPage: 10,                   // Subs per pagina
        searchSubQuery: '',                // Filtro subs nel dettaglio
        inlineEdit: null,                  // { type, parent?, oldValue } per edit inline
        inlineAdd: null,                   // { type: 'primary'|'sub', parent? } per add inline
    };

    const SUBS_PER_PAGE = 10;

    // ========== API CALLS ==========

    async function fetchHealth() {
        const res = await fetch(`${API_BASE}/health`);
        if (!res.ok) throw new Error('Recupero health fallito');
        currentHealthData = await res.json();
        return currentHealthData;
    }

    async function previewImpact({ operation, type, value, newValue, primaryDomain }) {
        const payload = {
            operation,
            type,
            value,
        };
        if (newValue) payload.new_value = newValue;
        if (primaryDomain) payload.primary_domain = primaryDomain;

        const res = await fetch(`${API_BASE}/impact-preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Preview fallita');
        }
        previewResult = await res.json();
        return previewResult;
    }

    async function mergeCategories({ type, sourceValue, targetValue, primaryDomain }) {
        const payload = {
            type,
            source_value: sourceValue,
            target_value: targetValue,
        };
        if (primaryDomain) payload.primary_domain = primaryDomain;

        const res = await fetch(`${API_BASE}/merge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Merge fallito');
        }
        return await res.json();
    }

    // ========== UI RENDERING ==========

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderPreviewCard(data) {
        const {
            affected_questions_count,
            sample_question_ids,
            would_fallback_to_default_count,
            warnings
        } = data;

        let html = `
            <div class="cm-preview-card">
                <h4>📊 Anteprima Impatto</h4>
                <div class="cm-preview-metrics">
                    <div class="cm-metric">
                        <span class="cm-metric-value">${affected_questions_count}</span>
                        <span class="cm-metric-label">Domande interessate</span>
                    </div>
                    <div class="cm-metric ${would_fallback_to_default_count > 0 ? 'cm-metric-warning' : ''}">
                        <span class="cm-metric-value">${would_fallback_to_default_count}</span>
                        <span class="cm-metric-label">Fallback a "${escapeHtml('indefinito')}"</span>
                    </div>
                </div>
        `;

        if (warnings && warnings.length > 0) {
            html += `
                <div class="cm-warnings">
                    <h5>⚠️ Avvertenze</h5>
                    <ul>
                        ${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        if (sample_question_ids && sample_question_ids.length > 0) {
            html += `
                <div class="cm-samples">
                    <h5>🔍 Campione ID interessati</h5>
                    <div class="cm-sample-ids">${sample_question_ids.map(id => `<code>${escapeHtml(String(id))}</code>`).join(', ')}</div>
                </div>
            `;
        }

        html += `</div>`;
        return html;
    }

    function renderHealthDashboard(health) {
        const {
            total_questions,
            total_primaries,
            total_subdomains,
            empty_primary_domains,
            unused_subdomains,
            top_primary_domains,
            top_subdomains,
            possible_duplicates,
            suggestions
        } = health;

        let html = `
            <div class="cm-health-dashboard">
                <h4>📊 Riepilogo Categorie</h4>

                <div class="cm-health-summary">
                    <div class="cm-health-card">
                        <span class="cm-health-number">${total_questions}</span>
                        <span class="cm-health-label">Domande totali</span>
                    </div>
                    <div class="cm-health-card">
                        <span class="cm-health-number">${total_primaries}</span>
                        <span class="cm-health-label">Categorie principali</span>
                    </div>
                    <div class="cm-health-card">
                        <span class="cm-health-number">${total_subdomains}</span>
                        <span class="cm-health-label">Sottocategorie totali</span>
                    </div>
                </div>
        `;

        // Suggerimenti - formato leggibile per utente medio
        if (suggestions && suggestions.length > 0) {
            html += `
                <div class="cm-suggestions">
                    <h5>💡 Suggerimenti per te</h5>
            `;
            
            suggestions.forEach(s => {
                if (s.type === 'cleanup' && s.details && Array.isArray(s.details)) {
                    // Suggerimento pulizia: categorie vuote o inutilizzate
                    const items = s.details;
                    const isPrimaries = s.message.toLowerCase().includes('domini');
                    
                    html += `
                        <div class="cm-suggestion cm-suggestion-${s.priority}">
                            <div class="cm-suggestion-header">
                                <span class="cm-suggestion-icon">${isPrimaries ? '📭' : '📁'}</span>
                                <strong>${isPrimaries ? 'Categorie vuote' : 'Sottocategorie mai usate'}</strong>
                            </div>
                            <p>${s.message}</p>
                            <div class="cm-suggestion-items">
                                ${items.slice(0, 10).map(item => `<span class="cm-suggestion-tag">${escapeHtml(item)}</span>`).join('')}
                                ${items.length > 10 ? `<span class="cm-suggestion-tag">+${items.length - 10} altre</span>` : ''}
                            </div>
                        </div>
                    `;
                } else if (s.type === 'merge_candidate' && s.details && Array.isArray(s.details)) {
                    // Suggerimento merge: categorie simili
                    html += `
                        <div class="cm-suggestion cm-suggestion-${s.priority}">
                            <div class="cm-suggestion-header">
                                <span class="cm-suggestion-icon">🔀</span>
                                <strong>Categorie molto simili tra loro</strong>
                            </div>
                            <p>${s.message}</p>
                            <div class="cm-suggestion-pairs">
                                ${s.details.slice(0, 5).map(d => `
                                    <div class="cm-suggestion-pair">
                                        <span class="cm-pair-item">${escapeHtml(d.item_a)}</span>
                                        <span class="cm-pair-arrow">⇄</span>
                                        <span class="cm-pair-item">${escapeHtml(d.item_b)}</span>
                                        <span class="cm-pair-sim">${(d.similarity * 100).toFixed(0)}% simile</span>
                                    </div>
                                `).join('')}
                                ${s.details.length > 5 ? `<p class="cm-more-hint">...e altre ${s.details.length - 5} coppie</p>` : ''}
                            </div>
                        </div>
                    `;
                } else {
                    // Fallback per altri tipi di suggerimenti
                    html += `
                        <div class="cm-suggestion cm-suggestion-${s.priority}">
                            <p>${escapeHtml(s.message)}</p>
                        </div>
                    `;
                }
            });
            
            html += `</div>`;
        } else {
            html += `
                <div class="cm-suggestions cm-suggestions-ok">
                    <h5>✅ Tutto in ordine!</h5>
                    <p>Non ci sono problemi rilevati nella tua tassonomia categorie.</p>
                </div>
            `;
        }

        // Categorie vuote
        if (empty_primary_domains && empty_primary_domains.length > 0) {
            html += `
                <div class="cm-health-section">
                    <h5>📭 Categorie principali senza domande</h5>
                    <ul class="cm-empty-list">
                        ${empty_primary_domains.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // Sottocategorie inutilizzate
        if (unused_subdomains && unused_subdomains.length > 0) {
            html += `
                <div class="cm-health-section">
                    <h5>📭 Sottocategorie mai utilizzate</h5>
                    <ul class="cm-empty-list">
                        ${unused_subdomains.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // Top categories
        if (top_primary_domains && top_primary_domains.length > 0) {
            html += `
                <div class="cm-health-section">
                    <h5>🏆 Categorie più usate</h5>
                    <div class="cm-top-list">
                        ${top_primary_domains.map(([name, count]) => `
                            <div class="cm-top-item">
                                <span class="cm-top-name">${escapeHtml(name)}</span>
                                <span class="cm-top-count">${count} domande</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Possibili duplicati
        if (possible_duplicates) {
            const { primary_domains: dupePrimaries, subdomains: dupeSubdomains } = possible_duplicates;
            if ((dupePrimaries && dupePrimaries.length > 0) || (dupeSubdomains && dupeSubdomains.length > 0)) {
                html += `
                    <div class="cm-health-section">
                        <h5>🔗 Nomi molto simili (possibili duplicati)</h5>
                `;
                if (dupePrimaries && dupePrimaries.length > 0) {
                    html += `
                        <details>
                            <summary>Categorie principali simili (${dupePrimaries.length})</summary>
                            <div class="cm-dupes-list">
                                ${dupePrimaries.map(d => `
                                    <div class="cm-dupe-item">
                                        <span>${escapeHtml(d.item_a)}</span> <span class="cm-dupe-vs">vs</span> <span>${escapeHtml(d.item_b)}</span>
                                        <span class="cm-dupe-sim">${(d.similarity * 100).toFixed(0)}% simile</span>
                                    </div>
                                `).join('')}
                            </div>
                        </details>
                    `;
                }
                if (dupeSubdomains && dupeSubdomains.length > 0) {
                    html += `
                        <details>
                            <summary>Sottocategorie simili (${dupeSubdomains.length})</summary>
                            <div class="cm-dupes-list">
                                ${dupeSubdomains.map(d => `
                                    <div class="cm-dupe-item">
                                        <span>${escapeHtml(d.primary_domain)}/${escapeHtml(d.item_a)}</span> <span class="cm-dupe-vs">vs</span> <span>${escapeHtml(d.primary_domain)}/${escapeHtml(d.item_b)}</span>
                                        <span class="cm-dupe-sim">${(d.similarity * 100).toFixed(0)}% simile</span>
                                    </div>
                                `).join('')}
                            </div>
                        </details>
                    `;
                }
                html += `</div>`;
            }
        }

        html += `</div>`;
        return html;
    }

    function renderMergeWizard(categories) {
        const { primary_domains, subdomains_by_primary } = categories;

        let html = `
            <div class="cm-merge-wizard">
                <h4>🔀 Unisci Categorie</h4>
                
                <div class="cm-merge-type-toggle">
                    <label class="cm-radio-label">
                        <input type="radio" name="cmMergeType" value="primary_domain" checked>
                        📂 Domini principali
                    </label>
                    <label class="cm-radio-label">
                        <input type="radio" name="cmMergeType" value="subdomain">
                        📁 Sottodomini
                    </label>
                </div>

                <div class="cm-merge-flow">
                    <!-- DA -->
                    <div class="cm-merge-step">
                        <div class="cm-merge-step-header cm-merge-from">
                            <span class="cm-merge-icon">📤</span>
                            <span class="cm-merge-label-text">Unisci DA</span>
                        </div>
                        <select id="cmMergeSource" class="cm-merge-select" required>
                            <option value="">-- Scegli categoria da rimuovere --</option>
                            ${primary_domains.filter(d => d !== 'indefinito').map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
                        </select>
                        <p class="cm-merge-hint">Questa categoria verrà <strong>rimossa</strong> dopo l'unione</p>
                    </div>

                    <!-- Freccia -->
                    <div class="cm-merge-arrow">
                        <span class="cm-arrow-icon">⬇️</span>
                    </div>

                    <!-- IN -->
                    <div class="cm-merge-step">
                        <div class="cm-merge-step-header cm-merge-to">
                            <span class="cm-merge-icon">📥</span>
                            <span class="cm-merge-label-text">Unisci IN</span>
                        </div>
                        <select id="cmMergeTarget" class="cm-merge-select" required>
                            <option value="">-- Scegli categoria destinazione --</option>
                            ${primary_domains.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
                        </select>
                        <p class="cm-merge-hint">Questa categoria <strong>riceverà</strong> tutte le domande</p>
                    </div>
                </div>

                <!-- Subdomain context (hidden by default) -->
                <div class="cm-form-group" id="cmPrimaryDomainGroup" style="display:none;">
                    <label>📂 Dominio principale di riferimento</label>
                    <select id="cmMergePrimaryDomain">
                        ${primary_domains.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
                    </select>
                </div>

                <div id="cmMergePreview"></div>

                <div class="cm-form-actions">
                    <button type="button" id="cmPreviewMergeBtn" class="info small-btn">👁️ Vedi anteprima</button>
                    <button type="submit" id="cmConfirmMergeBtn" class="success small-btn">✅ Conferma unione</button>
                </div>
            </div>
        `;
        return html;
    }

    // ========== EVENT HANDLERS ==========

    function attachMergeWizardHandlers(onMergeComplete, mergeCategoriesData) {
        const typeRadios = document.querySelectorAll('input[name="cmMergeType"]');
        const sourceSelect = document.getElementById('cmMergeSource');
        const targetSelect = document.getElementById('cmMergeTarget');
        const primaryDomainSelect = document.getElementById('cmMergePrimaryDomain');
        const primaryDomainGroup = document.getElementById('cmPrimaryDomainGroup');
        const previewBtn = document.getElementById('cmPreviewMergeBtn');
        const confirmBtn = document.getElementById('cmConfirmMergeBtn');
        const previewContainer = document.getElementById('cmMergePreview');

        // Use mergeCategoriesData (passed from modal) or fall back to window.categories
        const cats = mergeCategoriesData || window.categories || { primary_domains: [], subdomains_by_primary: {} };

        // Get merge type from radio buttons
        function getMergeType() {
            const selected = document.querySelector('input[name="cmMergeType"]:checked');
            return selected ? selected.value : 'primary_domain';
        }

        // Update dropdown options based on merge type
        function updateOptions() {
            const isSubdomain = getMergeType() === 'subdomain';
            if (primaryDomainGroup) primaryDomainGroup.style.display = isSubdomain ? 'block' : 'none';

            if (isSubdomain) {
                const primary = primaryDomainSelect?.value || '';
                const subs = cats.subdomains_by_primary?.[primary] || [];
                if (sourceSelect) {
                    sourceSelect.innerHTML = `<option value="">-- Scegli sottodominio da rimuovere --</option>` +
                        subs.filter(s => s !== 'indefinito').map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
                }
                if (targetSelect) {
                    targetSelect.innerHTML = `<option value="">-- Scegli sottodominio destinazione --</option>` +
                        subs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
                }
            } else {
                const primaries = cats.primary_domains || [];
                if (sourceSelect) {
                    sourceSelect.innerHTML = `<option value="">-- Scegli categoria da rimuovere --</option>` +
                        primaries.filter(d => d !== 'indefinito').map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
                }
                if (targetSelect) {
                    targetSelect.innerHTML = `<option value="">-- Scegli categoria destinazione --</option>` +
                        primaries.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
                }
            }
        }

        // Listen for radio button changes
        typeRadios.forEach(radio => {
            radio?.addEventListener('change', updateOptions);
        });

        // Update subdomains when primary changes
        primaryDomainSelect?.addEventListener('change', updateOptions);

        // Initial setup
        updateOptions();

        // Preview
        previewBtn?.addEventListener('click', async () => {
            const type = getMergeType();
            const source = sourceSelect?.value;
            const target = targetSelect?.value;
            const primaryDomain = type === 'subdomain' ? primaryDomainSelect?.value : '';

            if (!source || !target) {
                alert('Seleziona categoria sorgente e destinazione');
                return;
            }

            try {
                const preview = await previewImpact({
                    operation: 'merge',
                    type,
                    value: source,
                    newValue: target,
                    primaryDomain
                });
                previewContainer.innerHTML = renderPreviewCard(preview);
                confirmBtn.disabled = false;
            } catch (err) {
                previewContainer.innerHTML = `<div class="cm-error-card">❌ ${escapeHtml(err.message)}</div>`;
                confirmBtn.disabled = true;
            }
        });

        // Confirm merge - use form submit or button click
        const mergeForm = document.getElementById('cmMergeForm');
        if (mergeForm) {
            mergeForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await executeMerge();
            });
        }
        
        confirmBtn?.addEventListener('click', async () => {
            await executeMerge();
        });

        async function executeMerge() {
            const type = getMergeType();
            const source = sourceSelect?.value;
            const target = targetSelect?.value;
            const primaryDomain = type === 'subdomain' ? primaryDomainSelect?.value : '';

            if (!source || !target) {
                alert('Seleziona categoria sorgente e destinazione');
                return;
            }

            if (!confirm(`Confermi l'unione: "${source}" → "${target}"?\n\nLa categoria "${source}" verrà rimossa e tutte le sue domande saranno spostate in "${target}".`)) return;

            try {
                confirmBtn.disabled = true;
                confirmBtn.textContent = '⏳ Unione in corso...';

                const result = await mergeCategories({
                    type,
                    sourceValue: source,
                    targetValue: target,
                    primaryDomain: primaryDomain || undefined
                });

                alert(`✅ Unione completata!\n${result.message}\nDomande aggiornate: ${result.updated_questions}`);

                if (onMergeComplete) {
                    onMergeComplete(result);
                }
            } catch (err) {
                alert(`❌ Errore unione: ${err.message}`);
                confirmBtn.disabled = false;
                confirmBtn.textContent = '✅ Conferma unione';
            }
        }
    }

    // ========== TREE + DETAIL MANAGER ==========

    function resetTreeState() {
        treeState = {
            expandedPrimaries: new Set(),
            selectedNode: null,
            searchQuery: '',
            subPage: 1,
            subsPerPage: SUBS_PER_PAGE,
            searchSubQuery: '',
            inlineEdit: null,
            inlineAdd: null,
        };
    }

    function filterPrimaries(categories) {
        let primaries = categories.primary_domains || [];
        if (treeState.searchQuery) {
            const q = treeState.searchQuery.toLowerCase();
            primaries = primaries.filter(p => {
                if (p.toLowerCase().includes(q)) return true;
                const subs = categories.subdomains_by_primary?.[p] || [];
                return subs.some(s => s.toLowerCase().includes(q));
            });
        }
        return primaries;
    }

    function filterSubdomains(subs) {
        if (!treeState.searchSubQuery) return subs;
        const q = treeState.searchSubQuery.toLowerCase();
        return subs.filter(s => s.toLowerCase().includes(q));
    }

    function getPaginatedSubs(subs) {
        const filtered = filterSubdomains(subs);
        const start = (treeState.subPage - 1) * treeState.subsPerPage;
        const end = start + treeState.subsPerPage;
        return {
            items: filtered.slice(start, end),
            total: filtered.length,
            totalPages: Math.ceil(filtered.length / treeState.subsPerPage),
            hasMore: end < filtered.length
        };
    }

    function countQuestionsForPrimary(primaryName) {
        // Will be populated from window.questions if available
        if (!window.questions) return 0;
        return window.questions.filter(q => q.primary_domain === primaryName).length;
    }

    function countQuestionsForSub(primaryName, subName) {
        if (!window.questions) return 0;
        return window.questions.filter(q => q.primary_domain === primaryName && q.subdomain === subName).length;
    }

    function renderManageTree(categories, questions) {
        // Store questions for counts
        window.questions = questions || window.questions || [];

        const primaries = filterPrimaries(categories);
        const totalPrimaries = categories.primary_domains?.length || 0;
        const totalSubs = Object.values(categories.subdomains_by_primary || {}).reduce((acc, subs) => acc + subs.length, 0);
        const totalQuestions = questions?.length || 0;

        let html = `
            <div class="cm-manage-layout">
                <!-- LEFT: Tree Panel -->
                <div class="cm-tree-panel">
                    <div class="cm-tree-header">
                        <h4>🌳 Struttura</h4>
                        <div class="cm-tree-actions">
                            <button class="cm-icon-btn" id="cmExpandAllBtn" title="Espandi tutto">📂</button>
                            <button class="cm-icon-btn" id="cmCollapseAllBtn" title="Comprimi tutto">📁</button>
                        </div>
                    </div>
                    <div class="cm-tree-search">
                        <input type="text" id="cmTreeSearch" placeholder="🔍 Cerca categoria..." value="${escapeHtml(treeState.searchQuery)}">
                    </div>
                    <div class="cm-tree-content" id="cmTreeContent">
        `;

        if (primaries.length === 0) {
            html += `<div class="cm-tree-empty">Nessuna categoria trovata</div>`;
        } else {
            primaries.forEach(primary => {
                const subs = categories.subdomains_by_primary?.[primary] || [];
                const isExpanded = treeState.expandedPrimaries.has(primary);
                const isSelected = treeState.selectedNode?.type === 'primary' && treeState.selectedNode?.name === primary;
                const qCount = countQuestionsForPrimary(primary);

                html += `
                    <div class="cm-tree-node cm-tree-primary ${isExpanded ? 'cm-expanded' : ''} ${isSelected ? 'cm-selected' : ''}" 
                         data-primary="${escapeHtml(primary)}">
                        <div class="cm-tree-node-header" data-action="toggle-primary" data-value="${escapeHtml(primary)}">
                            <span class="cm-tree-toggle">${isExpanded ? '▼' : '▶'}</span>
                            <span class="cm-tree-icon">${primary === 'indefinito' ? '🔒' : '📂'}</span>
                            <span class="cm-tree-label">${escapeHtml(primary)}</span>
                            <span class="cm-tree-badge">${subs.length}</span>
                        </div>
                `;

                if (isExpanded) {
                    html += `<div class="cm-tree-children">`;
                    subs.forEach((sub, idx) => {
                        const isSubSelected = treeState.selectedNode?.type === 'sub' && 
                            treeState.selectedNode?.name === sub && 
                            treeState.selectedNode?.primary === primary;
                        const isLast = idx === subs.length - 1;
                        const subQCount = countQuestionsForSub(primary, sub);

                        html += `
                            <div class="cm-tree-node cm-tree-sub ${isSubSelected ? 'cm-selected' : ''}" 
                                 data-primary="${escapeHtml(primary)}" data-sub="${escapeHtml(sub)}">
                                <div class="cm-tree-node-header" data-action="select-sub" 
                                     data-primary="${escapeHtml(primary)}" data-value="${escapeHtml(sub)}">
                                    <span class="cm-tree-indent"></span>
                                    <span class="cm-tree-connector">${isLast ? '└' : '├'}</span>
                                    <span class="cm-tree-icon">📄</span>
                                    <span class="cm-tree-label">${escapeHtml(sub)}</span>
                                    ${subQCount > 0 ? `<span class="cm-tree-count">${subQCount}</span>` : ''}
                                </div>
                            </div>
                        `;
                    });

                    if (subs.length > SUBS_PER_PAGE && !treeState.searchQuery) {
                        html += `
                            <div class="cm-tree-more">
                                <button data-action="select-primary" data-value="${escapeHtml(primary)}">
                                    ... e altre ${subs.length - SUBS_PER_PAGE} sottocategorie
                                </button>
                            </div>
                        `;
                    }

                    if (primary !== 'indefinito') {
                        if (treeState.inlineAdd?.type === 'sub' && treeState.inlineAdd?.parent === primary) {
                            html += `
                                <div class="cm-tree-inline-add">
                                    <input type="text" id="cmInlineAddInput" placeholder="Nome sottocategoria..." autofocus>
                                    <button class="cm-btn-tiny" data-action="confirm-add-sub">✓</button>
                                    <button class="cm-btn-tiny cm-btn-cancel" data-action="cancel-add">✗</button>
                                </div>
                            `;
                        } else {
                            html += `
                                <div class="cm-tree-add-sub">
                                    <button data-action="add-sub" data-primary="${escapeHtml(primary)}">+ Sottocategoria</button>
                                </div>
                            `;
                        }
                    }

                    html += `</div>`;
                }

                html += `</div>`;
            });
        }

        html += `
                    </div>
                    <div class="cm-tree-footer">
                        <button class="cm-btn-add-primary" data-action="add-primary">+ Nuova categoria principale</button>
                    </div>
                </div>

                <!-- RIGHT: Detail Panel -->
                <div class="cm-detail-panel" id="cmDetailPanel">
                    ${renderDetailPanel(categories)}
                </div>
            </div>

            <!-- Footer stats -->
            <div class="cm-manage-footer">
                <span>${totalPrimaries} categorie</span>
                <span>·</span>
                <span>${totalSubs} sottocategorie</span>
                <span>·</span>
                <span>${totalQuestions} domande</span>
            </div>
        `;

        return html;
    }

    function renderDetailPanel(categories) {
        const node = treeState.selectedNode;
        if (!node) {
            return `
                <div class="cm-detail-empty">
                    <div class="cm-detail-empty-icon">👈</div>
                    <h4>Nessuna selezione</h4>
                    <p>Seleziona una categoria dall'albero per vedere i dettagli e le azioni disponibili</p>
                </div>
            `;
        }

        if (node.type === 'primary') {
            return renderPrimaryDetail(categories, node.name);
        } else if (node.type === 'sub') {
            return renderSubDetail(categories, node.primary, node.name);
        }

        return '';
    }

    function renderPrimaryDetail(categories, primaryName) {
        const subs = categories.subdomains_by_primary?.[primaryName] || [];
        const qCount = countQuestionsForPrimary(primaryName);
        const isLocked = primaryName === 'indefinito';

        // Paginated subs
        const { items: pageSubs, total: totalFiltered, totalPages, hasMore } = getPaginatedSubs(subs);

        let html = `
            <div class="cm-detail-header">
                <div class="cm-detail-title">
                    <span class="cm-detail-icon">${isLocked ? '🔒' : '📂'}</span>
                    <div>
                        <h4>${escapeHtml(primaryName)}</h4>
                        <span class="cm-detail-type">Categoria principale</span>
                    </div>
                </div>
            </div>

            <div class="cm-detail-stats">
                <div class="cm-stat">
                    <span class="cm-stat-value">${qCount}</span>
                    <span class="cm-stat-label">Domande</span>
                </div>
                <div class="cm-stat">
                    <span class="cm-stat-value">${subs.length}</span>
                    <span class="cm-stat-label">Sottocategorie</span>
                </div>
            </div>

            <div class="cm-detail-actions">
                ${!isLocked ? `
                    <button class="cm-action-btn" data-action="rename-primary" data-value="${escapeHtml(primaryName)}">✏️ Rinomina</button>
                    <button class="cm-action-btn" data-action="merge-primary" data-value="${escapeHtml(primaryName)}">🔀 Unisci</button>
                    <button class="cm-action-btn cm-action-danger" data-action="remove-primary" data-value="${escapeHtml(primaryName)}">🗑️ Rimuovi</button>
                ` : `
                    <span class="cm-locked-msg">🔒 Categoria predefinita - non modificabile</span>
                `}
            </div>
        `;

        // Subcategories section
        if (subs.length > 0) {
            html += `
                <div class="cm-detail-section">
                    <div class="cm-detail-section-header">
                        <h5>Sottocategorie (${totalFiltered}${treeState.searchSubQuery ? ' trovate' : ''})</h5>
                        ${subs.length > 5 ? `
                            <div class="cm-sub-search">
                                <input type="text" id="cmSubSearch" placeholder="🔍 Filtra..." value="${escapeHtml(treeState.searchSubQuery)}">
                            </div>
                        ` : ''}
                    </div>
                    <div class="cm-detail-section-content">
            `;

            pageSubs.forEach(sub => {
                const subQCount = countQuestionsForSub(primaryName, sub);
                const isSubLocked = sub === DEFAULT_SUBDOMAIN;
                html += `
                    <div class="cm-sub-row" data-sub="${escapeHtml(sub)}">
                        <div class="cm-sub-info">
                            <span class="cm-sub-icon">📄</span>
                            <span class="cm-sub-name">${escapeHtml(sub)}</span>
                            ${subQCount > 0 ? `<span class="cm-sub-count">${subQCount} dom</span>` : ''}
                        </div>
                        <div class="cm-sub-actions">
                            ${!isSubLocked ? `
                                <button class="cm-icon-btn" data-action="rename-sub" data-primary="${escapeHtml(primaryName)}" data-value="${escapeHtml(sub)}" title="Rinomina">✏️</button>
                                <button class="cm-icon-btn" data-action="remove-sub" data-primary="${escapeHtml(primaryName)}" data-value="${escapeHtml(sub)}" title="Rimuovi">🗑️</button>
                            ` : `<span class="cm-sub-locked-msg">🔒</span>`}
                        </div>
                    </div>
                `;
            });

            // Pagination
            if (totalPages > 1) {
                html += `<div class="cm-pagination">`;
                if (treeState.subPage > 1) {
                    html += `<button class="cm-page-btn" data-action="sub-page" data-page="${treeState.subPage - 1}">← Prec</button>`;
                }
                html += `<span class="cm-page-info">Pag ${treeState.subPage} di ${totalPages}</span>`;
                if (hasMore) {
                    html += `<button class="cm-page-btn" data-action="sub-page" data-page="${treeState.subPage + 1}">Succ →</button>`;
                }
                html += `</div>`;
            }

            html += `</div></div>`;
        }

        // Add subcategory button (inline add is in the tree)
        if (!isLocked) {
            html += `
                <div class="cm-add-section">
                    <button class="cm-action-btn cm-action-add" data-action="add-sub" data-primary="${escapeHtml(primaryName)}">+ Aggiungi sottocategoria</button>
                    <p class="cm-hint">💡 Suggerimento: puoi aggiungere sottocategorie anche direttamente dall'albero a sinistra</p>
                </div>
            `;
        }

        return html;
    }

    function renderSubDetail(categories, primaryName, subName) {
        const qCount = countQuestionsForSub(primaryName, subName);
        const isLocked = subName === DEFAULT_SUBDOMAIN;

        return `
            <div class="cm-detail-header">
                <div class="cm-detail-title">
                    <span class="cm-detail-icon">📄</span>
                    <div>
                        <h4>${escapeHtml(subName)}</h4>
                        <span class="cm-detail-type">Sottocategoria di <strong>${escapeHtml(primaryName)}</strong></span>
                    </div>
                </div>
            </div>

            <div class="cm-detail-stats">
                <div class="cm-stat">
                    <span class="cm-stat-value">${qCount}</span>
                    <span class="cm-stat-label">Domande associate</span>
                </div>
                <div class="cm-stat">
                    <span class="cm-stat-value">${escapeHtml(primaryName)}</span>
                    <span class="cm-stat-label">Categoria principale</span>
                </div>
            </div>

            <div class="cm-detail-actions">
                ${!isLocked ? `
                    <button class="cm-action-btn" data-action="rename-sub" data-primary="${escapeHtml(primaryName)}" data-value="${escapeHtml(subName)}">✏️ Rinomina</button>
                    <button class="cm-action-btn" data-action="merge-sub" data-primary="${escapeHtml(primaryName)}" data-value="${escapeHtml(subName)}">🔀 Unisci</button>
                    <button class="cm-action-btn cm-action-danger" data-action="remove-sub" data-primary="${escapeHtml(primaryName)}" data-value="${escapeHtml(subName)}">🗑️ Rimuovi</button>
                ` : `
                    <span class="cm-locked-msg">🔒 Sottocategoria predefinita - non modificabile</span>
                `}
            </div>

            <div class="cm-detail-nav">
                <button class="cm-btn-sm" data-action="back-to-primary" data-primary="${escapeHtml(primaryName)}">← Torna a ${escapeHtml(primaryName)}</button>
            </div>
        `;
    }

    // ========== TREE EVENT HANDLERS ==========

    function attachTreeHandlers(categories, onRefresh) {
        // Retry a few times to ensure DOM is ready
        let attempts = 0;
        const maxAttempts = 10;

        function tryAttach() {
            attempts++;
            const treeContent = document.getElementById('cmTreeContent');
            const detailPanel = document.getElementById('cmDetailPanel');
            const searchInput = document.getElementById('cmTreeSearch');

            if (!treeContent || !detailPanel) {
                if (attempts < maxAttempts) {
                    setTimeout(tryAttach, 100);
                    return;
                }
                console.error('[Tree] Elements not found after', maxAttempts, 'attempts');
                return;
            }

            // ===== TREE NODE CLICKS =====
            treeContent.addEventListener('click', (e) => {
                const header = e.target.closest('.cm-tree-node-header');

                if (header) {
                    e.preventDefault();
                    e.stopPropagation();
                    const action = header.dataset.action;
                    const value = header.dataset.value;
                    const isToggleBtn = e.target.classList.contains('cm-tree-toggle');

                    // Click on arrow (toggle) → expand/collapse
                    // Click on rest of header → select the node
                    if (action === 'toggle-primary' && value) {
                        if (isToggleBtn) {
                            // Toggle expand/collapse
                            if (treeState.expandedPrimaries.has(value)) {
                                treeState.expandedPrimaries.delete(value);
                            } else {
                                treeState.expandedPrimaries.add(value);
                            }
                            treeState.subPage = 1;
                            treeState.searchSubQuery = '';
                            refreshManageTree(categories, onRefresh);
                        } else {
                            // Click on label → select this primary
                            treeState.selectedNode = { type: 'primary', name: value };
                            if (!treeState.expandedPrimaries.has(value)) {
                                treeState.expandedPrimaries.add(value);
                            }
                            treeState.subPage = 1;
                            refreshManageTree(categories, onRefresh);
                        }
                    } else if (action === 'select-sub') {
                        const primary = header.dataset.primary;
                        treeState.selectedNode = { type: 'sub', name: value, primary };
                        treeState.subPage = 1;
                        refreshManageTree(categories, onRefresh);
                    }
                    return;
                }

                const btn = e.target.closest('button');
                if (btn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const value = btn.dataset.value;
                    const primary = btn.dataset.primary;

                    if (action === 'select-primary' && value) {
                        treeState.selectedNode = { type: 'primary', name: value };
                        treeState.expandedPrimaries.add(value);
                        treeState.subPage = 1;
                        refreshManageTree(categories, onRefresh);
                    } else if (action === 'add-sub' && primary) {
                        treeState.inlineAdd = { type: 'sub', parent: primary };
                        // Ensure the primary is expanded so the inline input is visible in the tree
                        treeState.expandedPrimaries.add(primary);
                        refreshManageTree(categories, onRefresh);
                        setTimeout(() => {
                            const input = document.getElementById('cmInlineAddInput');
                            if (input) input.focus();
                        }, 150);
                    } else if (action === 'confirm-add-sub') {
                        const input = document.getElementById('cmInlineAddInput');
                        const addPrimary = treeState.inlineAdd?.parent;
                        if (input && input.value.trim() && addPrimary) {
                            handleAddSub(addPrimary, input.value.trim()).then(() => {
                                if (onRefresh) onRefresh();
                            });
                        }
                    } else if (action === 'cancel-add') {
                        treeState.inlineAdd = null;
                        refreshManageTree(categories, onRefresh);
                    }
                }
            });

            // ===== DETAIL PANEL CLICKS =====
            detailPanel.addEventListener('click', async (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;

                const action = btn.dataset.action;
                const value = btn.dataset.value;
                const primary = btn.dataset.primary;
                const page = btn.dataset.page ? parseInt(btn.dataset.page) : null;

                try {
                    if (action === 'rename-primary' && value) {
                        const newName = prompt('Nuovo nome per la categoria:', value);
                        if (newName && newName.trim() && newName.trim() !== value) {
                            await handleRename('primary_domain', value, newName.trim());
                            if (onRefresh) await onRefresh();
                        }
                    } else if (action === 'remove-primary' && value) {
                        if (confirm(`Rimuovere "${value}"? Le domande passeranno a "indefinito".`)) {
                            await handleRemove('primary_domain', value);
                            if (onRefresh) await onRefresh();
                        }
                    } else if (action === 'merge-primary' && value) {
                        const mergeTab = document.querySelector('.cm-tab-btn[data-tab="merge"]');
                        if (mergeTab) mergeTab.click();
                    } else if (action === 'rename-sub' && value && primary) {
                        const newName = prompt('Nuovo nome per la sottocategoria:', value);
                        if (newName && newName.trim() && newName.trim() !== value) {
                            await handleRename('subdomain', value, newName.trim(), primary);
                            if (onRefresh) await onRefresh();
                        }
                    } else if (action === 'remove-sub' && value && primary) {
                        if (confirm(`Rimuovere sottocategoria "${value}" da "${primary}"?`)) {
                            await handleRemove('subdomain', value, primary);
                            if (onRefresh) await onRefresh();
                        }
                    } else if (action === 'merge-sub' && value && primary) {
                        treeState.selectedNode = null;
                        const mergeTab = document.querySelector('.cm-tab-btn[data-tab="merge"]');
                        if (mergeTab) mergeTab.click();
                    } else if (action === 'add-sub' && primary) {
                        // Redirect to tree inline add
                        treeState.inlineAdd = { type: 'sub', parent: primary };
                        treeState.expandedPrimaries.add(primary);
                        refreshManageTree(categories, onRefresh);
                        setTimeout(() => {
                            const input = document.getElementById('cmInlineAddInput');
                            if (input) input.focus();
                        }, 150);
                    } else if (action === 'sub-page' && page) {
                        treeState.subPage = page;
                        refreshManageTree(categories, onRefresh);
                    } else if (action === 'back-to-primary' && primary) {
                        treeState.selectedNode = { type: 'primary', name: primary };
                        refreshManageTree(categories, onRefresh);
                    }
                } catch (err) {
                    // Error already handled in handleRename/handleRemove with alert
                    console.log('[Tree] Action error (expected for validation):', err.message);
                }
            });

            // ===== EXPAND/COLLAPSE ALL =====
            document.getElementById('cmExpandAllBtn')?.addEventListener('click', () => {
                if (treeState.expandedPrimaries.size > 0) {
                    treeState.expandedPrimaries.clear();
                } else {
                    categories.primary_domains?.forEach(p => treeState.expandedPrimaries.add(p));
                }
                refreshManageTree(categories, onRefresh);
            });

            document.getElementById('cmCollapseAllBtn')?.addEventListener('click', () => {
                treeState.expandedPrimaries.clear();
                refreshManageTree(categories, onRefresh);
            });

            // ===== ADD PRIMARY FROM FOOTER =====
            document.querySelector('.cm-btn-add-primary')?.addEventListener('click', async () => {
                const name = prompt('Nome della nuova categoria principale:');
                if (name && name.trim()) {
                    try {
                        await handleAddPrimary(name.trim());
                        // Full re-render of modal
                        await onRefresh();
                    } catch (e) {
                        // Error already shown
                    }
                }
            });

            // Shared search handler
            function setupSearchHandler(inputId, stateProperty, callback) {
                let searchTimer;
                const input = document.getElementById(inputId);
                if (!input) return;
                
                input.addEventListener('input', (e) => {
                    const currentValue = e.target.value;
                    const cursorPos = e.target.selectionStart;
                    
                    clearTimeout(searchTimer);
                    searchTimer = setTimeout(() => {
                        treeState[stateProperty] = currentValue.trim();
                        treeState.subPage = 1;
                        
                        if (callback) callback(currentValue);
                        
                        refreshManageTree(categories, onRefresh);
                        
                        setTimeout(() => {
                            const newInput = document.getElementById(inputId);
                            if (newInput) {
                                newInput.focus();
                                // Maintain EXACT cursor position, not just end
                                newInput.setSelectionRange(cursorPos, cursorPos);
                            }
                        }, 10);
                    }, 300);
                });
            }
            
            // ===== TREE SEARCH =====
            setupSearchHandler('cmTreeSearch', 'searchQuery', (value) => {
                if (value.trim()) {
                    categories.primary_domains?.forEach(p => {
                        if (p.toLowerCase().includes(value.toLowerCase().trim())) {
                            treeState.expandedPrimaries.add(p);
                        }
                    });
                }
            });

            // ===== SUB SEARCH =====
            setupSearchHandler('cmSubSearch', 'searchSubQuery');

            // ===== KEYBOARD NAVIGATION =====
            treeContent.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const nodes = Array.from(treeContent.querySelectorAll('.cm-tree-node'));
                    const currentIdx = nodes.findIndex(n => n.classList.contains('cm-selected'));
                    let nextIdx = currentIdx + (e.key === 'ArrowDown' ? 1 : -1);
                    if (nextIdx < 0) nextIdx = nodes.length - 1;
                    if (nextIdx >= nodes.length) nextIdx = 0;
                    if (nodes[nextIdx]) {
                        nodes[nextIdx].querySelector('.cm-tree-node-header')?.click();
                    }
                }
            });

            // ===== INLINE ADD KEYBOARD =====
            setTimeout(() => {
                document.getElementById('cmInlineAddInput')?.addEventListener('keydown', async (e) => {
                    if (e.key === 'Enter') {
                        const primary = treeState.inlineAdd?.parent;
                        if (primary && e.target.value.trim()) {
                            try {
                                await handleAddSub(primary, e.target.value.trim());
                                await onRefresh();
                            } catch (err) {
                                // Error already shown
                            }
                        }
                    } else if (e.key === 'Escape') {
                        treeState.inlineAdd = null;
                        refreshManageTree(categories, onRefresh);
                    }
                });
            }, 100);
        }

        // Start the retry process
        tryAttach();
    }

    // ========== HELPER ACTIONS ==========

    async function handleAddPrimary(name) {
        try {
            const res = await fetch(`${API_BASE}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add', type: 'primary_domain', value: name })
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
            const result = await res.json();
            
            // Update local cache immediately
            if (window.categories) {
                if (!window.categories.primary_domains) window.categories.primary_domains = [];
                window.categories.primary_domains.push(name);
                window.categories.primary_domains.sort();
                if (!window.categories.subdomains_by_primary) window.categories.subdomains_by_primary = {};
                window.categories.subdomains_by_primary[name] = ['indefinito'];
            }
            
            alert(`✅ Categoria "${name}" aggiunta con successo!`);
            return result;
        } catch (err) {
            alert(`❌ Errore: ${err.message}`);
            throw err;
        }
    }

    async function handleAddSub(primary, name) {
        try {
            const res = await fetch(`${API_BASE}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add', type: 'subdomain', value: name, primary_domain: primary })
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
            const result = await res.json();
            treeState.inlineAdd = null;
            
            // Force full state refresh and reindex
            if (window.categories && window.categories.subdomains_by_primary) {
                if (!window.categories.subdomains_by_primary[primary]) {
                    window.categories.subdomains_by_primary[primary] = [];
                }
                window.categories.subdomains_by_primary[primary].push(name);
                window.categories.subdomains_by_primary[primary].sort();
            }
            
            alert(`✅ Sottocategoria "${name}" aggiunta a "${primary}"!`);
            return result;
        } catch (err) {
            alert(`❌ Errore: ${err.message}`);
            throw err;
        }
    }

    async function handleRename(type, oldValue, newName, primary) {
        try {
            const res = await fetch(`${API_BASE}/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, old_value: oldValue, new_value: newName, primary_domain: primary })
            });
            if (!res.ok) {
                const err = await res.json();
                alert(`❌ Errore: ${err.error || 'Rinomina fallita'}`);
                return null;
            }
            return await res.json();
        } catch (err) {
            alert(`❌ Errore: ${err.message}`);
            throw err;
        }
    }

    async function handleRemove(type, value, primary) {
        try {
            const res = await fetch(`${API_BASE}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove', type, value, primary_domain: primary })
            });
            if (!res.ok) {
                const err = await res.json();
                alert(`❌ Errore: ${err.error || 'Rimozione fallita'}`);
                return null;
            }
            treeState.selectedNode = null;
            return await res.json();
        } catch (err) {
            alert(`❌ Errore: ${err.message}`);
            throw err;
        }
    }

    function refreshManageTree(categories, onRefresh) {
        // Remove ALL existing event listeners first to avoid duplicates
        const treeContent = document.getElementById('cmTreeContent');
        const detailPanel = document.getElementById('cmDetailPanel');
        const searchInput = document.getElementById('cmTreeSearch');
        
        if (treeContent) treeContent.replaceWith(treeContent.cloneNode(true));
        if (detailPanel) detailPanel.replaceWith(detailPanel.cloneNode(true));
        if (searchInput) searchInput.replaceWith(searchInput.cloneNode(true));

        // Save current tree state
        const expandedCopy = new Set(treeState.expandedPrimaries);
        const selectedCopy = treeState.selectedNode ? {...treeState.selectedNode} : null;

        // Single render only
        const content = document.getElementById('categoriesContent');
        if (content) {
            content.innerHTML = renderManageTree(categories, window.questions || []);
            // Restore state BEFORE final render
            treeState.expandedPrimaries = expandedCopy;
            treeState.selectedNode = selectedCopy;
            content.innerHTML = renderManageTree(categories, window.questions || []);
            
            // Attach handlers ONCE
            attachTreeHandlers(categories, onRefresh);
        }
    }

    // ========== PUBLIC API ==========

    return {
        fetchHealth,
        previewImpact,
        mergeCategories,
        renderPreviewCard,
        renderHealthDashboard,
        renderMergeWizard,
        attachMergeWizardHandlers,
        renderManageTree,
        attachTreeHandlers,
        resetTreeState,
        refreshManageTree,
        getHealthData: () => currentHealthData
    };
})();

// Esponi globalmente per uso dall'editor
window.CategoriesManager = CategoriesManager;
