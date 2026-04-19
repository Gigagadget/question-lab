/**
 * Search Utilities - Shared utilities for the intelligent search system
 * Provides text normalization, relevance scoring, and helper functions
 */

// Global configuration for search system
window.SMART_SEARCH_ENABLED = true;
window.SMART_SEARCH_STRICT_MODE = true;
window.SMART_SEARCH_MIN_SCORE = 15;

class SearchUtils {
    /**
     * Normalize text for consistent searching
     * @param {string} text - Text to normalize
     * @returns {string} Normalized text
     */
    static normalizeText(text) {
        if (!text || typeof text !== 'string') return '';
        return text
            .toLowerCase()
            .trim()
            // Remove extra whitespace
            .replace(/\s+/g, ' ')
            // Normalize accents for Italian
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    /**
     * Calculate relevance score for search results
     * @param {Object} question - Question object
     * @param {string} query - Original search query
     * @param {Array} matches - Array of match objects with field and score info
     * @returns {number} Relevance score (higher is better)
     */
    static calculateRelevance(question, query, matches) {
        let score = 0;
        const queryLength = query.length;

        for (const match of matches) {
            let fieldScore = 0;

            // Field priority weights
            const fieldWeights = {
                'id': 100,           // Exact ID matches get highest priority
                'raw_text': 50,      // Question text is very important
                'answers': 30,       // Answer text is important
                'primary_domain': 20,// Categories are moderately important
                'subdomain': 15,     // Subcategories less so
                'notes': 10          // Notes are least important
            };

            fieldScore = fieldWeights[match.field] || 10;

            // Boost exact matches
            if (match.type === 'exact') {
                fieldScore *= 2;
                
                // ✅ BIG BOOST for exact whole word matches
                if (match.matchLength === queryLength) {
                    fieldScore *= 2.5;
                }
            }

            // ✅ Penalize fuzzy matches heavily
            if (match.type === 'fuzzy') {
                // Reduce score based on similarity
                fieldScore *= match.score || 0.5;
                
                // Penalize matches that are significantly longer than query
                if (match.matchLength && match.matchLength > queryLength * 1.5) {
                    fieldScore *= 0.5;
                }
            }

            // Boost shorter matches (more specific)
            if (match.matchLength) {
                fieldScore *= Math.max(0.5, 1 - (match.matchLength / 100));
            }

            // Boost matches at the beginning of text
            if (match.position === 0) {
                fieldScore *= 1.5;
            }

            score += fieldScore;
        }

        // Boost questions with fewer total matches (more focused results)
        if (matches.length > 0) {
            score *= Math.max(0.8, 1 - (matches.length / 10));
        }

        return Math.round(score);
    }

    /**
     * Extract searchable text from a question object
     * @param {Object} question - Question object
     * @returns {Object} Object with searchable fields
     */
    static extractSearchableFields(question) {
        const fields = {
            id: question.id || '',
            raw_text: question.raw_text || '',
            answers: '',
            notes: question.notes || '',
            primary_domain: question.primary_domain || '',
            subdomain: question.subdomain || ''
        };

        // Combine all answer texts
        if (question.answers && typeof question.answers === 'object') {
            fields.answers = Object.values(question.answers)
                .filter(answer => answer && typeof answer === 'string')
                .join(' ');
        }

        return fields;
    }

    /**
     * Check if a question has correct answers
     * @param {Object} question - Question object
     * @returns {boolean} True if question has correct answers
     */
    static hasCorrectAnswers(question) {
        if (!question.correct || !Array.isArray(question.correct)) return false;
        if (!question.answers || typeof question.answers !== 'object') return false;

        // Check if any correct answer points to a non-empty answer
        return question.correct.some(correctId =>
            question.answers[correctId] &&
            question.answers[correctId].trim().length > 0
        );
    }

    /**
     * Check if a question is flagged
     * @param {Object} question - Question object
     * @returns {boolean} True if question is flagged
     */
    static isFlagged(question) {
        return Boolean(question.flagged);
    }

    /**
     * Highlight search matches in text
     * @param {string} text - Original text (already escaped HTML)
     * @param {string|Array} query - Search query or array of terms
     * @param {Object} options - Highlight options
     * @returns {string} Text with matches wrapped in <mark> tags
     */
    static highlightMatches(text, query, options = {}) {
        if (!text || !query) return text || '';
        
        const {
            className = 'search-match',
            caseSensitive = false,
            wholeWord = false
        } = options;

        let terms;
        if (typeof query === 'string') {
            terms = [query.trim()];
        } else if (Array.isArray(query)) {
            terms = query;
        } else {
            return text;
        }

        // Normalize and deduplicate terms
        const normalizedTerms = terms
            .filter(term => term && term.length > 0)
            .map(term => SearchUtils.normalizeText(term))
            .filter((term, index, self) => self.indexOf(term) === index);

        if (normalizedTerms.length === 0) return text;

        // Create regex pattern for all terms - escape special regex chars
        const pattern = normalizedTerms
            .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');

        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(`(${pattern})`, flags);

        // Replace matches while preserving original case
        return text.replace(regex, (match) => {
            return `<mark class="${className}">${match}</mark>`;
        });
    }

    /**
     * Get all match positions in text for multiple terms
     * @param {string} text - Text to search
     * @param {Array} terms - Search terms
     * @returns {Array} Array of match positions
     */
    static findAllMatchPositions(text, terms) {
        if (!text || !terms || terms.length === 0) return [];
        
        const matches = [];
        const normalizedText = SearchUtils.normalizeText(text);
        
        for (const term of terms) {
            const normalizedTerm = SearchUtils.normalizeText(term);
            if (!normalizedTerm) continue;
            
            let position = 0;
            while ((position = normalizedText.indexOf(normalizedTerm, position)) !== -1) {
                matches.push({
                    start: position,
                    end: position + normalizedTerm.length,
                    term: term
                });
                position += normalizedTerm.length;
            }
        }
        
        return matches;
    }
}

// Export for use in other modules
window.SearchUtils = SearchUtils;