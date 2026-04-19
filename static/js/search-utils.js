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
     * Escape HTML special characters
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    static escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
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
     * Create position map from original text to normalized text
     * @param {string} originalText - Original text
     * @returns {Object} Object with normalized text and position map
     */
    static createNormalizationPositionMap(originalText) {
        if (!originalText) {
            return { normalized: '', positionMap: [] };
        }

        const normalized = [];
        const positionMap = []; // maps normalized index → original index

        let i = 0;
        let originalLength = originalText.length;

        // Skip leading whitespace (trim)
        while (i < originalLength && /\s/.test(originalText[i])) {
            i++;
        }

        // Process remaining characters
        let lastWasSpace = false;
        while (i < originalLength) {
            const char = originalText[i];
            
            // Handle spaces - collapse multiple to single
            if (/\s/.test(char)) {
                if (!lastWasSpace) {
                    normalized.push(' ');
                    positionMap.push(i);
                    lastWasSpace = true;
                }
                i++;
                continue;
            }

            lastWasSpace = false;

            // Handle accented characters
            const normalizedChar = char
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

            for (const c of normalizedChar) {
                normalized.push(c);
                positionMap.push(i);
            }

            i++;
        }

        return {
            normalized: normalized.join(''),
            positionMap: positionMap
        };
    }

    /**
     * Map normalized position to original position
     * @param {number} normalizedPos - Position in normalized text
     * @param {Array} positionMap - Position map from createNormalizationPositionMap
     * @returns {number} Position in original text
     */
    static mapNormalizedPositionToOriginal(normalizedPos, positionMap) {
        if (normalizedPos < 0 || normalizedPos >= positionMap.length) {
            return positionMap[positionMap.length - 1] || 0;
        }
        return positionMap[normalizedPos];
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

    /**
     * Get smart preview that centers around the first match AND highlights correctly
     * This combines both operations to fix position offset bugs
     * @param {string} text - Full original text
     * @param {Array} matches - Array of match objects from findAllMatches()
     * @param {number} length - Desired preview length
     * @param {Object} options - Highlight options
     * @returns {string} Smart preview with correct highlighting
     */
    static getSmartHighlightedPreview(text, matches, length = 80, options = {}) {
        if (!text) return 'Nessun testo';
        if (!matches || matches.length === 0) {
            return text.length <= length 
                ? text 
                : text.substring(0, length) + '...';
        }

        const { className = 'search-match', fieldFilter = 'raw_text' } = options;

        // ONLY use matches from the correct field (raw_text for question preview)
        // Ignore matches from id, answers, notes, etc.
        const textMatches = matches.filter(m => m.field === fieldFilter);
        
        if (textMatches.length === 0) {
            // No matches in this field, return standard preview
            return text.length <= length 
                ? text 
                : text.substring(0, length) + '...';
        }

        // Find first valid match in this field
        const firstMatch = textMatches.find(m => m.position !== undefined && m.matchLength !== undefined);
        if (!firstMatch) {
            return text.length <= length 
                ? text 
                : text.substring(0, length) + '...';
        }

        const halfLength = Math.floor(length / 2);
        let start = Math.max(0, firstMatch.position - halfLength);
        let end = Math.min(text.length, start + length);

        // Adjust if we're too close to start or end
        if (start === 0) {
            end = Math.min(text.length, length);
        }
        if (end === text.length) {
            start = Math.max(0, text.length - length);
        }

        // Get the raw preview slice
        const previewSlice = text.substring(start, end);
        
        // Filter matches that are actually inside this preview slice AND from correct field
        const matchesInPreview = textMatches.filter(match => {
            return match.position >= start && 
                   match.position + match.matchLength <= end;
        });

        // Sort matches by position
        matchesInPreview.sort((a, b) => a.position - b.position);

        let result = '';
        let lastIndex = start;

        // Add leading ellipsis if needed
        if (start > 0) {
            result += '...';
        }

        // Process each match in the preview
        for (const match of matchesInPreview) {
            // Add text from last position up to this match (adjusted for preview start)
            result += SearchUtils.escapeHtml(text.substring(lastIndex, match.position));
            
            // Add highlighted match
            const matchText = SearchUtils.escapeHtml(text.substring(match.position, match.position + match.matchLength));
            result += `<mark class="${className}">${matchText}</mark>`;
            
            lastIndex = match.position + match.matchLength;
        }

        // Add remaining text after last match
        result += SearchUtils.escapeHtml(text.substring(lastIndex, end));

        // Add trailing ellipsis if needed
        if (end < text.length) {
            result += '...';
        }

        return result;
    }

    /**
     * Get smart preview that centers around the first match
     * @deprecated Use getSmartHighlightedPreview instead for correct highlighting
     * @param {string} text - Full text
     * @param {string} query - Search query
     * @param {number} length - Desired preview length
     * @returns {string} Smart preview with match centered
     */
    static getSmartPreview(text, query, length = 80) {
        if (!text) return 'Nessun testo';
        if (!query || query.trim() === '') {
            return text.length <= length 
                ? text 
                : text.substring(0, length) + '...';
        }

        const matches = SearchUtils.findAllMatchPositions(text, [query]);
        
        // If no matches found, return standard preview
        if (matches.length === 0) {
            return text.length <= length 
                ? text 
                : text.substring(0, length) + '...';
        }

        const firstMatch = matches[0];
        const halfLength = Math.floor(length / 2);
        let start = Math.max(0, firstMatch.start - halfLength);
        let end = Math.min(text.length, start + length);

        // Adjust if we're too close to start or end
        if (start === 0) {
            end = Math.min(text.length, length);
        }
        if (end === text.length) {
            start = Math.max(0, text.length - length);
        }

        let preview = text.substring(start, end);
        let result = '';
        
        if (start > 0) result += '...';
        result += preview;
        if (end < text.length) result += '...';

        return result;
    }

    /**
     * Highlight matches using pre-calculated positions (for fuzzy matches)
     * @param {string} text - Text to highlight
     * @param {Array} matches - Array of match objects with position and matchLength
     * @param {Object} options - Highlight options
     * @returns {string} Text with matches highlighted
     */
    static highlightMatchesWithPositions(text, matches, options = {}) {
        if (!text || !matches || matches.length === 0) return text;

        const { className = 'search-match', fieldFilter = 'raw_text' } = options;

        // ONLY use matches from the correct field
        const textMatches = matches.filter(m => m.field === fieldFilter);
        
        if (textMatches.length === 0) {
            return text;
        }

        // Sort matches by position ascending
        const sortedMatches = [...textMatches].sort((a, b) => a.position - b.position);

        let result = '';
        let lastIndex = 0;

        for (const match of sortedMatches) {
            // Add text before the match
            result += SearchUtils.escapeHtml(text.substring(lastIndex, match.position));
            
            // Add highlighted match
            const matchText = SearchUtils.escapeHtml(text.substring(match.position, match.position + match.matchLength));
            result += `<mark class="${className}">${matchText}</mark>`;
            
            lastIndex = match.position + match.matchLength;
        }

        // Add remaining text
        result += SearchUtils.escapeHtml(text.substring(lastIndex));

        return result;
    }
}

// Export for use in other modules
window.SearchUtils = SearchUtils;