/**
 * Smart Search Engine - Main search engine for intelligent question search
 * Combines all search modules for comprehensive, fuzzy, and operator-based search
 */

// Search configuration with defaults
window.SEARCH_CONFIG = {
    mode: 'normal', // strict, normal, fuzzy
    highlightEnabled: true,
    searchAnswers: true,
    searchNotes: true,
    searchCategories: true,
    minScore: 15
};

class SmartSearch {
    constructor() {
        this.cache = new Map();
        this.maxCacheSize = 100;
    }

    /**
     * Set search configuration
     * @param {Object} config - New configuration values
     */
    static setConfig(config) {
        window.SEARCH_CONFIG = { ...window.SEARCH_CONFIG, ...config };
        SmartSearch.clearCache();
    }

    /**
     * Get current search configuration
     * @returns {Object} Current config
     */
    static getConfig() {
        return { ...window.SEARCH_CONFIG };
    }

    /**
     * Main search function - filter questions based on query
     * @param {Array} questions - Array of question objects
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Array} Filtered and ranked questions
     */
    static filter(questions, query, options = {}) {
        if (!window.SMART_SEARCH_ENABLED) {
            return this.fallbackSearch(questions, query);
        }

        if (!Array.isArray(questions)) return [];
        if (!query || typeof query !== 'string') return questions;

        const trimmedQuery = query.trim();
        if (!trimmedQuery) return questions;

        // Global configuration
        const minRelevanceScore = window.SMART_SEARCH_MIN_SCORE || 15;

        try {
            // Parse the query
            const parsedQuery = QueryParser.parse(trimmedQuery);

            // Get filter functions
            const filters = QueryParser.toFilterFunctions(parsedQuery);

            if (filters.length === 0) return questions;

            // Apply filters
            let filtered = questions.filter(question => {
                return filters.every(filterFn => filterFn(question));
            });

            // Rank results by relevance and apply minimum score threshold
            if (parsedQuery.type === 'simple' && parsedQuery.text) {
                // Calculate scores during ranking
                const scored = filtered.map(question => {
                    const matches = this.findAllMatches(question, parsedQuery.text);
                    const relevance = SearchUtils.calculateRelevance(question, parsedQuery.text, matches);
                    return {
                        question: question,
                        relevance: relevance,
                        matches: matches
                    };
                });

                // Sort by relevance (highest first) and filter low score results
                const threshold = minRelevanceScore;
                scored.sort((a, b) => b.relevance - a.relevance);
                
                // Filter out results below minimum score
                const filteredAndRanked = scored
                    .filter(item => item.relevance >= threshold)
                    .map(item => item.question);

                return filteredAndRanked;
            }

            return filtered;

        } catch (error) {
            console.warn('SmartSearch error, falling back to basic search:', error);
            return this.fallbackSearch(questions, query);
        }
    }

    /**
     * Rank search results by relevance
     * @param {Array} questions - Filtered questions
     * @param {string} query - Original query text
     * @returns {Array} Ranked questions
     */
    static rankResults(questions, query) {
        if (!query || questions.length <= 1) return questions;

        const scored = questions.map(question => {
            const matches = this.findAllMatches(question, query);
            const relevance = SearchUtils.calculateRelevance(question, query, matches);

            return {
                question: question,
                relevance: relevance,
                matches: matches
            };
        });

        // Sort by relevance (highest first)
        scored.sort((a, b) => b.relevance - a.relevance);

        // Return questions in ranked order
        return scored.map(item => item.question);
    }

    /**
     * Find all matches for a query in a question
     * @param {Object} question - Question object
     * @param {string} query - Search query
     * @returns {Array} Array of match objects
     */
    static findAllMatches(question, query) {
        const matches = [];
        const allFields = SearchUtils.extractSearchableFields(question);
        const normalizedQuery = SearchUtils.normalizeText(query);
        
        // Filter fields based on configuration
        const fields = {};
        const config = window.SEARCH_CONFIG;
        
        fields.id = allFields.id;
        fields.raw_text = allFields.raw_text;
        
        if (config.searchAnswers) fields.answers = allFields.answers;
        if (config.searchNotes) fields.notes = allFields.notes;
        if (config.searchCategories) {
            fields.primary_domain = allFields.primary_domain;
            fields.subdomain = allFields.subdomain;
        }

        // Check each field for matches
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            if (!fieldValue) continue;

            const normalizedField = SearchUtils.normalizeText(fieldValue);

            // Exact substring match
            if (normalizedField.includes(normalizedQuery)) {
                const position = normalizedField.indexOf(normalizedQuery);
                matches.push({
                    field: fieldName,
                    type: 'exact',
                    position: position,
                    matchLength: normalizedQuery.length
                });
                continue; // Skip fuzzy matching for this field if exact match found
            }

            // Fuzzy matching
            const fuzzyMatches = FuzzyMatcher.findFuzzyMatches(fieldValue, query);
            for (const fuzzyMatch of fuzzyMatches) {
                matches.push({
                    field: fieldName,
                    type: fuzzyMatch.type,
                    score: fuzzyMatch.score,
                    position: fuzzyMatch.position,
                    matchLength: fuzzyMatch.matchLength
                });
            }
        }

