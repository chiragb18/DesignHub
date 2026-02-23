import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import * as _Sanscript from '@indic-transliteration/sanscript';

const Sanscript = (_Sanscript as any).default || _Sanscript;

@Injectable({
    providedIn: 'root',
})
export class TransliterationService {
    private http = inject(HttpClient);

    /**
     * Google Input Tools API for Marathi (extremely accurate)
     */
    public async getGoogleTransliteration(text: string): Promise<string> {
        if (!text.trim()) return text;
        try {
            // itc=mr-t-i0-und is the code for Marathi Transliteration
            const url = `https://inputtools.google.com/request?text=${encodeURIComponent(text)}&itc=mr-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8&app=test`;
            const response: any = await lastValueFrom(this.http.get(url));
            if (response && response[0] === 'SUCCESS' && response[1] && Array.isArray(response[1])) {
                // Google returns an array of segments. Join all first-choice transliterations.
                return response[1].map((segment: any) => {
                    try {
                        return (segment && segment[1] && segment[1][0]) ? segment[1][0] : (segment[0] || '');
                    } catch (e) {
                        return segment[0] || '';
                    }
                }).join('');
            }
        } catch (e) {
            console.error('[TransliterationService] Google API Error:', e);
        }
        return this.transliterateLocal(text);
    }

    /**
     * Fallback local transliteration using Sanscript
     */
    public transliterateLocal(text: string, isEnd: boolean = false): string {
        if (!text) return '';
        if (!Sanscript || typeof Sanscript.t !== 'function') return text;

        let processed = text
            .replace(/chh/g, 'CHH_TMP').replace(/ch/g, 'c').replace(/CHH_TMP/g, 'ch')
            .replace(/ksh/g, 'kS').replace(/Ksh/g, 'kS')
            .replace(/shh/g, 'Sh')
            .replace(/jn/g, 'j~n').replace(/dn/g, 'j~n').replace(/gy/g, 'j~n')
            .replace(/aa/g, 'A').replace(/AA/g, 'A')
            .replace(/ee/g, 'I').replace(/EE/g, 'I')
            .replace(/oo/g, 'U').replace(/OO/g, 'U')
            .replace(/w/g, 'v').replace(/W/g, 'v')
            .replace(/z/g, 'j').replace(/Z/g, 'j')
            .replace(/([kgcjtdpb])h/g, '$1H'); // Handle aspiration more strictly

        let result = Sanscript.t(processed, 'itrans', 'devanagari');

        if (isEnd && result.length > 1 && result.endsWith('्') && !text.endsWith('_')) {
            result = result.substring(0, result.length - 1);
        }
        return result;
    }

    public toItrans(text: string): string {
        if (!text || !Sanscript) return text || '';
        return Sanscript.t(text, 'devanagari', 'itrans');
    }

    /**
     * Translation (Meaning-based) with improved accuracy parameters
     */
    public async translateToMarathi(text: string): Promise<string> {
        if (!text.trim()) return text;
        try {
            // Using more parameters for better accuracy (sl=auto for automatic language detection)
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=mr&dt=t&dt=at&dt=bd&dt=rm&q=${encodeURIComponent(text)}`;
            const response: any = await lastValueFrom(this.http.get(url));
            if (response && response[0]) {
                const translatedText = response[0].map((s: any) => s[0]).join('');
                return translatedText || text;
            }
        } catch (e) {
            console.error('[TransliterationService] Translation error:', e);
        }
        return text;
    }
}
