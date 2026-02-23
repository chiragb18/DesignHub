import { Injectable, inject } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { ImageStorageService } from './image-storage.service';
import { Template } from './banner.service';
import { Firestore, collection, getDocs, query, orderBy } from '@angular/fire/firestore';

@Injectable({
    providedIn: 'root'
})
export class BannerCloudService {
    private firebase = inject(FirebaseService);
    private imageStorage = inject(ImageStorageService);
    private firestore = inject(Firestore);

    // --- Cloud Saving Logic ---

    /**
     * Saves a full design to the cloud.
     * 1. Uploads the thumbnail.
     * 2. Scans the canvas JSON for blob/idb images.
     * 3. Uploads those images to Storage.
     * 4. Replaces local URLs with Cloud URLs in the JSON.
     * 5. Saves the metadata and cloud-ready JSON to Firestore.
     */
    async saveTemplateToCloud(template: Template, canvasJson: any): Promise<void> {
        const designId = template.id;
        const basePath = `designs/${designId}`;

        // 1. Upload Thumbnail
        let thumbnailUrl = template.thumbnail;
        if (thumbnailUrl.startsWith('data:')) {
            const thumbBlob = this.dataURLtoBlob(thumbnailUrl);
            thumbnailUrl = await this.firebase.uploadFile(`${basePath}/thumbnail.jpg`, thumbBlob);
        }

        // 2. Prepare JSON for Cloud
        // Deep clone to avoid mutating the original object passed in
        const cloudJson = JSON.parse(JSON.stringify(canvasJson));

        // 3. Process Images in JSON
        await this.uploadJsonImages(cloudJson, basePath);

        // 4. Construct Firestore Document
        const docData = {
            id: designId,
            name: template.name,
            category: template.category,
            thumbnail: thumbnailUrl,
            json: JSON.stringify(cloudJson), // Store as string to avoid Firestore nesting limits or indexing issues
            created: Date.now(),
            updated: Date.now(),
            isSystem: template.isSystem || false,
            isCustom: template.isCustom || true,
            tags: template.tags || []
        };

        // 5. Save to Firestore
        const collectionName = template.isSystem ? 'system_templates' : 'user_designs';
        await this.firebase.saveDocument(collectionName, designId, docData);
    }

    // --- Cloud Loading Logic ---

