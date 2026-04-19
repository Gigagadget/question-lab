/**
 * Fuzzy Matcher - Fuzzy search algorithms for intelligent text matching
 * Implements Levenshtein distance and phonetic matching for Italian text
 */

class FuzzyMatcher {
    /**
     * Calculate Levenshtein distance between two strings
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} Edit distance (lower is more similar)
     */
    static levenshteinDistance(str1, str2) {
        if (!str1 || !str2) return Math.max(str1.length || 0, str2.length || 0);

        const matrix = [];
        const len1 = str1.length;
        const len2 = str2.length;

        // Initialize matrix
        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j;
        }

        // Fill matrix
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,      // deletion
                    matrix[i][j - 1] + 1,      // insertion
                    matrix[i - 1][j - 1] + cost // substitution
                );
            }
        }

        return matrix[len1][len2];
    }

    /**
     * Calculate similarity score between two strings (0-1, higher is more similar)
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} Similarity score (0-1)
     */
    static similarity(str1, str2) {
        if (!str1 || !str2) return 0;
        if (str1 === str2) return 1;

        const maxLength = Math.max(str1.length, str2.length);
        if (maxLength === 0) return 1;

        const distance = this.levenshteinDistance(str1, str2);
        return 1 - (distance / maxLength);
    }

    /**
     * Soundex algorithm adapted for Italian
     * @param {string} word - Word to encode
     * @returns {string} Soundex code
     */
    static soundex(word) {
        if (!word || typeof word !== 'string') return '';

        const normalized = SearchUtils.normalizeText(word);
        if (!normalized) return '';

        // Italian phonetic mapping
        const codes = {
            'a': '', 'e': '', 'i': '', 'o': '', 'u': '',
            'b': '1', 'f': '1', 'p': '1', 'v': '1',
            'c': '2', 'g': '2', 'j': '2', 'k': '2', 'q': '2', 's': '2', 'x': '2', 'z': '2',
            'd': '3', 't': '3',
            'l': '4',
            'm': '5', 'n': '5',
            'r': '6'
        };

        let result = normalized[0].toUpperCase();
        let previousCode = codes[normalized[0]] || '';

        for (let i = 1; i < normalized.length && result.length < 4; i++) {
            const char = normalized[i];
            const code = codes[char] || '';

            // Skip vowels and same consecutive codes
            if (code && code !== previousCode) {
                result += code;
                previousCode = code;
            }
        }

        // Pad with zeros to make 4 characters
        while (result.length < 4) {
            result += '0';
        }

        return result;
    }

    /**
     * Check if two words sound similar using Soundex
     * @param {string} word1 - First word
     * @param {string} word2 - Second word
     * @returns {boolean} True if words sound similar
     */
    static soundsSimilar(word1, word2) {
        if (!word1 || !word2) return false;
        return this.soundex(word1) === this.soundex(word2);
    }

    /**
     * Fuzzy match text with various strategies
     * @param {string} text - Text to search in
     * @param {string} query - Query to match
     * @param {Object} options - Matching options
     * @returns {Object|null} Match result or null
     */
    static fuzzyMatch(text, query, options = {}) {
        // Global configuration based on search mode
        const searchMode = window.SEARCH_CONFIG?.mode || 'normal';
        
        let maxDistance, minSimilarity;
        switch (searchMode) {
            case 'strict':
                maxDistance = 0;
                minSimilarity = 1.0;
                break;
            case 'fuzzy':
                maxDistance = 3;
                minSimilarity = 0.65;
                break;
            case 'normal':
            default:
                maxDistance = 2;
                minSimilarity = 0.75;
        }
        
        const {
            maxDistance: overrideMaxDistance = maxDistance,
            minSimilarity: overrideMinSimilarity = minSimilarity,
            caseSensitive = false,
            wholeWord = false,     // Match whole words only
            enableSoundex = false  // Disabled by default for Italian
        } = options;

        // Calculate dynamic max distance based on query length
        const queryLen = query.length;
        let dynamicMaxDistance;
        if (queryLen <= 3) {
            dynamicMaxDistance = 0;  // Short words: ONLY exact matches
        } else if (queryLen <= 5) {
            dynamicMaxDistance = 1;  // Medium words: tolerate 1 error
        } else if (queryLen <= 8) {
            dynamicMaxDistance = 2;  // Long words: tolerate 2 errors
        } else {
            dynamicMaxDistance = 3;  // Very long words: tolerate 3 errors
        }

        // Use the most restrictive value
        const effectiveMaxDistance = Math.min(maxDistance, dynamicMaxDistance);

        if (!text || !query) return null;

        const normalizedText = caseSensitive ? text : SearchUtils.normalizeText(text);
        const normalizedQuery = caseSensitive ? query : SearchUtils.normalizeText(query);

        if (!normalizedText || !normalizedQuery) return null;

        // Exact match gets highest priority
        // For short queries (<=4 chars), require whole word match to avoid partial matches
        if (normalizedText.includes(normalizedQuery)) {
            const position = normalizedText.indexOf(normalizedQuery);
            
            // Check if it's a whole word match for short queries
            if (normalizedQuery.length <= 4) {
                // Check if matched substring is a whole word
                const before = position === 0 || /\s/.test(normalizedText[position - 1]);
                const after = position + normalizedQuery.length === normalizedText.length || 
                             /\s/.test(normalizedText[position + normalizedQuery.length]);
                
                if (!before || !after) {
                    // Not a whole word, continue to fuzzy matching
                } else {
                    return {
                        type: 'exact',
                        score: 1.0,
                        position: position,
                        matchLength: normalizedQuery.length
                    };
                }
            } else {
                // Longer queries can have substring matches
                return {
                    type: 'exact',
                    score: 1.0,
                    position: position,
                    matchLength: normalizedQuery.length
                };
            }
        }

        // Fuzzy matching with Levenshtein - ALWAYS use whole word matching
        const words = normalizedText.split(/\s+/);
        const queryWords = normalizedQuery.split(/\s+/);

        for (const textWord of words) {
            for (const queryWord of queryWords) {
                // Skip if length difference too big
                if (Math.abs(textWord.length - queryWord.length) > effectiveMaxDistance) continue;

                const distance = this.levenshteinDistance(textWord, queryWord);
                if (distance <= effectiveMaxDistance) {
                    const similarity = this.similarity(textWord, queryWord);
                    // Apply minimum similarity threshold
                    if (similarity >= minSimilarity) {
                        // Penalize partial matches
                        const lengthDiff = Math.abs(textWord.length - queryWord.length);
                        let adjustedScore = similarity * Math.max(0.3, 1 - (lengthDiff * 0.2));
                        
                        // Additional penalty if word is much longer than query
                        if (textWord.length > queryWord.length * 1.5) {
                            adjustedScore *= 0.5;
                        }
                        
                        return {
                            type: 'fuzzy',
                            score: adjustedScore,
                            distance: distance,
                            matchLength: textWord.length
                        };
                    }
                }
            }
        }

        // Phonetic matching ONLY for queries of at least 4 characters
        if (enableSoundex && query.length >= 4 && this.soundsSimilar(normalizedText, normalizedQuery)) {
            return {
                type: 'phonetic',
                score: 0.3, // Lower score for phonetic matches
                distance: 0
            };
        }

        return null;
    }

    /**
     * Find best fuzzy matches in text
     * @param {string} text - Text to search in
     * @param {string} query - Query to find
     * @returns {Array} Array of match objects
     */
    static findFuzzyMatches(text, query) {
        if (!text || !query) return [];

        const matches = [];
        const { normalized: normalizedText, positionMap } = SearchUtils.createNormalizationPositionMap(text);
        const normalizedQuery = SearchUtils.normalizeText(query);

        // Split both texts into words
        const textWords = normalizedText.split(/\s+/);
        const queryWords = normalizedQuery.split(/\s+/);

        for (const queryWord of queryWords) {
            for (let i = 0; i < textWords.length; i++) {
                const textWord = textWords[i];
                const match = this.fuzzyMatch(textWord, queryWord, { wholeWord: true });

                if (match) {
                    // Find start position of this word in normalized text
                    const wordStartNormalized = normalizedText.indexOf(textWord, i > 0 ? normalizedText.indexOf(textWords[i-1]) + textWords[i-1].length + 1 : 0);
                    const originalPosition = SearchUtils.mapNormalizedPositionToOriginal(wordStartNormalized, positionMap);
                    
                    matches.push({
                        ...match,
                        queryWord: queryWord,
                        textWord: textWord,
                        position: originalPosition,
                        normalizedPosition: wordStartNormalized
                    });
                }
            }
        }

        // Sort by score descending
        return matches.sort((a, b) => b.score - a.score);
    }
}

// Export for use in other modules
window.FuzzyMatcher = FuzzyMatcher;