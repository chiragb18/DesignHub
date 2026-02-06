import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class ImageStorageService {
    private dbName = 'BannerAppDB';
    private storeName = 'images';
    private dbPromise: Promise<IDBDatabase>;

    constructor() {
        this.dbPromise = this.initDB();
    }

    private initDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 3); // Bumped version for cutouts

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings');
                }
                if (!db.objectStoreNames.contains('cutouts')) {
                    db.createObjectStore('cutouts', { keyPath: 'id' });
                }
            };
        });
    }

    async saveTemplates(templates: any[]): Promise<void> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['settings'], 'readwrite');
            const store = transaction.objectStore('settings');
            const request = store.put(templates, 'custom_templates');

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getTemplates(): Promise<any[]> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get('custom_templates');

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async saveImage(blob: Blob): Promise<string> {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const id = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);

            const checkReq = store.get(id);

            checkReq.onsuccess = () => {
                if (checkReq.result) {
                    resolve(id);
                } else {
                    const request = store.add({ id, blob, timestamp: Date.now() });
                    request.onsuccess = () => resolve(id);
                    request.onerror = () => reject(request.error);
                }
            };

            checkReq.onerror = () => reject(checkReq.error);
        });
    }

    async getImage(id: string): Promise<Blob | null> {
        try {
            const db = await this.dbPromise;
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(this.storeName, 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.get(id);

                request.onsuccess = () => {
                    resolve(request.result ? request.result.blob : null);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error('Error fetching image from DB', e);
            return null;
        }
    }

    async saveAutosave(jsonStr: string): Promise<void> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['settings'], 'readwrite');
            const store = transaction.objectStore('settings');
            const request = store.put(jsonStr, 'autosave_state');

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getAutosave(): Promise<string | null> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get('autosave_state');

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    blobToDataURL(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async saveProjects(projects: any[]): Promise<void> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['settings'], 'readwrite');
            const store = transaction.objectStore('settings');
            const request = store.put(projects, 'saved_projects');

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getProjects(): Promise<any[]> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get('saved_projects');

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    // Cutouts Management
    async saveCutout(blob: Blob, name: string): Promise<string> {
        const id = 'cutout_' + Date.now();
        const thumbnail = await this.blobToDataURL(blob);
        const db = await this.dbPromise;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction('cutouts', 'readwrite');
            const store = transaction.objectStore('cutouts');
            const request = store.add({
                id,
                blob,
                thumbnail,
                name,
                timestamp: Date.now()
            });

            request.onsuccess = () => resolve(id);
            request.onerror = () => reject(request.error);
        });
    }

    async getCutouts(): Promise<any[]> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('cutouts', 'readonly');
            const store = transaction.objectStore('cutouts');
            const request = store.getAll();

            request.onsuccess = () => {
                const results = request.result || [];
                // Sort by timestamp descending
                resolve(results.sort((a: any, b: any) => b.timestamp - a.timestamp));
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deleteCutout(id: string): Promise<void> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('cutouts', 'readwrite');
            const store = transaction.objectStore('cutouts');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async renameCutout(id: string, newName: string): Promise<void> {
        const db = await this.dbPromise;
        const transaction = db.transaction('cutouts', 'readwrite');
        const store = transaction.objectStore('cutouts');

        return new Promise((resolve, reject) => {
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const data = getRequest.result;
                if (data) {
                    data.name = newName;
                    const putRequest = store.put(data);
                    putRequest.onsuccess = () => resolve();
                    putRequest.onerror = () => reject(putRequest.error);
                } else {
                    reject(new Error('Cutout not found'));
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async saveApiKey(key: string): Promise<void> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['settings'], 'readwrite');
            const store = transaction.objectStore('settings');
            const request = store.put(key, 'clipdrop_api_key');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getApiKey(): Promise<string | null> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get('clipdrop_api_key');
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }
}