        return matches;
    }

    /**
     * Fallback to basic search if advanced search fails
     * @param {Array} questions - Questions array
     * @param {string} query - Search query
     * @returns {Array} Filtered questions
     */
    static fallbackSearch(questions, query) {
        if (!query || !Array.isArray(questions)) return questions;

        const searchTerm = SearchUtils.normalizeText(query);

        return questions.filter(q => {
            // Search in id and raw_text (original logic)
            const id = SearchUtils.normalizeText(q.id || '');
            const text = SearchUtils.normalizeText(q.raw_text || '');

            return id.includes(searchTerm) || text.includes(searchTerm);
        });
    }

    /**
     * Get search suggestions for autocompletion
     * @param {string} partialQuery - Partial query being typed
     * @param {Array} questions - All questions for context
     * @param {Array} categories - Available categories
     * @returns {Array} Array of suggestion objects
     */
    static getSuggestions(partialQuery, questions, categories = []) {
        const suggestions = [];

        if (!partialQuery || typeof partialQuery !== 'string') return suggestions;

        const trimmed = partialQuery.trim();
        if (!trimmed) return suggestions;

        // Check if user is typing an operator
        const lastWord = this.getLastWord(trimmed);
        if (lastWord.includes(':')) {
            return this.getOperatorSuggestions(lastWord, categories);
        }

        // General text suggestions from existing questions
        if (Array.isArray(questions)) {
            const existingTerms = new Set();

            for (const question of questions.slice(0, 100)) { // Sample first 100 questions
                const fields = SearchUtils.extractSearchableFields(question);

                for (const fieldValue of Object.values(fields)) {
                    if (!fieldValue) continue;

                    const words = SearchUtils.normalizeText(fieldValue).split(/\s+/);
                    for (const word of words) {
                        if (word.startsWith(SearchUtils.normalizeText(lastWord)) && word.length > 2) {
                            existingTerms.add(word);
                        }
                    }
                }
            }

            // Convert to suggestions
            for (const term of existingTerms) {
                if (suggestions.length >= 8) break; // Limit suggestions
                suggestions.push({
                    type: 'text',
                    value: term,
                    description: 'Termine esistente'
                });
            }
        }

        return suggestions;
    }

    /**
     * Get operator-based suggestions
     * @param {string} operatorText - Text like "category:" or "sub:"
     * @param {Array} categories - Available categories
     * @returns {Array} Array of suggestions
     */
    static getOperatorSuggestions(operatorText, categories) {
        const suggestions = [];
        const parts = operatorText.split(':');
        const operator = parts[0]?.toLowerCase();
        const value = parts[1] || '';

        if (!operator || !this.isValidOperator(operator)) return suggestions;

        // Category and subcategory suggestions
        if ((operator === 'category' || operator === 'sub') && Array.isArray(categories)) {
            const normalizedValue = SearchUtils.normalizeText(value);

            for (const category of categories) {
                const normalizedCategory = SearchUtils.normalizeText(category);
                if (normalizedCategory.startsWith(normalizedValue)) {
                    suggestions.push({
                        type: 'category',
                        value: `${operator}:${category}`,
                        description: operator === 'category' ? 'Categoria' : 'Sottocategoria'
                    });
                }
            }
        }

        // Boolean suggestions for flag and has operators
        if (operator === 'flag' || operator === 'has') {
            if ('true'.startsWith(value.toLowerCase())) {
                suggestions.push({
                    type: 'boolean',
                    value: `${operator}:true`,
                    description: operator === 'flag' ? 'Domande flaggate' : 'Con risposte corrette'
                });
            }
            if ('false'.startsWith(value.toLowerCase())) {
                suggestions.push({
                    type: 'boolean',
                    value: `${operator}:false`,
                    description: operator === 'flag' ? 'Domande non flaggate' : 'Senza risposte corrette'
                });
            }
        }

        return suggestions.slice(0, 10);
    }

    /**
     * Check if operator is valid
     * @param {string} operator - Operator name
     * @returns {boolean} True if valid
     */
    static isValidOperator(operator) {
        return QueryParser.isValidOperator(operator);
    }

    /**
     * Extract last word from query for suggestions
     * @param {string} query - Full query
     * @returns {string} Last word
     */
    static getLastWord(query) {
        const words = query.split(/\s+/);
        return words[words.length - 1] || '';
    }

    /**
     * Clear search cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Get search statistics
     * @returns {Object} Cache statistics
     */
    getStats() {
        return {
            cacheSize: this.cache.size,
            maxCacheSize: this.maxCacheSize
        };
    }

    /**
     * Highlight search matches in text
     * @param {string} text - Text to highlight
     * @param {string} query - Search query
     * @returns {string} Highlighted text
     */
    static highlight(text, query) {
        if (!window.SEARCH_CONFIG.highlightEnabled || !query) return text;
        
        const parsedQuery = QueryParser.parse(query);
        let terms = [];
        
        if (parsedQuery.text) {
            terms.push(parsedQuery.text);
        }
        
        if (parsedQuery.operators) {
            parsedQuery.operators.forEach(op => {
                if (typeof op.value === 'string') {
                    terms.push(op.value);
                }
            });
        }
        
        return SearchUtils.highlightMatches(text, terms);
    }

    /**
     * Clear search cache
     */
    static clearCache() {
        this.cache = new Map();
    }
}

// Create global instance
window.SmartSearch = SmartSearch;