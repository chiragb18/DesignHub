import { Injectable } from '@angular/core';
import Sanscript from '@indic-transliteration/sanscript';

@Injectable({
    providedIn: 'root',
})
export class TransliterationService {
    /**
     * Transliterates phonetic English to Marathi (Devanagari)
     * It handles emojis and existing Marathi text by splitting.
     */
    public transliterate(text: string): string {
        if (!text) return '';

        // Strategy: Replace only Latin word blocks with optional markers to preserve emojis, digits and formatting.
        // We use a regex that captures Latin words that might be mixed with already transliterated Marathi.
        return text.replace(/([\u0900-\u097FA-Za-z0-9'_\^]*[A-Za-z][\u0900-\u097FA-Za-z0-9'_\^]*)/g, (match) => {
            try {
                // If it contains Marathi characters, convert to ITRANS first
                const isMixed = /[\u0900-\u097F]/.test(match);
                const itransWord = isMixed ? this.toItrans(match) : match;
                const result = this.phoneticMarathi(itransWord);
                return result || match;
            } catch (e) {
                console.error('[TransliterationService] Error in transliterate:', e);
                return match;
            }
        });
    }

    /**
     * Converts Devanagari back to ITRANS (English phonetic)
     * Useful for "re-reading" partially typed words.
     */
    public toItrans(text: string): string {
        if (!text) return '';
        return Sanscript.t(text, 'devanagari', 'itrans');
    }

    /**
     * A more advanced transliterator that handles vowels at the end of words
     * more naturally for Marathi phonetic typing.
     */
    public phoneticMarathi(input: string): string {
        if (!input) return '';

        // Allow case-sensitive input for precise mapping
        // Pre-process common phonetic patterns for natural Marathi feel
        let processed = input
            .replace(/aa/g, 'A')
            .replace(/ee/g, 'I')
            .replace(/oo/g, 'U')
            .replace(/shh/g, 'Sh')
            .replace(/chh/g, 'Ch')
            .replace(/w/g, 'v')
            .replace(/W/g, 'v')
            .replace(/Z/g, 'J')
            .replace(/z/g, 'j');

        // Use Sanscript for ITRANS to Devanagari conversion
        let result = Sanscript.t(processed, 'itrans', 'devanagari');

        // Natural Marathi stop: Only remove trailing halant ('्') if:
        // 1. It's not a single consonant (avoid 'b' -> '')
        // 2. The user didn't explicitly use halant markers like '_' or '^'
        if (result.length > 1 && result.endsWith('्') && !input.endsWith('_') && !input.endsWith('^')) {
            result = result.substring(0, result.length - 1);
        }

        return result;
    }
}
