// ==================== QUIZ MANAGER ====================

class QuizManagerFrontend {
    constructor() {
        this.currentQuestionIndex = 0;
        this.questions = [];
        this.userAnswers = [];
        this.quizResults = [];
        this.timer = null;
        this.startTime = null;
        this.elapsedTime = 0;
        this.selectedCategories = [];
        this.categoriesData = {};
        this.selectedSubdomainsByPrimary = {};
        this.selectedCount = 10;
        this.availableCount = 0;
        this.usedCount = 0;
        this.quizInProgress = false;

        // Review filter state
        this.currentReviewFilters = { all: true, correct: false, partial: false, wrong: false };
        this.logReviewFilters = { all: true, correct: false, partial: false, wrong: false };

        // Check for active database before initializing
        this.checkDatabaseAndInit();
    }

    checkDatabaseAndInit() {
        fetch('/api/databases/active')
            .then(res => res.json())
            .then(data => {
                // Update active database name in topbar
                const dbName = data.active_database || 'Nessuno';
                const activeDbNameEl = document.getElementById('activeDbName');
                if (activeDbNameEl) {
                    activeDbNameEl.textContent = dbName;
                }

                // Show/hide blocker based on active database
                const blocker = document.getElementById('noDbBlocker');
                if (blocker) {
                    if (!data.active_database) {
                        blocker.style.display = 'flex';
                    } else {
                        blocker.style.display = 'none';
                        // Only initialize if database is active
                        this.initializeEventListeners();
                        this.loadCategories();
                    }
                }
            })
            .catch(err => {
                console.error('Error loading active database:', err);
                const blocker = document.getElementById('noDbBlocker');
                if (blocker) blocker.style.display = 'flex';
            });
    }