    async getSystemTemplates(): Promise<Template[]> {
        let firebaseTemplates: Template[] = [];
        try {
            const colRef = collection(this.firestore, 'system_templates');
            const q = query(colRef, orderBy('created', 'desc'));
            const snapshot = await getDocs(q);
            firebaseTemplates = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data['name'],
                    category: data['category'],
                    thumbnail: data['thumbnail'],
                    json: data['json'] ? JSON.parse(data['json']) : null,
                    isCustom: false,
                    isSystem: true,
                    date: new Date(data['created'])
                };
            });
        } catch (e) {
            console.warn('[Cloud] Failed to fetch system templates from Firebase', e);
        }

        // Also try to load "bundled" templates from the local assets folder
        // This allows high-speed loading and "offline" baseline templates
        let bundledTemplates: Template[] = [];
        try {
            const response = await fetch('/assets/templates/system_templates.json');
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data)) {
                    bundledTemplates = data.map(t => ({
                        ...t,
                        isSystem: true,
                        isCustom: false
                    }));
                    console.log(`[Cloud] Loaded ${bundledTemplates.length} bundled templates from assets.`);
                }
            }
        } catch (e) {
            // This is expected if the file doesn't exist yet
            console.log('[Cloud] No bundled system_templates.json found in assets.');
        }

        // Merge both, prioritizing Firebase for updates but using Bundled as baseline
        // Filter out duplicates by ID
        const finalMap = new Map<string, Template>();
        bundledTemplates.forEach(t => finalMap.set(t.id, t));
        firebaseTemplates.forEach(t => finalMap.set(t.id, t));

        return Array.from(finalMap.values());
    }

    async getUserDesigns(): Promise<Template[]> {
        const colRef = collection(this.firestore, 'user_designs');
        const q = query(colRef, orderBy('updated', 'desc'));
        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => {
            const data = doc.data();
            const date = data['updated'] ? new Date(data['updated']) : (data['created'] ? new Date(data['created']) : new Date());
            return {
                id: doc.id,
                name: data['name'],
                category: data['category'] || 'Design',
                thumbnail: data['thumbnail'],
                json: data['json'] ? JSON.parse(data['json']) : null,
                isCustom: true,
                isSystem: false,
                date: date
            };
        });
    }

    // --- Projects Cloud Logic ---

    async saveProjectToCloud(project: any, canvasJson: any): Promise<void> {
        const designId = project.id;
        const basePath = `projects/${designId}`;

        // 1. Upload Thumbnail
        let thumbnailUrl = project.thumbnail;
        if (thumbnailUrl && thumbnailUrl.startsWith('data:')) {
            const thumbBlob = this.dataURLtoBlob(thumbnailUrl);
            thumbnailUrl = await this.firebase.uploadFile(`${basePath}/thumbnail.jpg`, thumbBlob);
        }

        // 2. Prepare JSON
        const cloudJson = JSON.parse(JSON.stringify(canvasJson));
        await this.uploadJsonImages(cloudJson, basePath);

        // 3. Document
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

    async getCloudProjects(): Promise<any[]> {
        const colRef = collection(this.firestore, 'user_projects');
        const q = query(colRef, orderBy('updated', 'desc'));
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
    }

    // --- Cutouts Cloud Logic ---

    async uploadCutoutToCloud(cutout: any): Promise<string> {
        const basePath = `cutouts/${cutout.id}`;

        // 1. Upload Blob
        const blobUrl = await this.firebase.uploadFile(`${basePath}/original.${cutout.blob.type.split('/')[1] || 'png'}`, cutout.blob);

        // 2. Upload Thumbnail (if separate, but usually data URL)
        let thumbnailUrl = cutout.thumbnail;
        if (thumbnailUrl && thumbnailUrl.startsWith('data:')) {
            const thumbBlob = this.dataURLtoBlob(thumbnailUrl);
            thumbnailUrl = await this.firebase.uploadFile(`${basePath}/thumbnail.jpg`, thumbBlob);
        }

        // 3. Metadata in Firestore
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

    async getCloudCutouts(): Promise<any[]> {
        const colRef = collection(this.firestore, 'user_cutouts');
        const q = query(colRef, orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);

        const cutouts = await Promise.all(snapshot.docs.map(async doc => {
            const data = doc.data();

            // For cutouts, we might need to fetch the blob back to local for performance
            // but for now, we'll return the metadata + cloud URLs.
            // A more robust implementation would lazy-load the blob.
            return {
                id: doc.id,
                name: data['name'],
                thumbnail: data['thumbnail'],
                cloudUrl: data['blobUrl'],
                timestamp: data['timestamp']
            };
        }));

        return cutouts;
    }

    // --- Deletion Cloud Logic ---

    async deleteDesignFromCloud(id: string): Promise<void> {
        // We don't necessarily delete the assets (images) immediately because they might be shared,
        // but we delete the metadata/JSON document.
        await this.firebase.deleteDocument('user_designs', id);
        // Also check system_templates just in case (though usually users can't delete them)
        try { await this.firebase.deleteDocument('system_templates', id); } catch (e) { }
    }

    async deleteProjectFromCloud(id: string): Promise<void> {
        await this.firebase.deleteDocument('user_projects', id);
    }

    async deleteCutoutFromCloud(id: string): Promise<void> {
        await this.firebase.deleteDocument('user_cutouts', id);
    }

    // --- Helper Methods ---

    private async uploadJsonImages(json: any, basePath: string): Promise<void> {
        if (!json) return;

        const processObj = async (obj: any) => {
            if (!obj || typeof obj !== 'object') return;

            // Check for image sources
            for (const key of ['src', 'originalSrc', 'originalImageSrc']) {
                const val = obj[key];
                // We look for 'indexeddb://' which is how local images are referenced in this app
                if (typeof val === 'string' && val.startsWith('indexeddb://')) {
                    const id = val.replace('indexeddb://', '');
                    try {
                        const blob = await this.imageStorage.getImage(id);
                        if (blob) {
                            const extension = blob.type.split('/')[1] || 'png';
                            // Upload to Firebase Storage
                            // Use the image hash ID to avoid duplicates if possible, or random
                            const cloudUrl = await this.firebase.uploadFile(`${basePath}/images/${id}.${extension}`, blob);
                            obj[key] = cloudUrl;
                            console.log(`Uploaded ${id} to ${cloudUrl}`);
                        }
                    } catch (e) {
                        console.error(`Failed to upload image ${id} to cloud`, e);
                        // Fallback: Leave as is? Or clear? 
                        // If we leave it as indexeddb:// it won't load on other devices.
                    }
                }
            }

            // Check for Patterns
            for (const prop of ['fill', 'stroke']) {
                const val = obj[prop];
                if (val && typeof val === 'object' && val.type === 'pattern' && typeof val.source === 'string' && val.source.startsWith('indexeddb://')) {
                    const id = val.source.replace('indexeddb://', '');
                    try {
                        const blob = await this.imageStorage.getImage(id);
                        if (blob) {
                            const extension = blob.type.split('/')[1] || 'png';
                            const cloudUrl = await this.firebase.uploadFile(`${basePath}/patterns/${id}.${extension}`, blob);
                            val.source = cloudUrl;
                        }
                    } catch (e) { console.error('Pattern upload failed', e) }
                }
            }

            // Recursion
            if (Array.isArray(obj.objects)) {
                await Promise.all(obj.objects.map((o: any) => processObj(o)));
            }
            if (obj.backgroundImage) await processObj(obj.backgroundImage);
            if (obj.overlayImage) await processObj(obj.overlayImage);
            if (obj.clipPath) await processObj(obj.clipPath);
        };

        // Start with root objects
        if (Array.isArray(json.objects)) {
            await Promise.all(json.objects.map((o: any) => processObj(o)));
        }
        if (json.backgroundImage) await processObj(json.backgroundImage);
        if (json.overlayImage) await processObj(json.overlayImage);
    }

    private dataURLtoBlob(dataurl: string): Blob {
        const arr = dataurl.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }
}
