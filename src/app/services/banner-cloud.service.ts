import { Injectable, inject } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { ImageStorageService } from './image-storage.service';
import { Template } from './banner.service';
import { Firestore, collection, getDocs, query, orderBy, limit } from '@angular/fire/firestore';

@Injectable({
    providedIn: 'root'
})
export class BannerCloudService {
    private firebase = inject(FirebaseService);
    private imageStorage = inject(ImageStorageService);
    private firestore = inject(Firestore);

    // --- Cloud Saving Logic ---

    async saveTemplateToCloud(template: Template, canvasJson: any): Promise<void> {
        if (!this.firebase.isFirebaseConfigured()) return;
        const designId = template.id;
        const basePath = `designs/${designId}`;

        let thumbnailUrl = template.thumbnail;
        if (thumbnailUrl && thumbnailUrl.startsWith('data:')) {
            const thumbBlob = this.dataURLtoBlob(thumbnailUrl);
            thumbnailUrl = await this.firebase.uploadFile(`${basePath}/thumbnail.jpg`, thumbBlob);
        }

        const cloudJson = JSON.parse(JSON.stringify(canvasJson));
        await this.uploadJsonImages(cloudJson, basePath);

        const docData = {
            id: designId,
            name: template.name,
            category: template.category,
            thumbnail: thumbnailUrl,
            json: JSON.stringify(cloudJson),
            created: Date.now(),
            updated: Date.now(),
            isSystem: template.isSystem || false,
            isCustom: template.isCustom || true
        };

        const collectionName = template.isSystem ? 'system_templates' : 'user_designs';
        await this.firebase.saveDocument(collectionName, designId, docData);
    }

    // --- Optimized Cloud Loading Logic ---

    /**
     * LOCAL ONLY: Fetches bundled templates from the assets folder.
     * This is used for Phase 1 (instant load).
     */
    async getBundledTemplates(): Promise<Template[]> {
        // We use relative path for maximum portability across local & Vercel
        const assetPath = '/assets/templates/system_templates.json';
        try {
            const response = await fetch(assetPath);
            if (!response.ok) {
                console.warn(`[Cloud] Assets file not found at ${assetPath} (Status ${response.status})`);
                return [];
            }
            const data = await response.json();
            if (Array.isArray(data)) {
                return data.map(t => ({
                    ...t,
                    isSystem: true,
                    isCustom: false,
                    date: t.date ? new Date(t.date) : new Date(2024, 0, 1)
                }));
            }
        } catch (e) {
            console.error('[Cloud] Failed to parse bundled assets JSON:', e);
        }
        return [];
    }

