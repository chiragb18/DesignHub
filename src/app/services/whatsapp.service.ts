import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class WhatsappService {
    private http = inject(HttpClient);

    // User-provided configuration
    private readonly PHONE_NUMBER_ID = '993959337130817';
    private readonly ACCESS_TOKEN = 'EAARFchnUcjoBQzdtfOTSQ6ZBPvkWX48HUHdJd6XZCfWquK8Lh63LhYXxtGTwXzKSgde9GlTWNFDZBbXCxw0tZCOjnsnfpvZBtzke9XjlqKmFAxdEWWryCbZAC2deL09JFL645MdsnLo3Jo8fUPsRAZCBNrD1WUA4WDAUB90KRUY1vEMZCmHA6QRuJPJ3gZCKM8Gwx1QZDZD';
    private readonly API_VERSION = 'v19.0';
    private readonly BASE_URL = `https://graph.facebook.com/${this.API_VERSION}/${this.PHONE_NUMBER_ID}/media`;

    /**
     * Uploads an image blob to WhatsApp Media API
     * @param imageBlob The image data as a Blob
     * @returns The media ID returned by WhatsApp
     */
    async uploadMedia(imageBlob: Blob): Promise<string> {
        const formData = new FormData();
        formData.append('file', imageBlob, 'design.jpg');
        formData.append('type', 'image/jpeg');
        formData.append('messaging_product', 'whatsapp');

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${this.ACCESS_TOKEN}`
        });

        try {
            console.log('[WhatsappService] Uploading media to WhatsApp...');
            const response: any = await lastValueFrom(
                this.http.post(this.BASE_URL, formData, { headers })
            );

            if (response && response.id) {
                console.log('[WhatsappService] WhatsApp Media ID:', response.id);
                return response.id;
            }

            throw new Error('Invalid response from WhatsApp API');
        } catch (error) {
            console.error('[WhatsappService] WhatsApp Upload Error:', error);
            throw error;
        }
    }
}
