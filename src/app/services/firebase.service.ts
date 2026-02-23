import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc, query, where, orderBy } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { from, Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class FirebaseService {
    private firestore = inject(Firestore);
    private storage = inject(Storage);

    // --- Storage Operations ---

    async uploadFile(path: string, blob: Blob): Promise<string> {
        const storageRef = ref(this.storage, path);
        const result = await uploadBytes(storageRef, blob);
        return await getDownloadURL(result.ref);
    }

    async deleteFile(path: string): Promise<void> {
        const storageRef = ref(this.storage, path);
        return await deleteObject(storageRef);
    }

    // --- Firestore Operations ---

    async saveDocument(collectionName: string, docId: string, data: any): Promise<void> {
        const docRef = doc(this.firestore, collectionName, docId);
        // Merge true to avoid overwriting fields not present in data (though setDoc usually overwrites unless merge is true)
        return await setDoc(docRef, data, { merge: true });
    }

    async getDocument(collectionName: string, docId: string): Promise<any> {
        const docRef = doc(this.firestore, collectionName, docId);
        const snap = await getDoc(docRef);
        return snap.exists() ? snap.data() : null;
    }

    async getCollection(collectionName: string, constraints: any[] = []): Promise<any[]> {
        const colRef = collection(this.firestore, collectionName);
        const q = query(colRef, ...constraints);
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    async deleteDocument(collectionName: string, docId: string): Promise<void> {
        const docRef = doc(this.firestore, collectionName, docId);
        return await deleteDoc(docRef);
    }
}