    initializeEventListeners() {
        // Help button
        const helpModal = document.getElementById('helpModal');
        const helpClose = helpModal?.querySelector('.close-modal') || helpModal?.querySelector('.close');

        // Support both old and new button for backwards compatibility
        ['btnHelp', 'btnHelpSidebar'].forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn && helpModal) {
                btn.addEventListener('click', () => {
                    helpModal.style.display = 'block';
                });
            }
        });

        if (helpClose) {
            helpClose.addEventListener('click', () => {
                helpModal.style.display = 'none';
            });
        }

        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target === helpModal) {
                helpModal.style.display = 'none';
            }
        });

        // Navigation
        const btnHome = document.getElementById('btnHome');
        if (btnHome) {
            btnHome.addEventListener('click', () => {
                if (this.quizInProgress) {
                    if (confirm('Sei sicuro di voler tornare alla home? Il quiz in corso verrà perso e salvato nel log.')) {
                        this.finishQuiz(true);
                        setTimeout(() => {
                            window.location.href = '/';
                        }, 1000);
                    }
                } else {
                    window.location.href = '/';
                }
            });
        }

        document.getElementById('btnLogs').addEventListener('click', () => {
            if (this.quizInProgress) {
                this.showStatus('Non puoi accedere ai log durante un quiz in corso', 'warning');
                return;
            }
            this.showLogs();
        });

        document.getElementById('btnBackFromLogs').addEventListener('click', () => {
            this.showSetup();
        });

        // Add beforeunload event to warn about page refresh/close
        window.addEventListener('beforeunload', (e) => {
            if (this.quizInProgress) {
                e.preventDefault();
                e.returnValue = 'Il quiz in corso verrà perso. Sei sicuro di voler lasciare la pagina?';
                // Note: We don't save the quiz here because the user might click "Stay"
                // The quiz will be saved only if the user actually leaves
            }
        });

        // Add unload event to save quiz if user actually leaves
        window.addEventListener('unload', () => {
            if (this.quizInProgress) {
                // Use sendBeacon to ensure the request is sent even when page is unloading
                const quizLog = this.prepareQuizLog(true);
                const data = JSON.stringify(quizLog);
                const blob = new Blob([data], { type: 'application/json' });
                navigator.sendBeacon('/api/quiz/save', blob);
            }
        });

        // Category selection - using onclick instead of event delegation

        // Question count selection
        document.querySelectorAll('.count-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.selectCount(e.target);
            });
        });

        document.getElementById('applyCustomCount').addEventListener('click', () => {
            this.applyCustomCount();
        });

        // Handle Enter key for custom count input
        document.getElementById('customCount').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.applyCustomCount();
            }
        });

        // Quiz actions
        document.getElementById('btnStartQuiz').addEventListener('click', () => {
            this.startQuiz();
        });

        document.getElementById('btnSubmitAnswer').addEventListener('click', () => {
            this.submitAnswer();
        });

        document.getElementById('btnNextQuestion').addEventListener('click', () => {
            this.nextQuestion();
        });

        // Results actions
        document.getElementById('btnReview').addEventListener('click', () => {
            this.showReview();
        });

        document.getElementById('btnNewQuiz').addEventListener('click', () => {
            this.showSetup();
        });

        document.getElementById('btnBackHome').addEventListener('click', () => {
            window.location.href = '/';
        });

        document.getElementById('btnEndQuiz').addEventListener('click', () => {
            if (confirm('Sei sicuro di voler terminare il quiz? Il progresso attuale verrà salvato.')) {
                this.finishQuiz();
            }
        });

        document.getElementById('btnBackToResults').addEventListener('click', () => {
            this.showResults();
        });

        document.getElementById('btnBackToLogs').addEventListener('click', () => {
            this.showLogsScreen();
        });

        // Logs actions
        document.getElementById('btnDeleteAllLogs').addEventListener('click', () => {
            this.deleteAllLogs();
        });

        // Review filter pills
        this.initializeReviewFilterPills();
    }

    // ==================== REVIEW FILTERS ====================

    initializeReviewFilterPills() {
        // Current review filter pills
        document.querySelectorAll('#reviewFilterBar .filter-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                this.toggleReviewFilter(e.currentTarget, 'current');
            });
        });

        // Log review filter pills
        document.querySelectorAll('#logReviewFilterBar .filter-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                this.toggleReviewFilter(e.currentTarget, 'log');
            });
        });
    }

    toggleReviewFilter(pill, reviewType) {
        const filterType = pill.dataset.filter;
        const filters = reviewType === 'current' ? this.currentReviewFilters : this.logReviewFilters;
        const barId = reviewType === 'current' ? '#reviewFilterBar' : '#logReviewFilterBar';

        if (filterType === 'all') {
            // Toggle "all": if not active, activate it and deactivate others
            if (!filters.all) {
                filters.all = true;
                filters.correct = false;
                filters.partial = false;
                filters.wrong = false;
            }
            // If already active, do nothing (keep at least one filter active)
        } else {
            // Toggle specific filter
            filters[filterType] = !filters[filterType];

            // If all non-"all" filters are off, turn "all" on
            if (!filters.correct && !filters.partial && !filters.wrong) {
                filters.all = true;
            } else {
                filters.all = false;
            }
        }

        // Update pill UI
        document.querySelectorAll(`${barId} .filter-pill`).forEach(p => {
            p.classList.toggle('active', filters[p.dataset.filter]);
        });

        // Apply filters
        this.applyReviewFilters(reviewType);
    }

    applyReviewFilters(reviewType) {
        const filters = reviewType === 'current' ? this.currentReviewFilters : this.logReviewFilters;
        const containerId = reviewType === 'current' ? 'reviewContainer' : 'logReviewContainer';
        const container = document.getElementById(containerId);
        if (!container) return;

        const questionElements = container.querySelectorAll('.review-question');
        let visibleCount = 0;

        questionElements.forEach(el => {
            if (filters.all) {
                el.style.display = '';
                visibleCount++;
                return;
            }

            const isCorrect = el.classList.contains('correct');
            const isPartial = el.classList.contains('partial');
            const isWrong = el.classList.contains('wrong') || el.classList.contains('unanswered');

            const show = (filters.correct && isCorrect) || (filters.partial && isPartial) || (filters.wrong && isWrong);
            el.style.display = show ? '' : 'none';
            if (show) visibleCount++;
        });

        // Show "no results" message if nothing visible
        let noResultsMsg = container.querySelector('.review-no-results');
        if (visibleCount === 0) {
            if (!noResultsMsg) {
                noResultsMsg = document.createElement('div');
                noResultsMsg.className = 'review-no-results';
                noResultsMsg.textContent = 'Nessuna domanda corrisponde ai filtri selezionati.';
                container.appendChild(noResultsMsg);
            }
            noResultsMsg.style.display = 'block';
        } else if (noResultsMsg) {
            noResultsMsg.style.display = 'none';
        }
    }

    // ==================== CATEGORIES ====================

    async loadCategories() {
        try {
            const response = await fetch('/api/quiz/categories');
            const categories = await response.json();
            this.categoriesData = categories || {};
            
            this.renderCategories(categories);
            this.updateCategoryCount();
        } catch (error) {
            console.error('Errore nel caricamento delle categorie:', error);
            this.showStatus('Errore nel caricamento delle categorie', 'error');
        }
    }

    renderCategories(categories) {
        const container = document.getElementById('categoriesContainer');
        container.innerHTML = '';

        // Reset state selezioni
        this.selectedCategories = [];
        this.selectedSubdomainsByPrimary = {};

        // Create "All" button with onclick
        const allBtn = document.createElement('button');
        allBtn.className = 'category-btn all';
        allBtn.dataset.category = 'all';
        allBtn.innerHTML = `
            <span class="category-name">Tutte le categorie</span>
            <span class="category-count">${Object.values(categories).reduce((sum, cat) => sum + cat.count, 0)}</span>
        `;
        allBtn.onclick = () => this.toggleCategory('all');
        container.appendChild(allBtn);

        // Create individual category buttons with onclick
        for (const [categoryName, categoryData] of Object.entries(categories)) {
            const btn = document.createElement('button');
            btn.className = 'category-btn';
            btn.dataset.category = categoryName;
            btn.innerHTML = `
                <span class="category-name">${categoryName}</span>
                <span class="category-count">${categoryData.count}</span>
            `;
            btn.onclick = () => this.toggleCategory(categoryName);
            container.appendChild(btn);
        }

        // Assicura area sottodomini
        let subdomainsContainer = document.getElementById('subdomainsContainer');
        if (!subdomainsContainer) {
            subdomainsContainer = document.createElement('div');
            subdomainsContainer.id = 'subdomainsContainer';
            subdomainsContainer.className = 'categories-grid';
            subdomainsContainer.style.marginTop = '12px';
            subdomainsContainer.style.display = 'none';
            container.insertAdjacentElement('afterend', subdomainsContainer);
        }

        this.renderSubdomains();
    }

    getSubdomainsForPrimary(primaryDomain) {
        const cat = this.categoriesData?.[primaryDomain];
        if (!cat || !cat.subdomains) return [];
        return Object.keys(cat.subdomains);
    }

    ensureSubdomainSelectionForPrimary(primaryDomain) {
        if (!this.selectedSubdomainsByPrimary[primaryDomain]) {
            this.selectedSubdomainsByPrimary[primaryDomain] = this.getSubdomainsForPrimary(primaryDomain);
        }
    }

    renderSubdomains() {
        const container = document.getElementById('subdomainsContainer');
        const info = document.getElementById('selectedSubdomainsInfo');
        if (!container) return;

        const selectedPrimary = this.selectedCategories.filter(c => c !== 'all');
        if (selectedPrimary.length === 0) {
            container.style.display = 'none';
            container.innerHTML = '';
            if (info) info.style.display = 'none';
            this.updateSubdomainCount();
            return;
        }

        container.style.display = 'grid';
        let html = '';
        selectedPrimary.forEach(primary => {
            this.ensureSubdomainSelectionForPrimary(primary);
            const allSubs = this.getSubdomainsForPrimary(primary);
            const selectedSubs = this.selectedSubdomainsByPrimary[primary] || [];

            html += `
                <div class="category-group-label" data-primary="${primary}"><strong>${primary}</strong></div>
            `;
            allSubs.forEach(sub => {
                const checked = selectedSubs.includes(sub) ? 'selected' : '';
                const count = this.categoriesData?.[primary]?.subdomains?.[sub] || 0;
                html += `
                    <button class="category-btn subdomain-btn ${checked}" data-primary="${primary}" data-subdomain="${sub}">
                        <span class="category-name">${sub}</span>
                        <span class="category-count">${count}</span>
                    </button>
                `;
            });
        });

        container.innerHTML = html;

        container.querySelectorAll('.subdomain-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const primary = btn.dataset.primary;
                const sub = btn.dataset.subdomain;
                this.toggleSubdomain(primary, sub);
            });
        });

        if (info) info.style.display = 'block';
        this.updateSubdomainCount();
    }

    toggleSubdomain(primary, subdomain) {
        this.ensureSubdomainSelectionForPrimary(primary);
        const list = this.selectedSubdomainsByPrimary[primary] || [];
        const idx = list.indexOf(subdomain);
        if (idx >= 0) {
            list.splice(idx, 1);
        } else {
            list.push(subdomain);
        }
        this.selectedSubdomainsByPrimary[primary] = list;

        this.renderSubdomains();
        this.updateSubdomainCount();
        this.updateAvailableQuestions();
    }

    updateSubdomainCount() {
        let count = 0;
        if (this.selectedCategories.includes('all')) {
            // Count all subdomains across all categories
            for (const primary of Object.keys(this.categoriesData || {})) {
                const list = this.selectedSubdomainsByPrimary[primary] || this.getSubdomainsForPrimary(primary);
                count += list.length;
            }
        } else {
            this.selectedCategories.forEach(primary => {
                const list = this.selectedSubdomainsByPrimary[primary] || [];
                count += list.length;
            });
        }
        const countEl = document.getElementById('selectedSubdomainsCount');
        const badgeEl = document.querySelector('.info-badge.info-subdomains');
        const labelEl = document.getElementById('selectedSubdomainsLabel');
        if (countEl) countEl.textContent = count;
        if (labelEl) labelEl.textContent = count === 1 ? 'sottocategoria' : 'sottocategorie';
        if (badgeEl) {
            badgeEl.style.display = count > 0 ? 'inline-flex' : 'none';
        }
    }

    toggleCategory(category) {
        if (category === 'all') {
            // Handle "All" button
            const allBtn = document.querySelector('.category-btn.all');
            const wasSelected = allBtn.classList.contains('selected');
            
            // Clear all selections first
            document.querySelectorAll('.category-btn').forEach(b => {
                b.classList.remove('selected');
            });
            
            if (!wasSelected) {
                // Select "All"
                allBtn.classList.add('selected');
                this.selectedCategories = ['all'];

                // Seleziona tutti i sottodomini disponibili per ogni primary
                this.selectedSubdomainsByPrimary = {};
                Object.keys(this.categoriesData || {}).forEach(primary => {
                    this.selectedSubdomainsByPrimary[primary] = this.getSubdomainsForPrimary(primary);
                });
            } else {
                // Deselect "All"
                this.selectedCategories = [];
                this.selectedSubdomainsByPrimary = {};
            }
        } else {
            // Handle individual category
            const allBtn = document.querySelector('.category-btn.all');
            allBtn.classList.remove('selected');
            
            // Find the button
            const btn = document.querySelector(`.category-btn[data-category="${category}"]`);
            if (!btn) return;
            
            // Check if already selected
            const isSelected = btn.classList.contains('selected');
            
            if (isSelected) {
                // Deselect
                btn.classList.remove('selected');
                this.selectedCategories = this.selectedCategories.filter(c => c !== category);
                delete this.selectedSubdomainsByPrimary[category];
            } else {
                // Select
                btn.classList.add('selected');
                if (!this.selectedCategories.includes(category)) {
                    this.selectedCategories.push(category);
                }
                this.ensureSubdomainSelectionForPrimary(category);
            }
            
            // Remove 'all' from selection
            this.selectedCategories = this.selectedCategories.filter(c => c !== 'all');
        }

        this.renderSubdomains();
        
        this.updateCategoryCount();
        this.updateAvailableQuestions();
    }

    updateCategoryCount() {
        let count = this.selectedCategories.length;
        if (this.selectedCategories.includes('all')) {
            count = Object.keys(this.categoriesData || {}).length;
        }
        const el = document.getElementById('selectedCategoriesCount');
        if (el) el.textContent = count;
        const labelEl = document.getElementById('selectedCategoriesLabel');
        if (labelEl) labelEl.textContent = count === 1 ? 'categoria' : 'categorie';

        // Enable/disable start button
        const startBtn = document.getElementById('btnStartQuiz');
        startBtn.disabled = count === 0;
    }

    // ==================== QUESTION COUNT ====================

    selectCount(btn) {
        // Remove selection from all buttons
        document.querySelectorAll('.count-btn').forEach(b => {
            b.classList.remove('selected');
        });
        
        // Select clicked button
        btn.classList.add('selected');
        
        const count = btn.dataset.count;
        if (count === 'all') {
            this.selectedCount = -1;
        } else {
            this.selectedCount = parseInt(count);
        }

        this.updateCountDisplay();
        this.updateAvailableQuestions();
    }

    applyCustomCount() {
        const customInput = document.getElementById('customCount');
        const value = parseInt(customInput.value, 10);

        if (value && value > 0 && value <= 1000) {
            this.selectedCount = value;

            // Remove selection from preset buttons
            document.querySelectorAll('.count-btn').forEach(b => {
                b.classList.remove('selected');
            });

            this.updateCountDisplay();
            this.updateAvailableQuestions();
        } else {
            // Invalid input - clear and show feedback
            customInput.style.borderColor = '#dc3545';
            customInput.style.boxShadow = '0 0 0 3px rgba(220, 53, 69, 0.15)';
            setTimeout(() => {
                customInput.style.borderColor = '#cbd5e1';
                customInput.style.boxShadow = 'none';
            }, 2000);
        }
    }

    updateCountDisplay() {
        const countEl = document.getElementById('selectedCount');
        const labelEl = document.getElementById('selectedCountLabel');
        if (this.selectedCount === -1) {
            if (countEl) countEl.textContent = '';
            if (labelEl) labelEl.textContent = 'Tutte le domande';
        } else {
            if (countEl) countEl.textContent = this.selectedCount;
            if (labelEl) labelEl.textContent = this.selectedCount === 1 ? 'domanda' : 'domande';
        }
    }

    async updateAvailableQuestions() {
        if (this.selectedCategories.length === 0) {
            document.getElementById('availableQuestions').textContent = '--';
            document.getElementById('questionsToUse').textContent = '--';
            return;
        }

        try {
            const response = await fetch('/api/quiz/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    categories: this.selectedCategories,
                    num_questions: this.selectedCount,
                    subdomains_by_primary: this.selectedSubdomainsByPrimary
                })
            });

            if (response.ok) {
                const data = await response.json();
                this.availableCount = data.available_count;
                this.usedCount = data.used_count;
                
                document.getElementById('availableQuestions').textContent = this.availableCount;
                document.getElementById('questionsToUse').textContent = this.usedCount;
            } else {
                const error = await response.json();
                document.getElementById('availableQuestions').textContent = '0';
                document.getElementById('questionsToUse').textContent = '0';
                
                if (error.available_count === 0) {
                    this.showStatus('Nessuna domanda disponibile per le categorie selezionate', 'warning');
                }
            }
        } catch (error) {
            console.error('Errore nell\'aggiornamento delle domande disponibili:', error);
        }
    }

    // ==================== QUIZ GAME ====================

    async startQuiz() {
        if (this.selectedCategories.length === 0) {
            this.showStatus('Seleziona almeno una categoria', 'warning');
            return;
        }

        try {
            this.showStatus('Caricamento quiz...', 'info');
            
            const response = await fetch('/api/quiz/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    categories: this.selectedCategories,
                    num_questions: this.selectedCount,
                    subdomains_by_primary: this.selectedSubdomainsByPrimary
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Errore nell\'avvio del quiz');
            }

            const data = await response.json();
            
            if (data.questions.length === 0) {
                this.showStatus('Nessuna domanda disponibile', 'warning');
                return;
            }

            this.questions = data.questions;
            this.userAnswers = new Array(this.questions.length).fill(null);
            this.quizResults = new Array(this.questions.length).fill(null);
            this.currentQuestionIndex = 0;
            this.quizInProgress = true;
            
            // Initialize timer
            this.startTime = Date.now();
            this.elapsedTime = 0;
            this.startTimer();

            // Show end quiz button, hide logs button during quiz
            const btnEndQuiz = document.getElementById('btnEndQuiz');
            if (btnEndQuiz) btnEndQuiz.style.display = '';
            const btnLogs = document.getElementById('btnLogs');
            if (btnLogs) btnLogs.style.display = 'none';

            // Show quiz screen
            this.showQuiz();
            this.displayQuestion();
            
            this.showStatus('Quiz avviato!', 'success');
            
        } catch (error) {
            console.error('Errore nell\'avvio del quiz:', error);
            this.showStatus(error.message, 'error');
        }
    }

    displayQuestion() {
        const question = this.questions[this.currentQuestionIndex];
        
        // Update progress
        document.getElementById('currentQuestion').textContent = this.currentQuestionIndex + 1;
        document.getElementById('totalQuestions').textContent = this.questions.length;
        
        // Update question text
        document.getElementById('questionText').textContent = question.raw_text;

        // Render answers
        this.renderAnswers(question);

        // Reset UI
        const submitBtn = document.getElementById('btnSubmitAnswer');
        const nextBtn = document.getElementById('btnNextQuestion');
        const feedbackContainer = document.getElementById('feedbackContainer');
        
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.style.display = 'block';
        }
        if (nextBtn) {
            nextBtn.style.display = 'none';
        }
        if (feedbackContainer) {
            feedbackContainer.style.display = 'none';
        }
        
        // Update score display
        this.updateScoreDisplay();
    }

    renderAnswers(question) {
        const container = document.getElementById('answersContainer');
        container.innerHTML = '';
        
        const answers = question.answers;
        const letters = Object.keys(answers).sort();
        
        letters.forEach(letter => {
            const answerDiv = document.createElement('div');
            answerDiv.className = 'answer-option';
            answerDiv.dataset.letter = letter;

            answerDiv.innerHTML = `
                <input type="checkbox" value="${letter}" style="position: absolute; opacity: 0; pointer-events: none;">
                <span class="answer-letter">${letter}</span>
                <span class="answer-text">${answers[letter]}</span>
            `;

            // Add click handler
            answerDiv.addEventListener('click', (e) => {
                // Check if answers are disabled (during feedback)
                if (answerDiv.classList.contains('disabled')) {
                    return;
                }

                const checkbox = answerDiv.querySelector('input[type="checkbox"]');
                checkbox.checked = !checkbox.checked;
                this.toggleAnswerSelection(answerDiv);
                this.updateSubmitButton();
            });

            container.appendChild(answerDiv);
        });
    }

    toggleAnswerSelection(answerDiv) {
        const checkbox = answerDiv.querySelector('input[type="checkbox"]');
        
        if (checkbox.checked) {
            answerDiv.classList.add('selected');
        } else {
            answerDiv.classList.remove('selected');
        }
    }

    updateSubmitButton() {
        const submitBtn = document.getElementById('btnSubmitAnswer');
        submitBtn.disabled = false;
    }

    getSelectedAnswers() {
        const checkboxes = document.querySelectorAll('#answersContainer input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    async submitAnswer() {
        const selectedAnswers = this.getSelectedAnswers();
        const question = this.questions[this.currentQuestionIndex];

        // Allow proceeding without answers (marks as wrong)
        const isEmpty = selectedAnswers.length === 0;

        try {
            const response = await fetch('/api/quiz/validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    question_id: question.id,
                    user_answers: selectedAnswers
                })
            });

            if (!response.ok) {
                throw new Error('Errore nella validazione della risposta');
            }

            const result = await response.json();

            // If no answers were selected, force wrong result
            if (isEmpty) {
                result.is_correct = false;
                result.is_partial = false;
                result.feedback = 'Nessuna risposta selezionata';
                result.correct_answers = result.correct_answers || [];
                result.score = 0.0;
            }
            
            // Store user answer and result
            this.userAnswers[this.currentQuestionIndex] = selectedAnswers;
            this.quizResults[this.currentQuestionIndex] = result;
            
            // Show feedback
            this.showFeedback(result);
            
            // Update answer options styling
            this.styleAnswerOptions(result);
            
            // Update score display
            this.updateScoreDisplay();
            
            // Show next button
            document.getElementById('btnSubmitAnswer').style.display = 'none';
            document.getElementById('btnNextQuestion').style.display = 'block';
            
            // Update next button text
            const nextBtn = document.getElementById('btnNextQuestion');
            if (this.currentQuestionIndex === this.questions.length - 1) {
                nextBtn.textContent = 'Termina Quiz';
            } else {
                nextBtn.textContent = 'Prossima Domanda →';
            }
            
        } catch (error) {
            console.error('Errore nell\'invio della risposta:', error);
            this.showStatus('Errore nell\'invio della risposta', 'error');
        }
    }

    showFeedback(result) {
        const feedbackContainer = document.getElementById('feedbackContainer');
        const feedbackMessage = document.getElementById('feedbackMessage');
        const correctAnswers = document.getElementById('correctAnswers');
        
        feedbackContainer.style.display = 'block';
        
        // Set feedback message and style
        feedbackContainer.className = 'feedback-container';
        
        if (result.is_correct) {
            feedbackContainer.classList.add('correct');
            feedbackMessage.innerHTML = '<strong>Risposta Corretta</strong>';
        } else if (result.is_partial) {
            feedbackContainer.classList.add('partial');
            feedbackMessage.innerHTML = '<strong>Risposta Parziale</strong>';
        } else {
            feedbackContainer.classList.add('wrong');
            feedbackMessage.innerHTML = '<strong>Risposta Sbagliata</strong>';
        }
        
        // Show correct answers
        let feedbackContent = '';
        if (result.correct_answers && result.correct_answers.length > 0) {
            feedbackContent += `<strong>Risposte corrette:</strong> ${result.correct_answers.join(', ')}`;
        }
        
        // Show notes if available
        const question = this.questions[this.currentQuestionIndex];
        if (question.notes && question.notes.trim()) {
            if (feedbackContent) feedbackContent += '<br><br>';
            feedbackContent += `<strong>Note:</strong> ${question.notes}`;
        }
        
        correctAnswers.innerHTML = feedbackContent;
    }

    styleAnswerOptions(result) {
        const answerOptions = document.querySelectorAll('.answer-option');
        const correctAnswers = result.correct_answers || [];
        const userAnswers = this.userAnswers[this.currentQuestionIndex] || [];
        
        answerOptions.forEach(option => {
            const letter = option.dataset.letter;
            const checkbox = option.querySelector('input[type="checkbox"]');
            
            // Disable all checkboxes
            checkbox.disabled = true;
            
            // Add disabled class to prevent click
            option.classList.add('disabled');
            
            // Remove previous styling
            option.classList.remove('correct', 'wrong', 'selected');
            
            // Apply new styling
            if (correctAnswers.includes(letter)) {
                option.classList.add('correct');
            } else if (userAnswers.includes(letter)) {
                option.classList.add('wrong');
            }
        });
    }

    updateScoreDisplay() {
        const correct = this.quizResults.filter(r => r && r.is_correct).length;
        const partial = this.quizResults.filter(r => r && r.is_partial).length;
        const wrong = this.quizResults.filter(r => r && !r.is_correct && !r.is_partial).length;
        
        // Calcola punteggio totale con pesi proporzionali
        const totalScore = this.quizResults.reduce((sum, r) => {
            return sum + (r && r.score !== undefined ? r.score : 0);
        }, 0);
        
        document.getElementById('correctCount').textContent = correct;
        document.getElementById('partialCount').textContent = partial;
        document.getElementById('wrongCount').textContent = wrong;
    }

    nextQuestion() {
        if (this.currentQuestionIndex < this.questions.length - 1) {
            this.currentQuestionIndex++;
            this.displayQuestion();
            
            // Reset submit button
            document.getElementById('btnSubmitAnswer').style.display = 'block';
            document.getElementById('btnNextQuestion').style.display = 'none';
        } else {
            // Quiz completed
            this.finishQuiz();
        }
    }

    prepareQuizLog(interrupted = false) {
        // Calculate final results
        const totalQuestions = this.questions.length;
        const answeredQuestions = this.quizResults.filter(r => r !== null).length;
        const correctAnswers = this.quizResults.filter(r => r && r.is_correct).length;
        const partialAnswers = this.quizResults.filter(r => r && r.is_partial).length;
        const wrongAnswers = this.quizResults.filter(r => r && !r.is_correct && !r.is_partial).length;
        const unansweredQuestions = totalQuestions - answeredQuestions;
        
        // Calcola punteggio totale con pesi proporzionali
        const totalScore = this.quizResults.reduce((sum, r) => {
            return sum + (r && r.score !== undefined ? r.score : 0);
        }, 0);
        
        const scorePercentage = answeredQuestions > 0 ? Math.round((totalScore / answeredQuestions) * 100) : 0;

        // Expand "all" to actual categories for the log
        let actualCategories = [...this.selectedCategories];
        if (actualCategories.includes('all')) {
            actualCategories = Object.keys(this.categoriesData || {});
        }

        // Prepare quiz log data
        return {
            categories_selected: actualCategories,
            subdomains_by_primary_selected: this.selectedSubdomainsByPrimary,
            total_questions_requested: this.selectedCount,
            total_questions_available: this.availableCount,
            total_questions_used: this.usedCount,
            correct_answers: correctAnswers,
            partial_answers: partialAnswers,
            wrong_answers: wrongAnswers,
            unanswered_questions: unansweredQuestions,
            score_percentage: scorePercentage,
            total_time_seconds: Math.floor(this.elapsedTime / 1000),
            average_time_per_question: answeredQuestions > 0 ? Math.round((this.elapsedTime / 1000) / answeredQuestions) : 0,
            interrupted: interrupted,
             questions: this.questions.map((q, index) => ({
                id: q.id,
                text: q.raw_text,
                all_answers: q.answers,
                correct_answers: this.quizResults[index]?.correct_answers || [],
                user_answers: this.userAnswers[index] || [],
                is_correct: this.quizResults[index]?.is_correct || false,
                is_partial: this.quizResults[index]?.is_partial || false,
                is_unanswered: this.quizResults[index] === null,
                score: this.quizResults[index]?.score || 0,
                time_spent_seconds: this.quizResults[index] ? Math.round((this.elapsedTime / 1000) / answeredQuestions) : 0,
                feedback: this.quizResults[index]?.feedback || 'no_answer'
            }))
        };
    }

    async finishQuiz(interrupted = false) {
        // Stop timer
        this.stopTimer();
        
        // Prepare quiz log data
        const quizLog = this.prepareQuizLog(interrupted);
        
        // Save quiz log
        try {
            const response = await fetch('/api/quiz/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(quizLog)
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('Quiz log saved:', result.quiz_id);
            }
        } catch (error) {
            console.error('Errore nel salvataggio del log del quiz:', error);
        }
        
        // Show results
        this.showResultsScreen(quizLog.correct_answers, quizLog.partial_answers, quizLog.wrong_answers, quizLog.score_percentage, interrupted);
    }

    showResultsScreen(correct, partial, wrong, score, interrupted = false) {
        const totalQuestions = this.questions.length;
        const totalTime = this.elapsedTime;
        const answeredQuestions = correct + partial + wrong;
        const avgTime = answeredQuestions > 0 ? totalTime / answeredQuestions : 0;
        
        // Calcola punteggio dettagliato
        const totalScore = this.quizResults.reduce((sum, r) => {
            return sum + (r && r.score !== undefined ? r.score : 0);
        }, 0);
        
        document.getElementById('finalScore').textContent = `${score}%`;
        document.getElementById('finalCorrect').textContent = correct;
        document.getElementById('finalPartial').textContent = partial;
        document.getElementById('finalWrong').textContent = wrong;
        document.getElementById('finalTime').textContent = this.formatTime(totalTime);
        document.getElementById('avgTime').textContent = this.formatTime(avgTime);
        
        // Add interrupted message if quiz was interrupted
        if (interrupted) {
            const resultsCard = document.querySelector('.results-card h2');
            resultsCard.textContent = '⚠️ Quiz Interrotto!';
        }
        
        this.quizInProgress = false;
        this.showResults();
    }

    // ==================== TIMER ====================

    startTimer() {
        this.timer = setInterval(() => {
            this.elapsedTime = Date.now() - this.startTime;
            document.getElementById('timer').textContent = this.formatTime(this.elapsedTime);
        }, 1000);
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // ==================== REVIEW ====================

    showReview() {
        // Reset filters to "all"
        this.currentReviewFilters = { all: true, correct: false, partial: false, wrong: false };
        document.querySelectorAll('#reviewFilterBar .filter-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.filter === 'all');
        });

        const container = document.getElementById('reviewContainer');
        container.innerHTML = '';
        
        this.questions.forEach((question, index) => {
            const result = this.quizResults[index];
            const userAnswer = this.userAnswers[index];
            
            const reviewDiv = document.createElement('div');
            reviewDiv.className = 'review-question';
            
            // Determine status class
            let statusClass = 'unanswered';
            if (result) {
                if (result.is_correct) statusClass = 'correct';
                else if (result.is_partial) statusClass = 'partial';
                else statusClass = 'wrong';
            }

            reviewDiv.classList.add(statusClass);

            const statusLabel = result?.is_correct ? 'Corretta' : result?.is_partial ? 'Parziale' : result ? 'Sbagliata' : 'Non risposta';
            const statusSvg = result?.is_correct
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
                : result?.is_partial
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>'
                : result
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
                : '';

            // Calcola punteggio per questa domanda
            const questionScore = result?.score !== undefined ? Math.round(result.score * 100) : 0;
            
            reviewDiv.innerHTML = `
                <div class="review-header">
                    <span class="review-number">Domanda ${index + 1}</span>
                    <span class="review-status ${statusClass}">${statusSvg} ${statusLabel} (${questionScore}%)</span>
                </div>
                <div class="review-question-text">${question.raw_text}</div>
                <div class="review-answers">
                    ${Object.entries(question.answers).map(([letter, text]) => {
                        const isCorrect = result?.correct_answers?.includes(letter);
                        const isUserSelected = userAnswer?.includes(letter);
                        let className = 'review-answer';
                        if (isCorrect) className += ' correct';
                        if (isUserSelected && !isCorrect) className += ' wrong';
                        if (isUserSelected) className += ' selected';

                        return `
                            <div class="${className}">
                                <span class="review-answer-letter">${letter}.</span>
                                <span class="review-answer-text">${text}</span>
                                ${isCorrect ? '<span class="correct-marker"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
                                ${isUserSelected ? '<span class="user-marker"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg></span>' : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="review-feedback">
                    <strong>Risposte corrette:</strong> ${result?.correct_answers?.join(', ') || 'Nessuna'}
                </div>
            `;
            
            container.appendChild(reviewDiv);
        });
        
        this.showReviewScreen();
    }

    // ==================== LOGS ====================

    async showLogs() {
        try {
            const response = await fetch('/api/quiz/logs');
            const data = await response.json();
            
            this.renderLogs(data.logs);
            this.showLogsScreen();
        } catch (error) {
            console.error('Errore nel caricamento dei log:', error);
            this.showStatus('Errore nel caricamento dei log', 'error');
        }
    }

    renderLogs(logs) {
        const container = document.getElementById('logsContainer');
        container.innerHTML = '';
        
        if (logs.length === 0) {
            container.innerHTML = '<div class="no-logs">Nessun quiz completato ancora</div>';
            return;
        }
        
        logs.forEach(log => {
            const logDiv = document.createElement('div');
            logDiv.className = 'log-item';
            
            const date = new Date(log.date);
            const formattedDate = date.toLocaleDateString('it-IT', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            let scoreClass = '';
            if (log.score_percentage < 40) scoreClass = 'low';
            else if (log.score_percentage < 70) scoreClass = 'medium';
            else scoreClass = 'high';
            
            logDiv.innerHTML = `
                <div class="log-header">
                    <span class="log-date">${formattedDate}</span>
                    <span class="score-badge ${scoreClass}">${log.score_percentage}%</span>
                </div>
                <div class="log-details">
                    <span>Categorie: ${log.categories.join(', ')}</span>
                    <span>Domande: ${log.total_questions}</span>
                    <span>Corrette: ${log.correct_answers}</span>
                    <span>Tempo: ${this.formatTime(log.total_time_seconds * 1000)}</span>
                    </div>
                </div>
                <div class="log-actions">
                    <button class="log-btn view" data-log-id="${log.id}">Visualizza</button>
                    <button class="log-btn delete" data-log-id="${log.id}">Elimina</button>
                </div>
            `;
            
            container.appendChild(logDiv);
        });
        
        // Add event listeners
        container.querySelectorAll('.log-btn.view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const logId = e.target.dataset.logId;
                this.viewLogDetail(logId);
            });
        });
        
        container.querySelectorAll('.log-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const logId = e.target.dataset.logId;
                this.deleteLog(logId);
            });
        });
    }

    async viewLogDetail(logId) {
        try {
            const response = await fetch(`/api/quiz/logs/${logId}`);
            const logData = await response.json();
            
            // Show log review screen
            this.showLogReview(logData);
            
        } catch (error) {
            console.error('Errore nel caricamento del dettaglio del log:', error);
            this.showStatus('Errore nel caricamento del dettaglio', 'error');
        }
    }

    showLogReview(logData) {
        // Reset filters to "all"
        this.logReviewFilters = { all: true, correct: false, partial: false, wrong: false };
        document.querySelectorAll('#logReviewFilterBar .filter-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.filter === 'all');
        });

        const container = document.getElementById('logReviewContainer');
        container.innerHTML = '';
        
        // Add summary
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'log-review-summary';
        summaryDiv.innerHTML = `
            <div class="log-review-header">
                <h3>Quiz del ${new Date(logData.date).toLocaleDateString('it-IT', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}</h3>
                <div class="log-review-stats">
                    <span class="stat-item stat-score">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/></svg>
                        Punteggio: <strong>${logData.score_percentage}%</strong>
                    </span>
                    <span class="stat-item stat-correct">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Corrette: <strong>${logData.correct_answers}</strong>
                    </span>
                    <span class="stat-item stat-partial">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Parziali: <strong>${logData.partial_answers}</strong>
                    </span>
                    <span class="stat-item stat-wrong">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        Sbagliate: <strong>${logData.wrong_answers}</strong>
                    </span>
                    <span class="stat-item stat-time">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        Tempo: <strong>${this.formatTime(logData.total_time_seconds * 1000)}</strong>
                    </span>
                </div>
            </div>
        `;
        container.appendChild(summaryDiv);
        
        // Add questions
        logData.questions.forEach((question, index) => {
            const reviewDiv = document.createElement('div');
            reviewDiv.className = 'review-question';
            
            // Determine status class
            let statusClass = 'unanswered';
            if (question.is_correct) statusClass = 'correct';
            else if (question.is_partial) statusClass = 'partial';
            else statusClass = 'wrong';
            
            reviewDiv.classList.add(statusClass);
            
            // Calcola punteggio per questa domanda
            const questionScore = question.score !== undefined ? Math.round(question.score * 100) : 0;
            
            reviewDiv.innerHTML = `
                <div class="review-header">
                    <span class="review-number">Domanda ${index + 1}</span>
                    <span class="review-status ${statusClass}">
                        ${question.is_correct ? '✅ Corretta' : question.is_partial ? '⚠️ Parziale' : '❌ Sbagliata'} (${questionScore}%)
                    </span>
                </div>
                <div class="review-question-text">${question.text}</div>
                <div class="review-answers">
                    ${Object.entries(question.all_answers).map(([letter, text]) => {
                        const isCorrect = question.correct_answers?.includes(letter);
                        const isUserSelected = question.user_answers?.includes(letter);
                        let className = 'review-answer';
                        if (isCorrect) className += ' correct';
                        if (isUserSelected && !isCorrect) className += ' wrong';
                        if (isUserSelected) className += ' selected';
                        
                        return `
                            <div class="${className}">
                                <span class="review-answer-letter">${letter}.</span>
                                <span class="review-answer-text">${text}</span>
                                ${isCorrect ? '<span class="correct-marker">✓</span>' : ''}
                                ${isUserSelected ? '<span class="user-marker">👤</span>' : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="review-feedback">
                    <strong>Risposte corrette:</strong> ${question.correct_answers?.join(', ') || 'Nessuna'}
                </div>
            `;
            
            container.appendChild(reviewDiv);
        });
        
        this.showLogReviewScreen();
    }

    showLogReviewScreen() {
        this.hideAllScreens();
        document.getElementById('logReview').style.display = 'block';
    }

    async deleteLog(logId) {
        if (!confirm('Sei sicuro di voler cancellare questo log?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/quiz/logs/${logId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.showStatus('Log cancellato con successo', 'success');
                this.showLogs(); // Refresh the logs list
            } else {
                throw new Error('Errore nella cancellazione');
            }
        } catch (error) {
            console.error('Errore nella cancellazione del log:', error);
            this.showStatus('Errore nella cancellazione del log', 'error');
        }
    }

    async deleteAllLogs() {
        if (!confirm('Sei sicuro di voler cancellare TUTTI i log? Questa azione non può essere annullata.')) {
            return;
        }
        
        try {
            const response = await fetch('/api/quiz/logs', {
                method: 'DELETE'
            });
            
            if (response.ok) {
                const result = await response.json();
                this.showStatus(`${result.deleted_count} log cancellati`, 'success');
                this.showLogs(); // Refresh the logs list
            } else {
                throw new Error('Errore nella cancellazione');
            }
        } catch (error) {
            console.error('Errore nella cancellazione di tutti i log:', error);
            this.showStatus('Errore nella cancellazione dei log', 'error');
        }
    }

    // ==================== UI NAVIGATION ====================

    showSetup() {
        this.hideAllScreens();
        document.getElementById('quizSetup').style.display = 'block';
        this.stopTimer();
        this.quizInProgress = false;
    }

    showQuiz() {
        this.hideAllScreens();
        const quizScreen = document.getElementById('quizGame');
        if (quizScreen) {
            quizScreen.style.display = 'block';
        }
        // Ensure submit button is visible (with null check)
        const submitBtn = document.getElementById('btnSubmitAnswer');
        if (submitBtn) {
            submitBtn.style.display = 'block';
            submitBtn.disabled = false;
        }
    }

    showResults() {
        this.hideAllScreens();
        document.getElementById('quizResults').style.display = 'block';
        this.stopTimer();
        // Show log button after quiz, hide end quiz button
        const btnLogs = document.getElementById('btnLogs');
        if (btnLogs) btnLogs.style.display = '';
        const btnEndQuiz = document.getElementById('btnEndQuiz');
        if (btnEndQuiz) btnEndQuiz.style.display = 'none';
    }

    showReviewScreen() {
        this.hideAllScreens();
        document.getElementById('quizReview').style.display = 'block';
    }

    showLogsScreen() {
        this.hideAllScreens();
        document.getElementById('quizLogs').style.display = 'block';
    }

    hideAllScreens() {
        document.getElementById('quizSetup').style.display = 'none';
        document.getElementById('quizGame').style.display = 'none';
        document.getElementById('quizResults').style.display = 'none';
        document.getElementById('quizReview').style.display = 'none';
        document.getElementById('quizLogs').style.display = 'none';
        document.getElementById('logReview').style.display = 'none';
    }

    // ==================== UTILITIES ====================

    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('statusMsg');
        statusEl.textContent = message;
        statusEl.className = `status ${type}`;
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            statusEl.textContent = 'Pronto';
            statusEl.className = 'status';
        }, 3000);
    }
}

// Initialize the quiz manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new QuizManagerFrontend();

    // Update theme icons on initial load
    updateQuizThemeIcons();
});

function updateQuizThemeIcons() {
    const moonIcon = document.querySelector('.theme-icon-moon');
    const sunIcon = document.querySelector('.theme-icon-sun');
    if (moonIcon && sunIcon) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        moonIcon.style.display = isDark ? 'block' : 'none';
        sunIcon.style.display = isDark ? 'none' : 'block';
    }
}

// Listen for theme changes to update icons
document.addEventListener('themeChanged', updateQuizThemeIcons);