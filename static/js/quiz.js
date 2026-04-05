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

        // Check for active database before initializing
        this.checkDatabaseAndInit();
    }

    checkDatabaseAndInit() {
        fetch('/api/databases/active')
            .then(res => res.json())
            .then(data => {
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
        const btnHelp = document.getElementById('btnHelp');
        const helpModal = document.getElementById('helpModal');
        const helpClose = helpModal?.querySelector('.close');

        if (btnHelp && helpModal) {
            btnHelp.addEventListener('click', () => {
                helpModal.style.display = 'block';
            });
        }

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
        document.getElementById('btnHome').addEventListener('click', () => {
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

        let subdomainsInfo = document.getElementById('selectedSubdomainsInfo');
        if (!subdomainsInfo) {
            subdomainsInfo = document.createElement('div');
            subdomainsInfo.id = 'selectedSubdomainsInfo';
            subdomainsInfo.className = 'category-info';
            subdomainsInfo.style.display = 'none';
            subdomainsInfo.innerHTML = '<span id="selectedSubdomainsCount">0</span> sottodomini selezionati';
            subdomainsContainer.insertAdjacentElement('afterend', subdomainsInfo);
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
                <div style="grid-column: 1 / -1; margin-top: 6px; font-size: 0.85rem; color: #334155;"><strong>${primary}</strong></div>
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
        this.updateAvailableQuestions();
    }

    updateSubdomainCount() {
        const el = document.getElementById('selectedSubdomainsCount');
        if (!el) return;
        let count = 0;
        this.selectedCategories.filter(c => c !== 'all').forEach(primary => {
            const list = this.selectedSubdomainsByPrimary[primary] || [];
            count += list.length;
        });
        el.textContent = count;
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
        const count = this.selectedCategories.length;
        document.getElementById('selectedCategoriesCount').textContent = count;
        
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
        const display = this.selectedCount === -1 ? 'Tutte' : this.selectedCount;
        document.getElementById('selectedCount').textContent = display;
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
        document.getElementById('questionCategory').textContent = question.primary_domain;
        
        // Render answers
        this.renderAnswers(question);
        
        // Reset UI
        document.getElementById('btnSubmitAnswer').disabled = true;
        document.getElementById('btnNextQuestion').style.display = 'none';
        document.getElementById('feedbackContainer').style.display = 'none';
        
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
                <div class="answer-checkbox">
                    <input type="checkbox" id="answer_${letter}" name="answer" value="${letter}">
                </div>
                <div class="answer-content">
                    <span class="answer-letter">${letter}.</span>
                    <span class="answer-text">${answers[letter]}</span>
                </div>
            `;
            
            // Add click handler
            answerDiv.addEventListener('click', (e) => {
                // Check if answers are disabled (during feedback)
                if (answerDiv.classList.contains('disabled')) {
                    return;
                }
                
                if (e.target.type !== 'checkbox') {
                    const checkbox = answerDiv.querySelector('input[type="checkbox"]');
                    checkbox.checked = !checkbox.checked;
                }
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
        const selectedAnswers = this.getSelectedAnswers();
        const submitBtn = document.getElementById('btnSubmitAnswer');
        submitBtn.disabled = selectedAnswers.length === 0;
    }

    getSelectedAnswers() {
        const checkboxes = document.querySelectorAll('#answersContainer input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    async submitAnswer() {
        const selectedAnswers = this.getSelectedAnswers();
        const question = this.questions[this.currentQuestionIndex];
        
        if (selectedAnswers.length === 0) {
            this.showStatus('Seleziona almeno una risposta', 'warning');
            return;
        }

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
                nextBtn.textContent = '🏁 Termina Quiz';
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
            feedbackMessage.innerHTML = '✅ <strong>Risposta Corretta!</strong>';
        } else if (result.is_partial) {
            feedbackContainer.classList.add('partial');
            feedbackMessage.innerHTML = '⚠️ <strong>Risposta Parziale</strong>';
        } else {
            feedbackContainer.classList.add('wrong');
            feedbackMessage.innerHTML = '❌ <strong>Risposta Sbagliata</strong>';
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
            feedbackContent += `<strong>📝 Note:</strong> ${question.notes}`;
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
        
        const scorePercentage = answeredQuestions > 0 ? Math.round((correctAnswers / answeredQuestions) * 100) : 0;
        
        // Prepare quiz log data
        return {
            categories_selected: this.selectedCategories,
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
            resultsCard.style.color = '#e67e22';
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
            
            reviewDiv.innerHTML = `
                <div class="review-header">
                    <span class="review-number">Domanda ${index + 1}</span>
                    <span class="review-status ${statusClass}">
                        ${result?.is_correct ? '✅ Corretta' : result?.is_partial ? '⚠️ Parziale' : '❌ Sbagliata'}
                    </span>
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
                                ${isCorrect ? '<span class="correct-marker">✓</span>' : ''}
                                ${isUserSelected ? '<span class="user-marker">👤</span>' : ''}
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
            
            logDiv.innerHTML = `
                <div class="log-header">
                    <span class="log-date">${formattedDate}</span>
                    <span class="log-score">${log.score_percentage}%</span>
                </div>
                <div class="log-details">
                    <div class="log-detail">
                        <span class="log-detail-label">Categorie:</span>
                        <span class="log-detail-value">${log.categories.join(', ')}</span>
                    </div>
                    <div class="log-detail">
                        <span class="log-detail-label">Domande:</span>
                        <span class="log-detail-value">${log.total_questions}</span>
                    </div>
                    <div class="log-detail">
                        <span class="log-detail-label">Corrette:</span>
                        <span class="log-detail-value">${log.correct_answers}</span>
                    </div>
                    <div class="log-detail">
                        <span class="log-detail-label">Tempo:</span>
                        <span class="log-detail-value">${this.formatTime(log.total_time_seconds * 1000)}</span>
                    </div>
                </div>
                <div class="log-actions">
                    <button class="log-btn view" data-log-id="${log.id}">👁️ Visualizza</button>
                    <button class="log-btn delete" data-log-id="${log.id}">🗑️ Cancella</button>
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
                    <span class="stat-item">📊 Punteggio: <strong>${logData.score_percentage}%</strong></span>
                    <span class="stat-item">✅ Corrette: <strong>${logData.correct_answers}</strong></span>
                    <span class="stat-item">⚠️ Parziali: <strong>${logData.partial_answers}</strong></span>
                    <span class="stat-item">❌ Sbagliate: <strong>${logData.wrong_answers}</strong></span>
                    <span class="stat-item">⏱️ Tempo: <strong>${this.formatTime(logData.total_time_seconds * 1000)}</strong></span>
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
            
            reviewDiv.innerHTML = `
                <div class="review-header">
                    <span class="review-number">Domanda ${index + 1}</span>
                    <span class="review-status ${statusClass}">
                        ${question.is_correct ? '✅ Corretta' : question.is_partial ? '⚠️ Parziale' : '❌ Sbagliata'}
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
        document.getElementById('quizGame').style.display = 'block';
    }

    showResults() {
        this.hideAllScreens();
        document.getElementById('quizResults').style.display = 'block';
        this.stopTimer();
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
});