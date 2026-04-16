/**
 * Query Parser - Advanced query parsing for intelligent search
 * Handles operators like category:, sub:, answer:, id:, notes:, has:, flag:
 */

class QueryParser {
    /**
     * Parse a search query into structured filters
     * @param {string} query - Raw search query
     * @returns {Object} Parsed query object
     */
    static parse(query) {
        if (!query || typeof query !== 'string') {
            return { type: 'simple', text: '' };
        }

        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            return { type: 'simple', text: '' };
        }

        // Check for advanced operators
        const operators = this.extractOperators(trimmedQuery);
        if (operators.length > 0) {
            return {
                type: 'advanced',
                operators: operators,
                text: this.extractFreeText(trimmedQuery, operators)
            };
        }

        // Simple text search
        return {
            type: 'simple',
            text: trimmedQuery
        };
    }

    /**
     * Extract advanced operators from query
     * @param {string} query - Query string
     * @returns {Array} Array of operator objects
     */
    static extractOperators(query) {
        const operators = [];
        const operatorRegex = /(\w+):("([^"]*)"|'([^']*)'|([^\s]+))/g;

        let match;
        while ((match = operatorRegex.exec(query)) !== null) {
            const operator = match[1].toLowerCase();
            const quotedValue = match[3] || match[4]; // Double or single quotes
            const unquotedValue = match[5];

            let value = quotedValue || unquotedValue;
            if (!value) continue;

            // Validate operator
            if (!this.isValidOperator(operator)) continue;

            // Special handling for boolean operators
            if (operator === 'flag' || operator === 'has') {
                value = this.parseBooleanValue(value);
                if (value === null) continue; // Invalid boolean value
            }

            operators.push({
                type: operator,
                value: typeof value === 'string' ? value.trim() : value,
                raw: match[0]
            });
        }

        return operators;
    }

    /**
     * Check if an operator is valid
     * @param {string} operator - Operator name
     * @returns {boolean} True if valid
     */
    static isValidOperator(operator) {
        const validOperators = ['category', 'sub', 'answer', 'id', 'notes', 'has', 'flag'];
        return validOperators.includes(operator);
    }

    /**
     * Parse boolean values for flag and has operators
     * @param {string} value - Raw value
     * @returns {boolean|null} Parsed boolean or null if invalid
     */
    static parseBooleanValue(value) {
        const normalized = value.toLowerCase().trim();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
        return null; // Invalid
    }

    /**
     * Extract free text from query (excluding operators)
     * @param {string} query - Full query
     * @param {Array} operators - Extracted operators
     * @returns {string} Free text part
     */
    static extractFreeText(query, operators) {
        let text = query;

        // Remove all operator matches
        for (const op of operators) {
            text = text.replace(op.raw, '').trim();
        }

        // Clean up extra whitespace
        return text.replace(/\s+/g, ' ').trim();
    }

    /**
     * Convert parsed query to filter functions
     * @param {Object} parsedQuery - Parsed query object
     * @returns {Array} Array of filter functions
     */
    static toFilterFunctions(parsedQuery) {
        const filters = [];

        if (parsedQuery.type === 'simple') {
            // Simple text search across all fields
            if (parsedQuery.text) {
                filters.push((question) => this.simpleTextFilter(question, parsedQuery.text));
            }
        } else if (parsedQuery.type === 'advanced') {
            // Advanced operator filters
            for (const op of parsedQuery.operators) {
                const filterFn = this.createOperatorFilter(op);
                if (filterFn) {
                    filters.push(filterFn);
                }
            }

            // Free text search if present
            if (parsedQuery.text) {
                filters.push((question) => this.simpleTextFilter(question, parsedQuery.text));
            }
        }

        return filters;
    }

    /**
     * Create a filter function for a specific operator
     * @param {Object} operator - Operator object
     * @returns {Function} Filter function
     */
    static createOperatorFilter(operator) {
        switch (operator.type) {
            case 'category':
                return (question) => this.matchCategory(question, operator.value, 'primary_domain');
            case 'sub':
                return (question) => this.matchCategory(question, operator.value, 'subdomain');
            case 'id':
                return (question) => this.matchExact(question, operator.value, 'id');
            case 'answer':
                return (question) => this.matchText(question, operator.value, 'answers');
            case 'notes':
                return (question) => this.matchText(question, operator.value, 'notes');
            case 'has':
                return (question) => this.matchHasCondition(question, operator.value);
            case 'flag':
                return (question) => this.matchFlagCondition(question, operator.value);
            default:
                return null;
        }
    }

    /**
     * Simple text filter across all searchable fields
     * @param {Object} question - Question object
     * @param {string} text - Search text
     * @returns {boolean} True if matches
     */
    static simpleTextFilter(question, text) {
        if (!text) return true;

        const fields = SearchUtils.extractSearchableFields(question);
        const normalizedQuery = SearchUtils.normalizeText(text);

        // Check exact matches first
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            const normalizedField = SearchUtils.normalizeText(fieldValue);
            if (normalizedField.includes(normalizedQuery)) {
                return true;
            }
        }

        // Fuzzy matching as fallback
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            if (fieldValue && FuzzyMatcher.fuzzyMatch(fieldValue, text)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Match category field
     * @param {Object} question - Question object
     * @param {string} value - Category value to match
     * @param {string} field - Field name ('primary_domain' or 'subdomain')
     * @returns {boolean} True if matches
     */
    static matchCategory(question, value, field) {
        const fieldValue = question[field];
        if (!fieldValue) return false;

        const normalizedField = SearchUtils.normalizeText(fieldValue);
        const normalizedValue = SearchUtils.normalizeText(value);

        // Exact match
        if (normalizedField === normalizedValue) return true;

        // Fuzzy match
        return Boolean(FuzzyMatcher.fuzzyMatch(fieldValue, value));
    }

    /**
     * Match exact field value
     * @param {Object} question - Question object
     * @param {string} value - Value to match exactly
     * @param {string} field - Field name
     * @returns {boolean} True if matches
     */
    static matchExact(question, value, field) {
        const fieldValue = question[field];
        if (!fieldValue) return false;

        // Case-insensitive exact match
        return SearchUtils.normalizeText(fieldValue) === SearchUtils.normalizeText(value);
    }

    /**
     * Match text in specific field
     * @param {Object} question - Question object
     * @param {string} value - Text to search for
     * @param {string} field - Field name
     * @returns {boolean} True if matches
     */
    static matchText(question, value, field) {
        const fieldValue = question[field];
        if (!fieldValue) return false;

        const normalizedField = SearchUtils.normalizeText(fieldValue);
        const normalizedValue = SearchUtils.normalizeText(value);

        // Exact substring match
        if (normalizedField.includes(normalizedValue)) return true;

        // Fuzzy match
        return Boolean(FuzzyMatcher.fuzzyMatch(fieldValue, value));
    }

    /**
     * Match 'has' conditions
     * @param {Object} question - Question object
     * @param {boolean} value - Condition value
     * @returns {boolean} True if matches condition
     */
    static matchHasCondition(question, value) {
        // Currently only supports 'correct' condition
        if (value === true) {
            return SearchUtils.hasCorrectAnswers(question);
        } else if (value === false) {
            return !SearchUtils.hasCorrectAnswers(question);
        }
        return false;
    }

    /**
     * Match flag conditions
     * @param {Object} question - Question object
     * @param {boolean} value - Flag value
     * @returns {boolean} True if matches flag condition
     */
    static matchFlagCondition(question, value) {
        const isFlagged = SearchUtils.isFlagged(question);
        return isFlagged === value;
    }

    /**
     * Get suggestions for category autocompletion
     * @param {string} prefix - Current prefix being typed
     * @param {Array} categories - Available categories
     * @returns {Array} Array of suggestions
     */
    static getCategorySuggestions(prefix, categories) {
        if (!prefix || !Array.isArray(categories)) return [];

        const normalizedPrefix = SearchUtils.normalizeText(prefix);
        const suggestions = [];

        for (const category of categories) {
            const normalizedCategory = SearchUtils.normalizeText(category);
            if (normalizedCategory.startsWith(normalizedPrefix)) {
                suggestions.push(category);
            }
        }

        return suggestions.slice(0, 10); // Limit to 10 suggestions
    }
}

// Export for use in other modules
window.QueryParser = QueryParser;