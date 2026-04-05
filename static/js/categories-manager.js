/**
 * Categories Manager - Gestione avanzata categorie
 * Preview impatto, merge categorie, dashboard integrità
 */

const CategoriesManager = (() => {
    const API_BASE = '/api/categories';

    // Stato interno
    let currentHealthData = null;
    let previewResult = null;

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

    function attachMergeWizardHandlers(onMergeComplete) {
        const sourceSelect = document.getElementById('cmMergeSource');
        const targetSelect = document.getElementById('cmMergeTarget');
        const primaryDomainSelect = document.getElementById('cmMergePrimaryDomain');
        const primaryDomainGroup = document.getElementById('cmPrimaryDomainGroup');
        const previewBtn = document.getElementById('cmPreviewMergeBtn');
        const confirmBtn = document.getElementById('cmConfirmMergeBtn');
        const previewContainer = document.getElementById('cmMergePreview');

        // Get merge type from radio buttons
        function getMergeType() {
            const selected = document.querySelector('input[name="cmMergeType"]:checked');
            return selected ? selected.value : 'primary_domain';
        }

        // Update dropdown options based on merge type
        function updateOptions() {
            const isSubdomain = getMergeType() === 'subdomain';
            primaryDomainGroup.style.display = isSubdomain ? 'block' : 'none';

            if (isSubdomain) {
                const primary = primaryDomainSelect?.value || '';
                const subs = window.categories?.subdomains_by_primary?.[primary] || [];
                if (sourceSelect) {
                    sourceSelect.innerHTML = `<option value="">-- Scegli sottodominio da rimuovere --</option>` +
                        subs.filter(s => s !== 'indefinito').map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
                }
                if (targetSelect) {
                    targetSelect.innerHTML = `<option value="">-- Scegli sottodominio destinazione --</option>` +
                        subs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
                }
            } else {
                const primaries = window.categories?.primary_domains || [];
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
        document.querySelectorAll('input[name="cmMergeType"]').forEach(radio => {
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

    // ========== PUBLIC API ==========

    return {
        fetchHealth,
        previewImpact,
        mergeCategories,
        renderPreviewCard,
        renderHealthDashboard,
        renderMergeWizard,
        attachMergeWizardHandlers,
        getHealthData: () => currentHealthData
    };
})();

// Esponi globalmente per uso dall'editor
window.CategoriesManager = CategoriesManager;