    /**
     * CLOUD ONLY: Fetches system templates from Firestore.
     * Includes a timeout.
     */
    async getCloudSystemTemplates(): Promise<Template[]> {
        return this.withTimeout(async () => {
            const colRef = collection(this.firestore, 'system_templates');
            const q = query(colRef, orderBy('updated', 'desc'), limit(50));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data['name'],
                    category: data['category'] || 'Template',
                    thumbnail: data['thumbnail'],
                    json: data['json'] ? JSON.parse(data['json']) : null,
                    isCustom: false,
                    isSystem: true,
                    date: data['updated'] ? new Date(data['updated']) : (data['created'] ? new Date(data['created']) : new Date())
                };
            });
        }, 5000, 'Cloud System Templates');
    }

    /**
     * CLOUD ONLY: Fetches user designs from Firestore.
     * Includes a timeout.
     */
    async getUserDesigns(): Promise<Template[]> {
        return this.withTimeout(async () => {
            const colRef = collection(this.firestore, 'user_designs');
            const q = query(colRef, orderBy('updated', 'desc'), limit(100));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data['name'],
                    category: data['category'] || 'Design',
                    thumbnail: data['thumbnail'],
                    json: data['json'] ? JSON.parse(data['json']) : null,
                    isCustom: true,
                    isSystem: false,
                    date: data['updated'] ? new Date(data['updated']) : (data['created'] ? new Date(data['created']) : new Date())
                };
            });
        }, 5000, 'User Designs');
    }

    // --- Projects Cloud Logic ---

    async getCloudProjects(): Promise<any[]> {
        return this.withTimeout(async () => {
            const colRef = collection(this.firestore, 'user_projects');
            const q = query(colRef, orderBy('updated', 'desc'), limit(50));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data['name'],
                    thumbnail: data['thumbnail'],
                    json: data['json'],
                    date: data['updated'] || data['created'] || Date.now()
                };
            });
        }, 5000, 'Cloud Projects');
    }

    async saveProjectToCloud(project: any, canvasJson: any): Promise<void> {
        // 1. Check if Firebase is actually configured with real keys
        if (!this.firebase.isFirebaseConfigured()) {
            console.log('[CloudSync] Skipped (Firebase is using placeholder config)');
            return;
        }

        const designId = project.id;
        const basePath = `projects/${designId}`;
        let thumbnailUrl = project.thumbnail;
        if (thumbnailUrl && thumbnailUrl.startsWith('data:')) {
            const thumbBlob = this.dataURLtoBlob(thumbnailUrl);
            thumbnailUrl = await this.firebase.uploadFile(`${basePath}/thumbnail.jpg`, thumbBlob);
        }
        const cloudJson = JSON.parse(JSON.stringify(canvasJson));
        await this.uploadJsonImages(cloudJson, basePath);
        const docData = {
            id: designId,
            name: project.name,
            thumbnail: thumbnailUrl,
            json: JSON.stringify(cloudJson),
            updated: Date.now(),
            created: project.date || Date.now()
        };
        await this.firebase.saveDocument('user_projects', designId, docData);
    }

    // --- Deletion & Other Logic ---

    async deleteDesignFromCloud(id: string): Promise<void> {
        await this.firebase.deleteDocument('user_designs', id);
        try { await this.firebase.deleteDocument('system_templates', id); } catch (e) { }
    }

    async deleteProjectFromCloud(id: string): Promise<void> {
        await this.firebase.deleteDocument('user_projects', id);
    }

    async deleteCutoutFromCloud(id: string): Promise<void> {
        await this.firebase.deleteDocument('user_cutouts', id);
    }

    async getCloudCutouts(): Promise<any[]> {
        return this.withTimeout(async () => {
            const colRef = collection(this.firestore, 'user_cutouts');
            const q = query(colRef, orderBy('timestamp', 'desc'), limit(100));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data['name'],
                    thumbnail: data['thumbnail'],
                    cloudUrl: data['blobUrl'],
                    timestamp: data['timestamp']
                };
            });
        }, 5000, 'Cloud Cutouts');
    }

    async uploadCutoutToCloud(cutout: any): Promise<string> {
        if (!this.firebase.isFirebaseConfigured()) return '';
        const basePath = `cutouts/${cutout.id}`;
        const blobUrl = await this.firebase.uploadFile(`${basePath}/original.png`, cutout.blob);
        let thumbnailUrl = cutout.thumbnail;
        if (thumbnailUrl && thumbnailUrl.startsWith('data:')) {
            const thumbBlob = this.dataURLtoBlob(thumbnailUrl);
            thumbnailUrl = await this.firebase.uploadFile(`${basePath}/thumbnail.jpg`, thumbBlob);
        }
        const docData = {
            id: cutout.id,
            name: cutout.name,
            thumbnail: thumbnailUrl,
            blobUrl: blobUrl,
            timestamp: cutout.timestamp || Date.now()
        };
        await this.firebase.saveDocument('user_cutouts', cutout.id, docData);
        return blobUrl;
    }

    // --- Helper Methods ---

    private async withTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${label} took more than ${ms}ms`)), ms)
        );
        try {
            return await Promise.race([fn(), timeout]);
        } catch (e) {
            console.warn(`[Cloud] ${label} failed or timed out:`, e);
            return [] as any; // Return empty array as fallback for list fetches
        }
    }

    private async uploadJsonImages(json: any, basePath: string): Promise<void> {
        if (!json) return;
        const processObj = async (obj: any) => {
            if (!obj || typeof obj !== 'object') return;
            for (const key of ['src', 'originalSrc', 'originalImageSrc']) {
                const val = obj[key];
                if (typeof val === 'string' && val.startsWith('indexeddb://')) {
                    const id = val.replace('indexeddb://', '');
                    try {
                        const blob = await this.imageStorage.getImage(id);
                        if (blob) {
                            const extension = blob.type.split('/')[1] || 'png';
                            const cloudUrl = await this.firebase.uploadFile(`${basePath}/images/${id}.${extension}`, blob);
                            obj[key] = cloudUrl;
                        }
                    } catch (e) { console.error('Image upload failed', e); }
                }
            }
            if (Array.isArray(obj.objects)) await Promise.all(obj.objects.map((o: any) => processObj(o)));
            if (obj.backgroundImage) await processObj(obj.backgroundImage);
            if (obj.clipPath) await processObj(obj.clipPath);
        };
        if (Array.isArray(json.objects)) await Promise.all(json.objects.map((o: any) => processObj(o)));
        if (json.backgroundImage) await processObj(json.backgroundImage);
    }

    private dataURLtoBlob(dataurl: string): Blob {
        const arr = dataurl.split(',');
        const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        return new Blob([u8arr], { type: mime });
    }
}
