import { Injectable } from '@angular/core';
import Sanscript from '@indic-transliteration/sanscript';

@Injectable({
    providedIn: 'root'
})
export class TransliterationService {
    /**
     * Transliterates phonetic English to Marathi (Devanagari)
     * It handles emojis and existing Marathi text by splitting.
     */
    public transliterate(text: string): string {
        if (!text) return '';

        // We only want to transliterate English characters.
        // Emojis and Devanagari should be preserved.
        // Rule: Transliterate sequences of A-Z, a-z.

        // This is a simple strategy:
        // Split by non-alphabetic characters (including spaces, emojis, punctuation),
        // transliterate the alphabetic parts, then join back.

        // However, ITRANS uses some symbols like ^ or .
        // For general phonetic typing, we can stick to a simpler regex.

        return text.replace(/[A-Za-z']+/g, (match) => {
            // Convert to Devanagari using itrans scheme
            // Sanscript.t(text, from, to)
            let dev = Sanscript.t(match.toLowerCase(), 'itrans', 'devanagari');

            // Some adjustments for common phonetic expectations if needed
            // e.g., 'a' at the end of a word in Marathi often should be silent if it's not 'aa'
            // but 'sanscript' handles ITRANS which is quite standard.

            return dev;
        });
    }

    /**
   * Converts Devanagari back to ITRANS (English phonetic)
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

        // We allow case-sensitive input so users can type 'L' for 'ळ' or 'T' for 'ट'.
        // We pre-process some common double-vowel expectations for a smoother feel.
        let processed = input
            .replace(/aa/g, 'A')
            .replace(/ee/g, 'I')
            .replace(/oo/g, 'U')
            .replace(/shh/g, 'Sh')
            .replace(/chh/g, 'Ch');

        let result = Sanscript.t(processed, 'itrans', 'devanagari');

        // Natural Marathi: Remove trailing virama for a soft stop 
        // (e.g., 'shubh' -> 'शुभ' instead of 'शुभ्').
        if (result.length > 1 && result.endsWith('्')) {
            result = result.substring(0, result.length - 1);
        }

        return result;
    }
}
