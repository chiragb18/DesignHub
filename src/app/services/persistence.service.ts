import { Injectable } from '@angular/core';

/**
 * Senior Frontend Engineer's Offline Persistence Utility
 * 
 * This service provides a robust, browser-compatible interface for IndexedDB.
 * It handles structured JSON (designs) and binary data (images).
 * 
 * Features:
 * - Versioned database upgrades
 * - Blob storage with size limits
 * - Error handling and transactional integrity
 */

@Injectable({
    providedIn: 'root'
})
export class PersistenceService {
    private readonly DB_NAME = 'DesignEditorDB';
    private readonly DB_VERSION = 1;
    private readonly MAX_BLOB_SIZE = 50 * 1024 * 1024; // 50MB limit

    private dbPromise: Promise<IDBDatabase>;

    constructor() {
        this.dbPromise = this.initDB();
    }

    /**
     * Initializes the IndexedDB database and creates object stores.
     */
    private initDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result;

                // Store for Fabric.js canvas JSON data
                if (!db.objectStoreNames.contains('designs')) {
                    db.createObjectStore('designs', { keyPath: 'id' });
                }

                // Store for binary image Blobs
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images', { keyPath: 'id' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.error('IndexedDB initialization failed:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Saves a Fabric.js canvas design to the database.
     * @param id Unique identifier for the design
     * @param canvas Fabric.js canvas instance
     */
    /**
     * Saves a design to the persistence store.
     * @param id Unique identifier
     * @param canvasOrJson Either a Fabric.js canvas or a pre-serialized JSON object
     */
    async saveDesign(id: string, canvasOrJson: any): Promise<void> {
        const db = await this.dbPromise;

        let json: any;
        if (canvasOrJson && typeof (canvasOrJson as any).toJSON === 'function') {
            json = (canvasOrJson as any).toJSON();
        } else {
            json = canvasOrJson;
        }

        const designData = {
            id,
            json,
            timestamp: Date.now()
        };

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['designs'], 'readwrite');
            const store = transaction.objectStore('designs');
            const request = store.put(designData);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Retrieves a design from the persistence store.
     */
    async getDesign(id: string): Promise<any | null> {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['designs'], 'readonly');
            const store = transaction.objectStore('designs');
            const request = store.get(id);

            request.onsuccess = () => {
                resolve(request.result ? request.result.json : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Loads a Fabric.js canvas design and applies it to the canvas.
     * @param id Unique identifier for the design
     * @param canvas Fabric.js canvas instance
     */
    async loadDesign(id: string, canvas: any): Promise<void> {
        const db = await this.dbPromise;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['designs'], 'readonly');
            const store = transaction.objectStore('designs');
            const request = store.get(id);

            request.onsuccess = () => {
                const data = request.result;
                if (data && data.json) {
                    canvas.loadFromJSON(data.json, () => {
                        canvas.renderAll();
                        resolve();
                    });
                } else {
                    reject(new Error(`Design with id "${id}" not found.`));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Saves an image Blob to the database.
     * @param id Unique identifier for the image
     * @param file Blob or File object
     */
    async saveImage(id: string, file: Blob): Promise<void> {
        if (file.size > this.MAX_BLOB_SIZE) {
            throw new Error('File size exceeds 50MB limit.');
        }

        const db = await this.dbPromise;
        const imageData = {
            id,
            blob: file,
            type: file.type,
            timestamp: Date.now()
        };

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');
            const request = store.put(imageData);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Retrieves an image Blob from the database.
     * @param id Unique identifier for the image
     * @returns Promise resolving to the Blob or null
     */
    async loadImage(id: string): Promise<Blob | null> {
        const db = await this.dbPromise;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');
            const request = store.get(id);

            request.onsuccess = () => {
                resolve(request.result ? request.result.blob : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Helper to create a temporary Object URL from a Blob for rendering.
     * @param blob The binary data
     * @returns A temporary URL string
     */
    createObjectURL(blob: Blob): string {
        return URL.createObjectURL(blob);
    }
}
