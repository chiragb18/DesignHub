import { Injectable, signal, inject } from '@angular/core';
import * as fabric from 'fabric';
import { TransliterationService } from './transliteration.service';
import { ImageStorageService } from './image-storage.service';
import { PersistenceService } from './persistence.service';
import type { Config } from '@imgly/background-removal';
import { NotificationService } from './notification.service';

export interface SavedProject {
    id: string;
    name: string;
    json: string;
    thumbnail?: string;
    date: number;
}

export interface Template {
    id: string;
    name: string;
    category: string;
    thumbnail: string;
    json: any;
    isCustom: boolean;
    date?: Date;
    tags?: string[];
}

export interface Cutout {
    id: string;
    name: string;
    thumbnail: string;
    blob: Blob;
    timestamp: number;
}

@Injectable({
    providedIn: 'root'
})
export class BannerService {
    private canvas!: fabric.Canvas;
    private history: string[] = [];
    private historyStep: number = -1;
    private isHistoryLoading: boolean = false;
    private rbFunctionCache: any = null;

    // State signals
    public selectedObject = signal<fabric.Object | null>(null);
    public objects = signal<fabric.Object[]>([]);
    canvasState = signal<string | null>(null);
    zoomLevel = signal<number>(1);
    isCropping = signal<boolean>(false);

    // Brush & Eraser State
    public isDrawingMode = signal(false);
    public brushSize = signal(10);
    public brushColor = signal('#000000');
    public isErasing = signal(false);
    public eraserSize = signal(10);
    public activeTab = signal<string>('templates');
    public bgType = signal<'solid' | 'gradient' | 'pattern' | 'gravity'>('solid');
    public canvasColor = signal('#ffffff');
    public layersCount = signal(0);
    public savedProjects = signal<SavedProject[]>([]);
    public savedTemplates = signal<Template[]>([]);
    public savedDesigns = signal<Template[]>([]);
    public savedBackgrounds = signal<Template[]>([]);
    public activeTemplateId = signal<string | null>(null);
    public showTemplateInfo = signal(false);
    public isRemovingBg = signal(false);
    public cutouts = signal<Cutout[]>([]);
    public bgRemovalProgress = signal(0);
    public bgRemovalStatus = signal<string>('Preparing...');
    public typingLanguage = signal<'en' | 'mr'>('en');
    public isSaving = signal(false);
    public isProjectLoading = signal(false);
    public activeProjectId = signal<string | null>(null);
    public curvedText = signal<number>(0);
    public curvedImage = signal<number>(0);
    public isMobile = signal<boolean>(false);

    private cropOverlay: fabric.Rect | null = null;
    private cropTarget: fabric.Image | null = null;
    private highlightOutline: fabric.Rect | null = null;

    // Track blob URLs to prevent memory leaks
    private activeBlobUrls: string[] = [];

    // Props to include in JSON serialization
    private readonly SERIALIZE_PROPS = [
        'curvature', 'imageCurvature', 'isCurvedGroup', 'id', 'name',
        'originalImageSrc', 'maskType', 'maskHeight', 'maskFlip',
        'idbId', 'originalSrc', 'isBgRemoved', 'excludeFromExport',
        'opacity', 'visible', 'selectable', 'evented', 'lockMovementX', 'lockMovementY',
        'cropX', 'cropY', 'filters', 'clipPath'
    ];

    private imageStorage = inject(ImageStorageService);
    private translitService = inject(TransliterationService);
    private persistenceService = inject(PersistenceService);
    private notificationService = inject(NotificationService);

    constructor() { }

    async initCanvas(canvasId: string): Promise<void> {
        this.updateMobileState();

        let width = 1200;
        let height = 675;

        if (typeof window !== 'undefined') {
            if (window.innerWidth <= 1024) {
                width = window.innerWidth - 20;
                height = width * (675 / 1200);
            }
        }

        this.canvas = new fabric.Canvas(canvasId, {
            width: width,
            height: height,
            backgroundColor: '#ffffff',
            preserveObjectStacking: true,
            enableRetinaScaling: true,
            allowTouchScrolling: true,
            stopContextMenu: true
        });

        // Match initial zoom to design ratio (1200px base)
        const initialZoom = width / 1200;
        this.canvas.setZoom(initialZoom);
        this.zoomLevel.set(initialZoom);

        // Set initial gradient from user request
        this.setInitialGradient();

        this.setupEvents();
        this.setupZoomEvents();
        this.setupKeyboardEvents();
        this.initSavedProjects();
        this.initSavedTemplates();
        this.initCutouts();

        // LOGIC FOR "FRESH RUN" VS "REFRESH"
        // 1. Fresh Project Run (New tab/session) -> Starts with white canvas
        // 2. Page Refresh (Same tab/session) -> Restore "till now" work
        const isRefresh = typeof window !== 'undefined' && !!window.sessionStorage.getItem('banner_session_active');

        if (isRefresh) {
            console.log('[BannerService] Page refreshed: Restoring recently work...');
            await this.loadAutosave();
        } else {
            console.log('[BannerService] Fresh project load: Starting with white background');
            if (typeof window !== 'undefined') {
                window.sessionStorage.setItem('banner_session_active', 'true');
            }
        }

        this.refreshState();
        this.saveState();

        if (typeof window !== 'undefined') {
            window.addEventListener('resize', () => this.handleResize());
        }
    }

    private updateMobileState(): void {
        if (typeof window !== 'undefined') {
            this.isMobile.set(window.innerWidth < 768);
        }
    }

    private handleResize(): void {
        if (!this.canvas) return;
        this.updateMobileState();

        let width = 1200;
        if (window.innerWidth <= 1024) {
            width = window.innerWidth - 20;
        }

        const height = width * (675 / 1200);
        const zoom = width / 1200;

        this.canvas.setDimensions({ width, height });
        this.canvas.setZoom(zoom);
        this.zoomLevel.set(zoom);
        this.canvas.renderAll();
    }

    public brushType = signal<'pencil' | 'spray' | 'circle' | 'highlighter' | 'dotted'>('pencil');

    public toggleDrawingMode(enabled?: boolean): void {
        const currentlyDrawing = enabled !== undefined ? enabled : !this.isDrawingMode();

        if (currentlyDrawing) {
            this.isErasing.set(false);
            this.canvas.discardActiveObject();
            this.canvas.isDrawingMode = true;
            this.setBrushType(this.brushType());
        } else {
            this.canvas.isDrawingMode = false;
        }

        this.isDrawingMode.set(currentlyDrawing);
        this.canvas.renderAll();
    }

    public setBrushType(type: 'pencil' | 'spray' | 'circle' | 'highlighter' | 'dotted'): void {
        this.brushType.set(type);
        if (!this.canvas) return;

        let brush;
        const color = this.brushColor();
        const size = this.brushSize();

        switch (type) {
            case 'spray':
                brush = new (fabric as any).SprayBrush(this.canvas);
                brush.width = size * 2;
                brush.density = 20;
                brush.dotWidth = size / 5;
                brush.dotWidthVariance = size / 5;
                break;
            case 'circle':
                brush = new (fabric as any).CircleBrush(this.canvas);
                brush.width = size;
                break;
            case 'highlighter':
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size * 3;
                brush.color = color + '80'; // 50% opacity hex
                // Note: highlighter logic might need pure color handling if not hex
                break;
            case 'dotted':
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size;
                brush.strokeDashArray = [size * 2, size * 2];
                break;
            case 'pencil':
            default:
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size;
                break;
        }

        if (type !== 'highlighter') {
            brush.color = color;
        }

        this.canvas.freeDrawingBrush = brush;

        // Ensure standard width update for non-special brushes or if needed
        if (type === 'pencil' || type === 'dotted') {
            brush.width = size;
        }
    }

    public updateBrushSize(size: number): void {
        this.brushSize.set(size);
        if ((this.isDrawingMode() || this.isErasing()) && this.canvas.freeDrawingBrush) {
            this.canvas.freeDrawingBrush.width = Number(size);
        }
    }

    public updateBrushColor(color: string): void {
        this.brushColor.set(color);
        if (this.isDrawingMode() && this.canvas.freeDrawingBrush && !this.isErasing()) {
            this.canvas.freeDrawingBrush.color = color;
        }
    }

    public toggleEraser(enabled?: boolean): void {
        const currentlyErasing = enabled !== undefined ? enabled : !this.isErasing();

        if (currentlyErasing) {
            this.isDrawingMode.set(false);
            this.canvas.discardActiveObject();
            this.canvas.isDrawingMode = true;

            // Use a standard pencil brush with destination-out for erasing
            const eraser = new fabric.PencilBrush(this.canvas);
            eraser.width = this.brushSize(); // Share size or use eraserSize
            this.canvas.freeDrawingBrush = eraser;
            (this.canvas.freeDrawingBrush as any).globalCompositeOperation = 'destination-out';

            this.canvas.defaultCursor = 'crosshair';
        } else {
            this.canvas.isDrawingMode = false;
            this.canvas.defaultCursor = 'default';
        }

        this.isErasing.set(currentlyErasing);
        this.canvas.renderAll();
    }

    public updateEraserSize(size: number): void {
        this.eraserSize.set(size);
        if (this.isErasing() && this.canvas.freeDrawingBrush) {
            this.canvas.freeDrawingBrush.width = size;
        }
    }

    private setupKeyboardEvents(): void {
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                if (e.shiftKey) this.redo();
                else this.undo();
                e.preventDefault();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                this.redo();
                e.preventDefault();
            }
        });
    }

    private setupZoomEvents(): void {
        this.canvas.on('mouse:wheel', (opt) => {
            if (!opt.e.ctrlKey) return;
            const delta = opt.e.deltaY;
            let zoom = this.canvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 20) zoom = 20;
            if (zoom < 0.01) zoom = 0.01;
            this.canvas.setZoom(zoom);
            this.zoomLevel.set(zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });
    }

    private setupEvents(): void {
        this.canvas.on('object:added', () => {
            if (!this.isHistoryLoading) {
                this.refreshState();
                this.saveState();
            }
        });

        this.canvas.on('path:created', (e: any) => {
            if (this.isErasing()) {
                e.path.set({ globalCompositeOperation: 'destination-out' });
                this.canvas.renderAll();
            }
            if (!this.isHistoryLoading) {
                this.refreshState();
                this.saveState();
            }
        });

        this.canvas.on('object:removed', () => {
            if (!this.isHistoryLoading) {
                this.refreshState();
                this.saveState();
            }
        });

        const updateUI = () => {
            this.refreshState();
            this.triggerSelectedUpdate();
        };

        this.canvas.on('object:modified', () => {
            updateUI();
            if (!this.isHistoryLoading) this.saveState();
        });

        this.canvas.on('object:moving', updateUI);

        this.canvas.on('object:scaling', (e) => {
            const obj = e.target;
            if (obj && obj.type === 'textbox') {
                const textObj = obj as any;
                textObj.set({
                    fontSize: textObj.fontSize * textObj.scaleX,
                    scaleX: 1,
                    scaleY: 1
                });
            }
            updateUI();
        });

        this.canvas.on('object:rotating', updateUI);

        const handleSelection = (e: any) => {
            const selected = e.selected?.[0] || null;
            this.selectedObject.set(selected);
            this.refreshState();

            if (selected) {
                // Sync curvature state
                this.curvedText.set((selected as any).curvature || 0);
                this.curvedImage.set((selected as any).imageCurvature || 0);

                if (selected.type === 'textbox') {
                    this.activeTab.set('text');
                } else if (selected.type === 'image' || selected.type === 'group') {
                    this.activeTab.set('filters');
                } else if (['rect', 'circle', 'triangle', 'polygon', 'path'].includes(selected.type!)) {
                    this.activeTab.set('elements');
                }
            }
        };

        this.canvas.on('selection:created', handleSelection);
        this.canvas.on('selection:updated', handleSelection);
        this.canvas.on('selection:cleared', () => {
            this.selectedObject.set(null);
            this.refreshState();
        });

        // Transliteration interceptor
        this.canvas.on('text:changed', (e) => {
            const obj = e.target as fabric.Textbox;
            if (obj && this.typingLanguage() === 'mr' && (obj as any)._isTransliterating !== true) {
                this.applyTransliteration(obj);
            }
        });
    }

    private applyTransliteration(obj: fabric.Textbox): void {
        const text = obj.text || '';
        const selectionStart = obj.selectionStart || 0;
        const selectionEnd = obj.selectionEnd || 0;

        // Only process if it's a simple cursor (no selection range) and not at startup
        if (selectionStart !== selectionEnd || selectionStart === 0) return;

        const textBeforeCursor = text.substring(0, selectionStart);

        // 1. Determine the cluster to transliterate
        // We match ONLY the cluster of alphanumeric characters or special phonetic markers 
        // that is IMMEDIATELY before the cursor. This stops at spaces, punctuation, etc.
        const clusterMatch = textBeforeCursor.match(/([\u0900-\u097FA-Za-z0-9'_\^]+)$/);

        if (clusterMatch) {
            const currentWord = clusterMatch[1];
            const wordStart = selectionStart - currentWord.length;

            // 2. Only process if the cluster contains at least one English character
            if (!/[A-Za-z]/.test(currentWord)) {
                return;
            }

            try {
                // If it contains Marathi characters, convert everything to ITRANS first to allow phonetic editing
                const isMixed = /[\u0900-\u097F]/.test(currentWord);
                const itransWord = isMixed ? this.translitService.toItrans(currentWord) : currentWord;
                const transliterated = this.translitService.phoneticMarathi(itransWord);

                if (transliterated && transliterated !== currentWord) {
                    // Build the new text by replacing ONLY the current cluster
                    const newText = text.substring(0, wordStart) + transliterated + text.substring(selectionStart);

                    // Lock events during text replacement
                    (obj as any)._isTransliterating = true;
                    obj.set('text', newText);

                    // Maintain cursor position exactly after the transliterated word
                    const newCursor = wordStart + transliterated.length;
                    obj.setSelectionStart(newCursor);
                    obj.setSelectionEnd(newCursor);

                    // Ensure Devanagari font is applied
                    if (obj.get('fontFamily') !== 'Noto Sans Devanagari, sans-serif') {
                        obj.set('fontFamily', 'Noto Sans Devanagari, sans-serif');
                    }

                    this.canvas.requestRenderAll();

                    // Release lock after a short delay to allow Fabric internals to catch up
                    setTimeout(() => {
                        (obj as any)._isTransliterating = false;
                    }, 50);
                }
            } catch (err) {
                console.error('[Transliteration] Processing failed:', err);
                (obj as any)._isTransliterating = false;
            }
        }
    }

    private setInitialGradient(): void {
        this.canvas.backgroundColor = '#ffffff'; // White default
        this.canvasColor.set('#ffffff'); // Sync UI signal
        this.bgType.set('solid');
    }

    private triggerSelectedUpdate(): void {
        const active = this.canvas.getActiveObject();
        if (active) {
            this.selectedObject.set(null);
            this.selectedObject.set(active);
        }
    }

    private updateObjectsState(): void {
        const objs = this.canvas.getObjects();
        // Filter out strict internal objects (hover outline, crop overlay)
        const uiObjs = objs.filter(o =>
            o !== this.highlightOutline &&
            o !== this.cropOverlay &&
            o.excludeFromExport !== true // General check
        );

        this.objects.set([...uiObjs]);
        this.layersCount.set(uiObjs.length);
    }

    private refreshState(): void {
        this.updateObjectsState();
    }

    // private saveState(): void { // Old implementation removed for autosave version }

    async undo(): Promise<void> {
        if (this.historyStep > 0) {
            clearTimeout(this.timeoutId);
            this.isHistoryLoading = true;
            this.historyStep--;
            const stateJson = this.history[this.historyStep];
            try {
                let state = JSON.parse(stateJson);
                state = this.strictSanitize(state);
                // Ensure state is restored from IDB if it contains indexeddb refs
                await this.restoreImagesFromStorage(state);

                await this.canvas.loadFromJSON(state);
                this.canvas.renderAll();
                this.refreshState();
                this.isHistoryLoading = false;
            } catch (err) {
                console.error('Undo failed', err);
                this.isHistoryLoading = false;
            }
        }
    }

    async redo(): Promise<void> {
        if (this.historyStep < this.history.length - 1) {
            clearTimeout(this.timeoutId);
            this.isHistoryLoading = true;
            this.historyStep++;
            const stateJson = this.history[this.historyStep];
            try {
                let state = JSON.parse(stateJson);
                state = this.strictSanitize(state);
                // Ensure state is restored from IDB if it contains indexeddb refs
                await this.restoreImagesFromStorage(state);

                await this.canvas.loadFromJSON(state);
                this.canvas.renderAll();
                this.refreshState();
                this.isHistoryLoading = false;
            } catch (err) {
                console.error('Redo failed', err);
                this.isHistoryLoading = false;
            }
        }
    }


    resizeCanvas(width: number, height: number): void {
        this.canvas.setDimensions({ width, height });
        this.canvas.renderAll();
        this.saveState();
    }

    addText(text?: string, options: any = {}): void {
        const isMarathi = this.typingLanguage() === 'mr';
        const defaultText = text || (isMarathi ? 'येथे मजकूर लिहा' : 'Your Story Starts Here');

        const textbox = new fabric.Textbox(defaultText, {
            left: 100,
            top: 100,
            width: 400,
            fontSize: 48,
            fill: '#1e293b',
            fontFamily: isMarathi ? 'Noto Sans Devanagari, sans-serif' : 'Inter, sans-serif',
            textAlign: 'center',
            ...options
        });

        this.canvas.add(textbox);
        this.canvas.centerObject(textbox);
        this.canvas.setActiveObject(textbox);
        this.canvas.renderAll();
        this.saveState();
    }

    addShape(type: string): void {
        const commonOptions = {
            left: 200, top: 200,
            fill: 'transparent',
            stroke: '#000000',
            strokeWidth: 2,
            strokeUniform: true // Critical: Keeps 2px border even when scaled
        };

        let shape: fabric.Object;

        if (type === 'square') {
            shape = new fabric.Rect({ ...commonOptions, width: 120, height: 120, rx: 0, ry: 0 });
        } else if (type === 'rect') {
            shape = new fabric.Rect({ ...commonOptions, width: 180, height: 110, rx: 0, ry: 0 });
        } else if (type === 'circle') {
            shape = new fabric.Circle({ ...commonOptions, radius: 75, width: 150, height: 150 });
        } else if (type === 'triangle') {
            shape = new fabric.Triangle({ ...commonOptions, width: 150, height: 150 });
        } else if (type === 'star') {
            const points = this.calculateStarPoints(5, 75, 30);
            shape = new fabric.Polygon(points, { ...commonOptions, width: 150, height: 150 });
        } else if (type === 'heart') {
            // High-resolution symmetrical heart path (base 100x100)
            const pathData = 'M 50,25 C 50,25 45,10 30,10 C 15,10 5,22 5,40 C 5,65 50,90 50,90 C 50,90 95,65 95,40 C 95,22 85,10 70,10 C 55,10 50,25 50,25 Z';
            shape = new fabric.Path(pathData, {
                ...commonOptions,
                width: 100, height: 100,
                scaleX: 1.5, scaleY: 1.5
            });
        } else if (type === 'arrow') {
            const points = [
                { x: 0, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 20 },
                { x: 100, y: 60 }, { x: 60, y: 100 }, { x: 60, y: 70 }, { x: 0, y: 70 }
            ];
            shape = new fabric.Polygon(points, { ...commonOptions, width: 100, height: 120 });
        } else if (type === 'cloud') {
            const pathData = 'M 25,60 C 25,43 40,30 55,30 C 58,30 61,31 63,32 C 67,23 76,17 85,17 C 97,17 107,26 109,38 C 112,37 115,37 118,37 C 130,37 140,47 140,59 C 140,71 130,81 118,81 L 55,81 C 38,81 25,68 25,60 Z';
            shape = new fabric.Path(pathData, { ...commonOptions, width: 150, height: 150 });
        } else if (['hexagon', 'pentagon', 'octagon'].includes(type)) {
            const sides = type === 'hexagon' ? 6 : (type === 'pentagon' ? 5 : 8);
            const points = [];
            for (let i = 0; i < sides; i++) {
                const angle = (Math.PI * 2 / sides) * i;
                points.push({ x: Math.cos(angle) * 75, y: Math.sin(angle) * 75 });
            }
            shape = new fabric.Polygon(points, { ...commonOptions, width: 150, height: 150 });
        } else {
            shape = new fabric.Rect({ ...commonOptions, width: 100, height: 100 });
        }

        this.canvas.add(shape);
        this.canvas.centerObject(shape);
        this.canvas.setActiveObject(shape);
        this.canvas.renderAll();
        this.refreshState();
        this.triggerSelectedUpdate(); // Update sidebar signals
        this.saveState();
    }

    private calculateStarPoints(spikes: number, outerRadius: number, innerRadius: number): { x: number, y: number }[] {
        const points = [];
        let rot = Math.PI / 2 * 3;
        const x = 0;
        const y = 0;
        const step = Math.PI / spikes;

        for (let i = 0; i < spikes; i++) {
            points.push({ x: x + Math.cos(rot) * outerRadius, y: y + Math.sin(rot) * outerRadius });
            rot += step;
            points.push({ x: x + Math.cos(rot) * innerRadius, y: y + Math.sin(rot) * innerRadius });
            rot += step;
        }
        return points;
    }

    public saveHistoryState(): void {
        this.saveState();
    }

    async addImage(source: string | Blob): Promise<void> {
        try {
            let blob: Blob;
            if (typeof source === 'string') {
                if (source.startsWith('data:')) {
                    blob = this.dataURLtoBlob(source);
                } else if (source.startsWith('http')) {
                    const response = await fetch(source);
                    blob = await response.blob();
                } else {
                    return; // Invalid source
                }
            } else {
                blob = source;
            }

            // 1. Persist to IDB immediately (Original ImageStorageService)
            const idbId = await this.imageStorage.saveImage(blob);

            // 2. Persist to new professional storage (PersistenceService)
            // Use the hash-based ID for consistency
            await this.persistenceService.saveImage(idbId, blob);

            // 3. Create high-performance Object URL for canvas
            const objectUrl = this.persistenceService.createObjectURL(blob);
            this.activeBlobUrls.push(objectUrl);

            const imgObj = new Image();
            imgObj.src = objectUrl;
            imgObj.crossOrigin = 'anonymous';

            imgObj.onload = () => {
                const img = new fabric.Image(imgObj);
                (img as any).idbId = idbId;

                // Track original source immediately for future "restore original" or high-res export
                (img as any).originalSrc = `indexeddb://${idbId}`;

                const scale = Math.min(300 / (img.width || 1), 1);
                img.scale(scale);
                this.canvas.add(img);
                this.canvas.centerObject(img);
                this.canvas.setActiveObject(img);
                this.canvas.renderAll();
                this.saveState(); // Save state after adding
            };
        } catch (e) {
            console.error('Failed to add image:', e);
            this.notificationService.error('Failed to add image');
        }
    }

    private async processImagesForStorage(json: any) {
        if (json.objects) {
            for (const obj of json.objects) {
                await this.offloadObjectImage(obj);
            }
        }
        // Handle Background/Overlay which can be string OR object
        if (json.backgroundImage) {
            if (typeof json.backgroundImage === 'string') {
                json.backgroundImage = await this.offloadUrl(json.backgroundImage);
            } else {
                await this.offloadObjectImage(json.backgroundImage);
            }
        }
        if (json.overlayImage) {
            if (typeof json.overlayImage === 'string') {
                json.overlayImage = await this.offloadUrl(json.overlayImage);
            } else {
                await this.offloadObjectImage(json.overlayImage);
            }
        }
    }

    private async offloadObjectImage(obj: any) {
        if (!obj) return;

        // 0. Priority: If it has an IDB ID, synchronize the main source to point to IndexedDB
        if (obj.idbId) {
            console.log(`[Persistence] Syncing IDB ref: ${obj.idbId} for ${obj.type}`);
            if (obj.src !== undefined) obj.src = `indexeddb://${obj.idbId}`;
            // CRITICAL FIX: Do NOT overwrite originalSrc/originalImageSrc with the current idbId.
            // The object might be a derivative (e.g. bg-removed) where idbId is the cutout, 
            // but originalSrc must point to the separate original file.
            // The loop below will handle offloading originalSrc correctly if it's a URL.
        }

        // 1. Handle primary source properties for offloading
        for (const key of ['src', 'originalSrc', 'originalImageSrc']) {
            if (obj[key] && typeof obj[key] === 'string' && !obj[key].startsWith('indexeddb://')) {
                const offloaded = await this.offloadUrl(obj[key]);
                obj[key] = offloaded;
                // Capture the ID if we just offloaded a new URL
                if (offloaded.startsWith('indexeddb://') && !obj.idbId) {
                    obj.idbId = offloaded.replace('indexeddb://', '');
                }
            }
        }

        // 2. Handle Patterns in fill or stroke
        for (const prop of ['fill', 'stroke']) {
            const val = obj[prop];
            if (val && typeof val === 'object' && val.type === 'pattern' && val.source) {
                let sourceUrl = '';
                if (typeof val.source === 'string') {
                    sourceUrl = val.source;
                } else if (val.source instanceof HTMLImageElement) {
                    sourceUrl = val.source.src;
                }

                if (sourceUrl && !sourceUrl.startsWith('indexeddb://')) {
                    const offloaded = await this.offloadUrl(sourceUrl);
                    val.source = offloaded;
                    if (offloaded.startsWith('indexeddb://')) {
                        val.idbId = offloaded.replace('indexeddb://', '');
                    }
                }
            }
        }

        // 3. Handle ClipPath
        if (obj.clipPath) {
            await this.offloadObjectImage(obj.clipPath);
        }

        // 4. Recursively handle groups
        if (obj.objects) {
            for (const child of obj.objects) {
                await this.offloadObjectImage(child);
            }
        }
    }

    private async offloadUrl(url: string): Promise<string> {
        if (!url || typeof url !== 'string' || url.startsWith('indexeddb://')) return url;

        // Skip small SVGs or placeholder strings if any
        if (url.length < 50 && !url.startsWith('blob:')) return url;

        if (url.startsWith('data:')) {
            try {
                const blob = this.dataURLtoBlob(url);
                const id = await this.imageStorage.saveImage(blob);
                // Also mirror to PersistenceService for redundancy
                await this.persistenceService.saveImage(id, blob);
                console.log('Offloaded DataURL to IDB:', id);
                return `indexeddb://${id}`;
            } catch (e) {
                console.error('Failed to offload data-url', e);
                return url;
            }
        } else if (url.startsWith('blob:') || (url.startsWith('http') && !url.includes(location.host))) {
            try {
                const response = await fetch(url, { mode: 'no-cors' }); // Attempt no-cors if standard fails
                let blob: Blob;

                try {
                    const corsResponse = await fetch(url);
                    if (!corsResponse.ok) throw new Error('CORS fetch failed');
                    blob = await corsResponse.blob();
                } catch (corsErr) {
                    console.warn('CORS fetch failed, attempting canvas capture fallback for offload');
                    // If fetch fails, the last resort is a canvas capture if it's already rendered
                    // For now, we return the URL if it's http, but if it's blob, it MUST be squashed if we can't fetch it
                    if (url.startsWith('http')) return url;
                    throw new Error('Could not fetch blob source');
                }

                const id = await this.imageStorage.saveImage(blob);
                await this.persistenceService.saveImage(id, blob);
                console.log(`Offloaded URL to IDB:`, id);
                return `indexeddb://${id}`;
            } catch (e) {
                console.error('Failed to offload URL', url, e);
                if (url.startsWith('blob:')) {
                    console.warn('⚠️ OFF-LOAD FAILED: Keeping original blob URL to prevent immediate data loss', url);
                    return url;
                }
                return url; // Keep http URL as is
            }
        }
        return url;
    }

    private dataURLtoBlob(dataurl: string): Blob {
        try {
            const arr = dataurl.split(',');
            if (arr.length < 2) throw new Error('Invalid data URL');
            const mimeMatch = arr[0].match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/png'; // Fallback mime
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }
            return new Blob([u8arr], { type: mime });
        } catch (e) {
            console.error('DataURL to Blob conversion failed', e);
            throw e;
        }
    }


    // Template Management
    async saveTemplate(name: string, category: string = 'Template'): Promise<boolean> {
        // 1. Deselect everything to avoid saving selection handles/borders in thumbnail
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();

        // 2. Prepare JSON with externalized images
        // CRITICAL: Create a DEEP COPY to avoid modifying live canvas objects
        const rawJson = this.canvas.toObject(this.SERIALIZE_PROPS);
        const json = JSON.parse(JSON.stringify(rawJson)); // Deep clone

        // Save dimensions to ensure accurate restore
        (json as any).width = this.canvas.width;
        (json as any).height = this.canvas.height;

        // Process the COPY, not the original canvas data
        await this.processImagesForStorage(json);

        // 3. Generate clean thumbnail BEFORE any modifications
        const thumbnail = this.canvas.toDataURL({
            format: 'jpeg',
            multiplier: 0.2,
            quality: 0.7,
            enableRetinaScaling: false
        });

        // 4. Persistence Architecture: Shadow Storage
        // We store the heavy JSON in a dedicated record (designs store) 
        // and keep only metadata in the listing.
        const allSaved = await this.imageStorage.getTemplates();
        const activeId = this.activeTemplateId();
        const existingIndex = allSaved.findIndex(t => t.id === activeId && t.isCustom);

        let updatedTemplates: Template[];
        let targetId: string;

        if (existingIndex !== -1 && activeId && allSaved[existingIndex].name === name) {
            targetId = activeId;
            updatedTemplates = [...allSaved];
            updatedTemplates[existingIndex] = {
                ...updatedTemplates[existingIndex],
                json: null, // Wipe JSON from listing to save space
                thumbnail,
                category,
                date: new Date()
            };
        } else {
            targetId = Date.now().toString();
            const newTemplate: Template = {
                id: targetId,
                name,
                category,
                json: null, // Wipe JSON from listing
                thumbnail,
                isCustom: true,
                date: new Date()
            };
            updatedTemplates = [...allSaved, newTemplate];
        }

        // 5. Save the actual payload to the professional shadow store
        console.log(`[Save Template] Saving design data to shadow storage with ID: ${targetId}`);
        await this.persistenceService.saveDesign(targetId, json);
        console.log(`[Save Template] ✅ Shadow storage save complete for ID: ${targetId}`);

        // REMOVED destructive sanitization that was causing items to disappear if offload lagged
        // If an image stays as blob:, it's better than becoming "" (invisible)

        console.log(`[Save Template] Saving metadata listing with ${updatedTemplates.length} templates`);
        if (await this.saveTemplatesToStorage(updatedTemplates)) {
            console.log('[Save Template] ✅ Metadata listing saved successfully');
            // Reload all signals to keep UI in sync
            await this.initSavedTemplates();

            // If it was a new template, switch ID
            if (existingIndex === -1) {
                const newId = updatedTemplates[updatedTemplates.length - 1].id;
                this.activeTemplateId.set(newId);
                console.log(`[Save Template] Set active template ID to: ${newId}`);
            }

            this.notificationService.success(`Template "${name}" saved successfully!`);
            return true;
        }
        console.error('[Save Template] ❌ Failed to save metadata listing');
        return false;
    }

    async deleteTemplate(templateId: string): Promise<void> {
        const allSaved = await this.imageStorage.getTemplates();
        const updated = allSaved.filter(t => t.id !== templateId);
        if (await this.saveTemplatesToStorage(updated)) {
            await this.initSavedTemplates();
        }
    }

    private async saveTemplatesToStorage(templates: Template[]): Promise<boolean> {
        try {
            await this.imageStorage.saveTemplates(templates);
            return true;
        } catch (e: any) {
            console.error('Failed to save templates', e);
            this.notificationService.error('Failed to save template: ' + e.message);
            return false;
        }
    }

    private async initSavedTemplates(): Promise<void> {
        try {
            console.log('🔄 Initializing saved templates...');
            let saved = await this.imageStorage.getTemplates();
            console.log(`📦 Fetched ${saved?.length || 0} items from storage`);

            // Sort by date descending so newest appear first
            saved = (saved || []).sort((a: any, b: any) => {
                const dateB = b.date ? new Date(b.date).getTime() : 0;
                const dateA = a.date ? new Date(a.date).getTime() : 0;
                return dateB - dateA;
            });

            // Traditional templates
            const templates = saved.filter(t => !t.category || t.category === 'Template' || t.category === 'Custom' || t.category === 'Imported');
            this.savedTemplates.set(templates);

            // Designs
            const designs = saved.filter(t => t.category === 'Design');
            this.savedDesigns.set(designs);

            // Backgrounds
            const backgrounds = saved.filter(t => t.category === 'Background');
            this.savedBackgrounds.set(backgrounds);

            console.log(`✅ Signals updated: Templates: ${templates.length}, Designs: ${designs.length}, BGs: ${backgrounds.length}`);
        } catch (e) {
            console.error('❌ Failed to load templates', e);
        }
    }

    async initCutouts(): Promise<void> {
        try {
            const saved = await this.imageStorage.getCutouts();
            this.cutouts.set(saved);
        } catch (e) {
            console.error('Failed to load cutouts', e);
        }
    }

    async removeBackground(): Promise<void> {
        const activeObject = this.canvas.getActiveObject();
        if (!activeObject || activeObject.type !== 'image') {
            this.notificationService.warning('Please select an image first');
            return;
        }

        const originalImg = activeObject as fabric.Image;
        const imgElement = (originalImg as any)._element || (originalImg as any).getElement?.();
        const originalSrc = (originalImg as any).src || imgElement?.src;

        if (!originalSrc && !imgElement) {
            this.notificationService.error('Could not identify image source');
            return;
        }

        try {
            this.isRemovingBg.set(true);
            this.bgRemovalProgress.set(0);
            this.bgRemovalStatus.set('Loading AI engine...');

            // 1. OPTIMIZED CACHING: Only import the module once to save initialization time
            if (!this.rbFunctionCache) {
                this.bgRemovalStatus.set('Initializing AI engine...');
                const imglyModule = await import('@imgly/background-removal');
                this.rbFunctionCache = imglyModule.removeBackground || (imglyModule as any).default?.removeBackground || (imglyModule as any).default;
            }
            const rbFunction = this.rbFunctionCache;

            if (typeof rbFunction !== 'function') {
                throw new Error('Background removal function not found in loaded module.');
            }

            // 2. STABLE & FAST CONFIG
            const config: Config = {
                progress: (key, current, total) => {
                    const percent = Math.round((current / total) * 100);
                    this.bgRemovalProgress.set(percent);

                    if (key.includes('fetch')) {
                        this.bgRemovalStatus.set(`Downloading Model... ${percent}%`);
                    } else if (key.includes('compute')) {
                        this.bgRemovalStatus.set(`Analyzing... ${percent}%`);
                    } else {
                        this.bgRemovalStatus.set(`Processing... ${percent}%`);
                    }
                },
                // Use 'isnet_fp16' for ~2x speedup. It's half the size (40MB vs 80MB) 
                // and optimized for modern GPUs while maintaining high accuracy.
                model: 'isnet_fp16',
                output: {
                    format: 'image/png',
                    quality: 0.8
                },
                // Keep proxyToWorker false if COOP/COEP isolation is not configured,
                // but setting resolution explicitly can sometimes speed up processing.
                proxyToWorker: false
            };

            // 3. EXECUTE REMOVAL
            // Pass the source URL/Blob directly for best reliability
            const resultBlob = await rbFunction(originalSrc || imgElement, config);

            const resultUrl = URL.createObjectURL(resultBlob);
            const imgObj = new Image();
            imgObj.src = resultUrl;

            imgObj.onload = async () => {
                const newImg = new fabric.Image(imgObj);

                // Copy properties accurately
                const props = [
                    'left', 'top', 'scaleX', 'scaleY', 'angle',
                    'originX', 'originY', 'flipX', 'flipY',
                    'opacity', 'skewX', 'skewY'
                ];

                props.forEach(p => {
                    if ((originalImg as any)[p] !== undefined) {
                        (newImg as any)[p] = (originalImg as any)[p];
                    }
                });

                const persistentSrc = (originalImg as any).idbId ? `indexeddb://${(originalImg as any).idbId}` : originalSrc;
                (newImg as any).originalSrc = persistentSrc;
                (newImg as any).isBgRemoved = true;

                const index = this.canvas.getObjects().indexOf(originalImg);
                this.canvas.remove(originalImg);
                this.canvas.add(newImg);

                if (index !== -1) {
                    this.canvas.moveObjectTo(newImg, index);
                }

                this.canvas.setActiveObject(newImg);
                this.canvas.renderAll();

                const cutoutId = await this.saveAsCutout(resultBlob, 'AI Cutout ' + new Date().toLocaleTimeString());
                (newImg as any).idbId = cutoutId;

                this.isRemovingBg.set(false);
                this.saveState();
                this.activeBlobUrls.push(resultUrl);
                this.notificationService.success('Done! Clear vision achieved.');
            };

        } catch (error: any) {
            console.error('Final Background Removal Error:', error);
            let errMsg = error.message || 'Unknown processing error';

            if (errMsg.includes('Symbol.iterator') || errMsg.includes('iterable')) {
                errMsg = 'Model initialization failed. Please check if COOP/COEP headers are needed or refresh the page.';
            }

            this.notificationService.error('AI Error: ' + errMsg);
            this.isRemovingBg.set(false);
        }
    }

    async restoreOriginalImage(): Promise<void> {
        const activeObject = this.canvas.getActiveObject();
        if (!activeObject || !(activeObject as any).originalSrc) {
            this.notificationService.warning('No original image found to restore');
            return;
        }

        const currentImg = activeObject as fabric.Image;
        const rawOriginalSrc = (currentImg as any).originalSrc;

        try {
            // Resolving originalSrc from IDB if needed
            const originalSrc = await this.restoreUrl(rawOriginalSrc);

            const imgObj = new Image();
            imgObj.src = originalSrc;
            imgObj.crossOrigin = 'anonymous';

            imgObj.onload = () => {
                const restoredImg = new fabric.Image(imgObj);
                restoredImg.set({
                    left: currentImg.left,
                    top: currentImg.top,
                    scaleX: currentImg.scaleX,
                    scaleY: currentImg.scaleY,
                    angle: currentImg.angle,
                    originX: currentImg.originX,
                    originY: currentImg.originY,
                    clipPath: currentImg.clipPath, // Keep mask if any
                    // Preserve IDB link if the original source itself was from IDB
                    idbId: rawOriginalSrc.startsWith('indexeddb://') ? rawOriginalSrc.replace('indexeddb://', '') : (currentImg as any).idbId
                });

                this.canvas.add(restoredImg);
                this.canvas.remove(currentImg);
                this.canvas.setActiveObject(restoredImg);
                this.canvas.renderAll();
                this.saveState();
                this.notificationService.success('Original source restored');
            };
        } catch (e) {
            console.error('Failed to restore original', e);
            this.notificationService.error('Failed to restore original image');
        }
    }

    async saveAsCutout(blob: Blob, name: string): Promise<string> {
        try {
            const id = await this.imageStorage.saveCutout(blob, name);
            await this.initCutouts(); // Refresh the list
            return id;
        } catch (e) {
            console.error('Failed to save cutout', e);
            return '';
        }
    }

    async addCutoutToCanvas(cutout: Cutout): Promise<void> {
        const url = URL.createObjectURL(cutout.blob);
        this.activeBlobUrls.push(url);

        const imgObj = new Image();
        imgObj.src = url;

        imgObj.onload = () => {
            const img = new fabric.Image(imgObj);
            (img as any).idbId = cutout.id; // Store ID for persistence

            const scale = Math.min(400 / (img.width || 1), 1);
            img.scale(scale);

            this.canvas.add(img);
            this.canvas.centerObject(img);
            this.canvas.setActiveObject(img);
            this.canvas.renderAll();
            this.saveState();
            // Don't revoke here, we need it for canvas rendering and potential saving
        };
    }

    async deleteCutout(id: string): Promise<void> {
        try {
            await this.imageStorage.deleteCutout(id);
            await this.initCutouts();
        } catch (e) {
            console.error('Failed to delete cutout', e);
        }
    }

    async renameCutout(id: string, newName: string): Promise<void> {
        try {
            await this.imageStorage.renameCutout(id, newName);
            await this.initCutouts();
        } catch (e) {
            console.error('Failed to rename cutout', e);
        }
    }

    async renameCutoutUI(cutout: Cutout): Promise<void> {
        const newName = prompt('Enter new name for cutout:', cutout.name);
        if (newName && newName !== cutout.name) {
            await this.renameCutout(cutout.id, newName);
        }
    }

    async loadTemplate(templateJson: any): Promise<void> {
        // 0. Cancel any pending save operations to prevent race conditions
        clearTimeout(this.timeoutId);

        try {
            this.isHistoryLoading = true;
            this.isProjectLoading.set(true);
            this.cleanupBlobUrls();

            let data = templateJson;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (e) { console.error('Malformed template JSON string'); return; }
            }

            // 1. Shadow Retrieval Link: If input is a metadata object, fetch full payload
            if (data && data.id && !data.objects && !data.backgroundImage) {
                console.log(`[Template Load] Attempting to retrieve from shadow storage: ${data.id}`);
                const shadow = await this.persistenceService.getDesign(data.id);
                if (shadow) {
                    console.log(`[Shadow Storage] ✅ Retrieved deep payload for template: ${data.id}`);
                    data = shadow;
                } else {
                    console.warn(`[Shadow Storage] ⚠️ No data found for ID: ${data.id}`);
                    // Fallback to inline JSON if present
                    if (data.json) {
                        console.log('[Template Load] Falling back to inline JSON');
                        data = typeof data.json === 'string' ? JSON.parse(data.json) : data.json;
                    } else {
                        throw new Error(`Template ${data.id} not found in shadow storage and has no inline JSON`);
                    }
                }
            }

            if (!data || (!data.objects && !data.backgroundImage)) {
                console.error('[Template Load] Invalid template data:', data);
                throw new Error('Retrieved template contains no canvas data');
            }

            // 3. Strict Sanitization: Nukes all dead blob: URLs
            data = this.strictSanitize(data);

            // Restore images from DB
            await this.restoreImagesFromStorage(data);

            // Restore canvas dimensions if present (fixes layout accuracy)
            if (data.width && data.height) {
                this.resizeCanvas(data.width, data.height);
            }

            console.log(`Template images restored. Object count in JSON: ${data.objects?.length || 0}`);

            // MODERN FABRIC 7+ LOADING
            try {
                // Reset viewport/zoom to defaults for consistent loading
                this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
                this.canvas.setZoom(1);

                // For Fabric 7, loadFromJSON is the best way to restore backgrounds + objects
                // We ensure it's awaited.
                // Ensure canvas is clean and reset before loading
                this.canvas.discardActiveObject();
                this.canvas.clear();
                await this.canvas.loadFromJSON(data);

                // Extra safety: If loadFromJSON didn't restore objects (rare bug), we log it
                const restoredCount = this.canvas.getObjects().length;
                console.log(`🎨 canvas.loadFromJSON completed. Objects on canvas: ${restoredCount}`);

                if (restoredCount === 0 && data.objects && data.objects.length > 0) {
                    console.warn('⚠️ No objects on canvas after loadFromJSON, trying manual enlivening fallback...');
                    const objects = await (fabric.util as any).enlivenObjects(data.objects);
                    if (objects && objects.length > 0) {
                        this.canvas.add(...objects);
                    }
                }
            } catch (e) {
                console.error('🔥 Error during canvas.loadFromJSON:', e);
                // Try fallback enliven if primary method fails for objects
                if (data.objects) {
                    const objects = await (fabric.util as any).enlivenObjects(data.objects);
                    this.canvas.add(...objects);
                }
            }

            this.canvas.requestRenderAll();
            this.reviveCurvedElements();

            setTimeout(() => {
                this.isHistoryLoading = false;
                this.refreshState();
                this.selectedObject.set(null);

                // Initialize history with stable refs for this fresh template
                const historyObj = this.canvas.toObject(this.SERIALIZE_PROPS);
                this.forceStableRefs(historyObj);
                this.history = [JSON.stringify(historyObj)];
                this.historyStep = 0;

                this.isProjectLoading.set(false);
                this.saveState(); // Triggers first autosave after load
                console.log('✅ Template load fully complete and signals refreshed');
            }, 100);

            // Trigger info banner
            this.showTemplateInfo.set(true);
            setTimeout(() => this.showTemplateInfo.set(false), 4000);
        } catch (err) {
            console.error('Load template failed:', err);
            this.notificationService.error('Failed to load template: ' + (err as Error).message);
            this.isHistoryLoading = false;
            this.isProjectLoading.set(false);
        }
    }

    // Add template to existing canvas (without clearing)
    async addTemplateToCanvas(templateJson: any): Promise<void> {
        try {
            console.log('Adding template to canvas...', templateJson);

            // 1. Initial Parsing
            let data = templateJson;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (e) { throw new Error('Invalid JSON string'); }
            }

            // 2. High-Performance Shadow Retrieval (CRITICAL FIX: Ensure Additive Template also checks Shadow Store)
            if (data && data.id && !data.objects && !data.backgroundImage) {
                console.log(`[Add Template] Attempting to retrieve from shadow storage: ${data.id}`);
                const shadow = await this.persistenceService.getDesign(data.id);
                if (shadow) {
                    console.log(`[Shadow Storage] ✅ Retrieved additive payload for: ${data.id}`);
                    data = shadow;
                } else {
                    console.warn(`[Shadow Storage] ⚠️ No data found for ID: ${data.id}`);
                    if (data.json) {
                        console.log('[Add Template] Falling back to inline JSON');
                        data = typeof data.json === 'string' ? JSON.parse(data.json) : data.json;
                    } else {
                        throw new Error(`Template ${data.id} not found in shadow storage and has no inline JSON`);
                    }
                }
            }

            if (!data || (!data.objects && !data.backgroundImage)) {
                console.error('[Add Template] Invalid template data:', data);
                throw new Error('Template data is empty or contains no canvas objects');
            }

            // 3. Unified High-Fidelity Sanitization
            data = this.strictSanitize(data);

            // Restore images from DB
            await this.restoreImagesFromStorage(data);

            // Add each object from the template to the current canvas
            if (data.objects && Array.isArray(data.objects)) {
                for (const objData of data.objects) {
                    try {
                        // Use fabric's enlivenObjects to recreate objects from JSON
                        console.log('Enlivening object for canvas addition...');
                        const objects = await (fabric.util as any).enlivenObjects([objData]);
                        if (objects && objects.length > 0) {
                            const obj = objects[0];

                            // Type check: ensure it's a FabricObject with position properties
                            if (obj && typeof obj === 'object' && 'left' in obj && 'top' in obj) {
                                // Offset the object slightly so it doesn't overlap exactly
                                (obj as any).set({
                                    left: ((obj as any).left || 0) + 20,
                                    top: ((obj as any).top || 0) + 20
                                });

                                this.canvas.add(obj as fabric.Object);
                            }
                        }
                    } catch (error) {
                        console.error('Error adding template object:', error);
                    }
                }
            }

            // If template has a background, you can choose to apply it or skip
            // For now, we'll skip the background to preserve the current canvas background

            this.canvas.requestRenderAll();
            this.refreshState();
            this.saveState();

            console.log('Template added to canvas successfully');

            // Show info banner
            this.showTemplateInfo.set(true);
            setTimeout(() => this.showTemplateInfo.set(false), 3000);
        } catch (err) {
            console.error('Add template to canvas failed:', err);
            this.notificationService.error('Failed to add template: ' + (err as Error).message);
        }
    }

    insertEmoji(emoji: string): void {
        const activeObject = this.canvas.getActiveObject();
        // Check if a text object is selected and logic to insert
        if (activeObject && (activeObject.type === 'textbox' || activeObject.type === 'i-text')) {
            const textObj = activeObject as fabric.IText;

            // If in editing mode and has cursor
            if (textObj.isEditing) {
                // Fabric.js insertChars signature: text, style, start, end
                // We use null for style to inherit, and current selection pointers
                const start = textObj.selectionStart || 0;
                const end = textObj.selectionEnd || start;
                textObj.insertChars(emoji, undefined, start, end);

                // Move cursor after emoji
                textObj.selectionStart = start + emoji.length;
                textObj.selectionEnd = start + emoji.length;
            } else {
                // Determine where to append? Or just append to end
                const currentText = textObj.text || '';
                textObj.set('text', currentText + emoji);
            }
            this.canvas.requestRenderAll();
            this.saveState();
        } else {
            // Add as new sticker
            this.addText(emoji, { fontSize: 80, fontWeight: 'normal' });
        }
    }

    private async restoreImagesFromStorage(json: any) {
        if (json.objects) {
            for (const obj of json.objects) {
                await this.restoreObjectImage(obj);
            }
        }
        // Handle Background/Overlay (string or object)
        if (json.backgroundImage) {
            if (typeof json.backgroundImage === 'string') {
                json.backgroundImage = await this.restoreUrl(json.backgroundImage);
            } else {
                await this.restoreObjectImage(json.backgroundImage);
            }
        }
        if (json.overlayImage) {
            if (typeof json.overlayImage === 'string') {
                json.overlayImage = await this.restoreUrl(json.overlayImage);
            } else {
                await this.restoreObjectImage(json.overlayImage);
            }
        }
    }

    private async restoreObjectImage(obj: any) {
        if (!obj) return;

        // 0. Generic IDB Restoration (Applies to all objects with idbId)
        if (obj.idbId) {
            console.log(`[Restoration] Restoring persistence via idbId: ${obj.idbId} for ${obj.type}`);
            const restored = await this.restoreUrl(`indexeddb://${obj.idbId}`);
            if (restored) {
                if (obj.src !== undefined) obj.src = restored;
                // Update originalSrc too if it was pointing to the IDB
                if (obj.originalSrc?.startsWith('indexeddb://')) obj.originalSrc = restored;
                // Ensure originalImageSrc follows suit if present
                if (obj.originalImageSrc?.startsWith('indexeddb://')) obj.originalImageSrc = restored;
            } else {
                console.warn(`[Restoration] Failed to restore IDB content: ${obj.idbId}`);
            }
        }

        // 1. Fallback / Secondary Source Restoration
        for (const key of ['src', 'originalSrc', 'originalImageSrc']) {
            if (obj[key] && typeof obj[key] === 'string') {
                const restored = await this.restoreUrl(obj[key]);
                if (restored) obj[key] = restored;
            }
        }

        // 2. Handle Patterns
        for (const prop of ['fill', 'stroke']) {
            const val = obj[prop];
            if (val && typeof val === 'object' && val.type === 'pattern') {
                // If pattern has its own idbId, restore it
                if (val.idbId) {
                    const restored = await this.restoreUrl(`indexeddb://${val.idbId}`);
                    if (restored) val.source = restored;
                } else if (typeof val.source === 'string') {
                    const restored = await this.restoreUrl(val.source);
                    if (restored) val.source = restored;
                }
            }
        }

        // 3. Handle ClipPath
        if (obj.clipPath) {
            await this.restoreObjectImage(obj.clipPath);
        }

        // 4. Recursively handle groups
        if (obj.objects) {
            for (const child of obj.objects) {
                await this.restoreObjectImage(child);
            }
        }
    }

    private async restoreUrl(url: string): Promise<string> {
        if (!url || typeof url !== 'string' || url === 'undefined') return '';

        if (url.startsWith('blob:')) {
            try {
                // If this fetch fails, the blob is revoked/dead.
                const res = await fetch(url);
                if (res.ok) return url;
            } catch (e) {
                // Fallthrough to empty string -> triggers IDB lookup below
            }
            return '';
        }

        if (!url.startsWith('indexeddb://')) return url;

        const id = url.replace('indexeddb://', '');
        try {
            // Priority 1: Main Image Storage
            let blob = await this.imageStorage.getImage(id);

            // Priority 2: Professional Persistence Fallback (Shadow Store)
            if (!blob) {
                console.log(`[Restoration] Falling back to PersistenceService for ${id}`);
                blob = await this.persistenceService.loadImage(id);
            }

            if (blob) {
                // Convert back to Object URL for high-performance memory usage
                const objectUrl = URL.createObjectURL(blob);
                this.activeBlobUrls.push(objectUrl);
                return objectUrl;
            }
            console.warn('Url not found in any IDB store:', id);
            return '';
        } catch (e) {
            console.error('Failed to restore URL:', id, e);
            return '';
        }
    }

    /**
     * Aggressive string-based sanitization. 
     * Identify and squash ALL dead session-specific blob URLs in the JSON 
     * before it reaches the Fabric.js engine.
     */
    private strictSanitize(data: any): any {
        if (!data) return data;
        let dataObj = typeof data === 'string' ? JSON.parse(data) : data;

        // We removed the global destructive blob regex. 
        // Restoration is now handled property-by-property in restoreUrl with 'live' checking.
        return dataObj;
    }

    private blobToDataURL(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (typeof reader.result === 'string') {
                    resolve(reader.result);
                } else {
                    reject(new Error('Failed to convert blob to data URL'));
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    private cleanupBlobUrls(): void {
        // Revoke old blob URLs to free memory
        console.log('Cleaning up', this.activeBlobUrls.length, 'blob URLs');
        this.activeBlobUrls.forEach(url => {
            try {
                URL.revokeObjectURL(url);
            } catch (e) {
                console.warn('Failed to revoke blob URL:', url);
            }
        });
        this.activeBlobUrls = [];
    }

    addTextWithStyle(): void {
        // In a real app, this would pick fonts from the active template
        this.addText('New Stylish Text', {
            fontFamily: 'Playfair Display',
            fill: '#d946ef',
            fontSize: 40
        });
    }

    updateProperty(prop: string, value: any): void {
        const activeObject = this.canvas.getActiveObject();
        if (activeObject) {
            activeObject.set(prop as any, value);
            this.canvas.requestRenderAll();
            this.refreshState();
            this.triggerSelectedUpdate(); // Force signals to refresh
            // Don't save state on every input move, caller should handle debouncing or call saveState separately
        }
    }

    alignObject(position: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
        const obj = this.canvas.getActiveObject();
        if (!obj) return;

        obj.setCoords();
        const bound = obj.getBoundingRect();
        const canvasWidth = this.canvas.width!;
        const canvasHeight = this.canvas.height!;

        if (position === 'left') obj.set({ left: obj.left! - bound.left });
        else if (position === 'center') this.canvas.centerObjectH(obj);
        else if (position === 'right') obj.set({ left: obj.left! + (canvasWidth - (bound.left + bound.width)) });
        else if (position === 'top') obj.set({ top: obj.top! - bound.top });
        else if (position === 'middle') this.canvas.centerObjectV(obj);
        else if (position === 'bottom') obj.set({ top: obj.top! + (canvasHeight - (bound.top + bound.height)) });

        obj.setCoords();
        this.canvas.renderAll();
        this.refreshState();
        this.saveState();
    }

    deleteObject(obj?: fabric.Object): void {
        const targets = obj ? [obj] : this.canvas.getActiveObjects();
        targets.forEach(t => this.canvas.remove(t));
        this.canvas.discardActiveObject();
        this.canvas.renderAll();
        this.refreshState();
        this.saveState();
    }

    setCanvasBg(color: string): void {
        this.canvasColor.set(color);
        // Direct property set for static value
        this.canvas.backgroundColor = color;
        // Remove overlay if any
        this.canvas.overlayImage = undefined;
        this.canvas.requestRenderAll();
        this.refreshState(); // Ensure state is saved for undo/redo
        this.saveState();
    }

    async setAntiGravityBg(imageUrl: string): Promise<void> {
        // First, persist the background to IndexedDB so it's stable
        let blob: Blob;
        try {
            if (imageUrl.startsWith('data:')) {
                blob = this.dataURLtoBlob(imageUrl);
            } else {
                const res = await fetch(imageUrl);
                blob = await res.blob();
            }
            const idbId = await this.imageStorage.saveImage(blob);
            const stableUrl = URL.createObjectURL(blob);
            this.activeBlobUrls.push(stableUrl);

            const imgObj = new Image();
            imgObj.src = stableUrl;
            imgObj.crossOrigin = 'anonymous';

            imgObj.onload = () => {
                const bgImg = new fabric.Image(imgObj);
                (bgImg as any).idbId = idbId;
                (bgImg as any).originalSrc = `indexeddb://${idbId}`;

                // Scale to cover
                const canvasAspect = (this.canvas.width || 1200) / (this.canvas.height || 675);
                const imgAspect = (bgImg.width || 1) / (bgImg.height || 1);
                let scaleFactor;

                if (canvasAspect >= imgAspect) {
                    scaleFactor = (this.canvas.width || 1200) / (bgImg.width || 1);
                } else {
                    scaleFactor = (this.canvas.height || 675) / (bgImg.height || 1);
                }

                bgImg.set({
                    originX: 'left',
                    originY: 'top',
                    scaleX: scaleFactor,
                    scaleY: scaleFactor,
                    opacity: 0.95 // Requested opacity
                });

                // Apply Blur
                // Try using standard fabric.filters or cast if needed. 
                // Logic: In recent fabric versions, filters are under fabric.filters or via instance.
                // We will try avoiding the type check error by casting if needed, or using the likely correct path.
                // If fabric.Image.filters is missing in type, we use (fabric.Image as any).filters or try fabric.filters.
                // Safe approach: (fabric as any).Image.filters.Blur OR new fabric.filters.Blur if valid.

                const blur = new fabric.filters.Blur({
                    blur: 0.4
                });
                bgImg.filters = [blur];
                bgImg.applyFilters();

                this.canvas.backgroundImage = bgImg;
                this.canvas.requestRenderAll();

                // 2. Add Gradient Overlay
                const overlayRect = new fabric.Rect({
                    left: 0,
                    top: 0,
                    width: this.canvas.width,
                    height: this.canvas.height,
                    opacity: 0.2,
                    selectable: false,
                    evented: false,
                    excludeFromExport: false,
                    name: 'gravity_overlay'
                });

                // Correct Gradient Syntax
                const gradient = new fabric.Gradient({
                    type: 'linear',
                    coords: { x1: 0, y1: 0, x2: 0, y2: this.canvas.height || 675 },
                    colorStops: [
                        { offset: 0, color: '#ffffff' },
                        { offset: 1, color: '#000000' }
                    ]
                });

                overlayRect.set('fill', gradient);

                this.canvas.add(overlayRect);
                // sendToBack might be missing in types, use moveTo(0) or cast
                this.canvas.sendObjectToBack(overlayRect);

                this.canvas.renderAll();
                this.refreshState();
            };
        } catch (e) {
            console.error('Failed to set background', e);
            this.notificationService.error('Failed to set background image');
        }
    }

    clearCanvas(): void {
        this.canvas.clear();
        this.canvas.set({ backgroundColor: '#ffffff' });
        this.canvasColor.set('#ffffff');
        this.canvas.renderAll();
        this.refreshState();
        this.saveState();
    }

    resetCanvas(): void {
        this.clearCanvas();
    }

    deleteSelected(): void {
        const activeObjects = this.canvas.getActiveObjects();
        if (activeObjects.length) {
            activeObjects.forEach(obj => this.canvas.remove(obj));
            this.canvas.discardActiveObject();
            this.canvas.renderAll();
            this.refreshState();
            this.saveState();
        }
    }

    flip(axis: 'h' | 'v'): void {
        const obj = this.canvas.getActiveObject();
        if (obj) {
            if (axis === 'h') obj.set('flipX', !obj.flipX);
            else obj.set('flipY', !obj.flipY);
            this.canvas.renderAll();
        }
    }

    applyFilter(filterType: 'Grayscale' | 'Invert' | 'Sepia' | 'None'): void {
        const activeObject = this.canvas.getActiveObject();
        if (activeObject && activeObject.type === 'image') {
            const img = activeObject as fabric.Image;
            img.filters = [];
            if (filterType === 'Grayscale') img.filters.push(new fabric.filters.Grayscale());
            else if (filterType === 'Invert') img.filters.push(new fabric.filters.Invert());
            else if (filterType === 'Sepia') img.filters.push(new fabric.filters.Sepia());

            img.applyFilters();
            this.canvas.renderAll();
            this.saveState();
        }
    }

    applyImageMask(type: 'none' | 'cloud' | 'wave' | 'organic', maskHeight: number = 20, flip: boolean = false): void {
        const obj = this.canvas.getActiveObject();
        if (!obj || obj.type !== 'image') return;

        const img = obj as fabric.Image;
        const w = img.width || 0;
        const h = img.height || 0;

        // Save state properties
        (img as any).maskType = type;
        (img as any).maskHeight = maskHeight;
        (img as any).maskFlip = flip;

        if (type === 'none') {
            img.clipPath = undefined;
            this.canvas.renderAll();
            this.saveState();
            return;
        }

        // Calculate height of the effect part
        const effectH = (maskHeight / 100) * h;
        const solidH = h - effectH;

        let d = '';

        if (type === 'cloud') {
            // Cloud: Fluffy bumps at bottom
            d = `M 0 0 L ${w} 0 L ${w} ${solidH}`;
            const bumps = 6;
            const step = w / bumps;
            for (let i = 0; i < bumps; i++) {
                const currentX = w - (i * step);
                const nextX = w - ((i + 1) * step);
                const cx = currentX - (step / 2);
                const cy = solidH + effectH;
                d += ` Q ${cx} ${cy} ${nextX} ${solidH}`;
            }
            d += ` L 0 0 Z`;
        }
        else if (type === 'wave') {
            // Wave: Sine-like wave
            d = `M 0 0 L ${w} 0 L ${w} ${solidH}`;
            const waves = 4;
            const step = w / waves;
            for (let i = 0; i < waves; i++) {
                const currentX = w - (i * step);
                const nextX = w - ((i + 1) * step);
                const midX = currentX - (step / 2);
                const q1cx = currentX - (step / 4);
                const q1cy = solidH + effectH;
                const q2cx = currentX - (3 * step / 4);
                const q2cy = solidH - (effectH * 0.2);
                d += ` Q ${q1cx} ${q1cy} ${midX} ${solidH + effectH * 0.4}`;
                d += ` Q ${q2cx} ${q2cy} ${nextX} ${solidH}`;
            }
            d += ` L 0 0 Z`;
        }
        else if (type === 'organic') {
            // Organic/Blob: Smooth irregular curve
            d = `M 0 0 L ${w} 0 L ${w} ${solidH}`;
            d += ` Q ${w * 0.7} ${h} ${w * 0.5} ${solidH + effectH * 0.5}`;
            d += ` Q ${w * 0.2} ${solidH - effectH * 0.5} 0 ${solidH}`;
            d += ` L 0 0 Z`;
        }

        const path = new fabric.Path(d);
        path.originX = 'center';
        path.originY = 'center';
        path.left = 0;
        path.top = 0;

        if (flip) {
            path.flipY = true;
        }

        img.clipPath = path;
        this.canvas.renderAll();
        this.saveState();
    }

    applyBackgroundBlur(value: number) {
        const bg = this.canvas.backgroundImage;
        if (bg && bg instanceof fabric.Image) {
            // Remove existing blur
            bg.filters = (bg.filters || []).filter((f: any) => f.type !== 'Blur');

            if (value > 0) {
                const blur = new fabric.filters.Blur({ blur: value });
                bg.filters.push(blur);
            }

            bg.applyFilters();
            this.canvas.requestRenderAll();
            this.saveState();
        }
    }

    setBrightness(value: number): void {
        const obj = this.canvas.getActiveObject();
        if (obj && obj.type === 'image') {
            const img = obj as fabric.Image;
            // Remove existing brightness if any
            img.filters = img.filters.filter(f => (f as any).type !== 'Brightness');
            img.filters.push(new fabric.filters.Brightness({ brightness: value }));
            img.applyFilters();
            this.canvas.renderAll();
        }
    }

    setContrast(value: number): void {
        const obj = this.canvas.getActiveObject();
        if (obj && obj.type === 'image') {
            const img = obj as fabric.Image;
            img.filters = img.filters.filter(f => (f as any).type !== 'Contrast');
            img.filters.push(new fabric.filters.Contrast({ contrast: value }));
            img.applyFilters();
            this.canvas.renderAll();
        }
    }

    setSaturation(value: number): void {
        const obj = this.canvas.getActiveObject();
        if (obj && obj.type === 'image') {
            const img = obj as fabric.Image;
            img.filters = img.filters.filter(f => (f as any).type !== 'Saturation');
            img.filters.push(new fabric.filters.Saturation({ saturation: value }));
            img.applyFilters();
            this.canvas.renderAll();
        }
    }

    setGradientBg(c1: string, c2: string): void {
        this.bgType.set('gradient');
        const grad = new fabric.Gradient({
            type: 'linear',
            coords: { x1: 0, y1: 0, x2: this.canvas.width, y2: this.canvas.height },
            colorStops: [
                { offset: 0, color: c1 },
                { offset: 1, color: c2 }
            ]
        });
        this.canvas.backgroundColor = grad;
        this.canvas.requestRenderAll();
        this.saveState();
    }

    setPatternBg(patternType: string): void {
        this.bgType.set('pattern');
        const patternCanvas = document.createElement('canvas');
        const ctx = patternCanvas.getContext('2d')!;

        // Default size
        patternCanvas.width = 20;
        patternCanvas.height = 20;

        // Clear canvas
        ctx.clearRect(0, 0, patternCanvas.width, patternCanvas.height);

        if (patternType === 'dots') {
            patternCanvas.width = 20;
            patternCanvas.height = 20;
            ctx.fillStyle = '#cbd5e1';
            ctx.beginPath();
            ctx.arc(10, 10, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        else if (patternType === 'dots-large') {
            patternCanvas.width = 20;
            patternCanvas.height = 20;
            ctx.fillStyle = '#7c3aed';
            ctx.beginPath();
            ctx.arc(10, 10, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        else if (patternType === 'stripes') {
            patternCanvas.width = 20;
            patternCanvas.height = 20;
            ctx.strokeStyle = 'rgba(124, 58, 237, 0.1)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 20);
            ctx.lineTo(20, 0);
            ctx.stroke();
        }
        else if (patternType === 'grid') {
            patternCanvas.width = 30;
            patternCanvas.height = 30;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(30, 0);
            ctx.moveTo(0, 0);
            ctx.lineTo(0, 30);
            ctx.stroke();
        }
        else if (patternType === 'checkerboard') {
            patternCanvas.width = 20;
            patternCanvas.height = 20;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
            ctx.fillRect(0, 0, 10, 10);
            ctx.fillRect(10, 10, 10, 10);
        }
        else if (patternType === 'diagonal') {
            patternCanvas.width = 10;
            patternCanvas.height = 10;
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, 10);
            ctx.lineTo(10, 0);
            ctx.stroke();
        }
        else if (patternType === 'waves') {
            patternCanvas.width = 20;
            patternCanvas.height = 10;
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, 5);
            ctx.quadraticCurveTo(5, 0, 10, 5);
            ctx.quadraticCurveTo(15, 10, 20, 5);
            ctx.stroke();
        }
        // --- NEW PATTERNS ---
        else if (patternType === 'cross') {
            patternCanvas.width = 20;
            patternCanvas.height = 20;
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(5, 5); ctx.lineTo(15, 15);
            ctx.moveTo(15, 5); ctx.lineTo(5, 15);
            ctx.stroke();
        }
        else if (patternType === 'plus') {
            patternCanvas.width = 30;
            patternCanvas.height = 30;
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(15, 5); ctx.lineTo(15, 25);
            ctx.moveTo(5, 15); ctx.lineTo(25, 15);
            ctx.stroke();
        }
        else if (patternType === 'circles') {
            patternCanvas.width = 20;
            patternCanvas.height = 20;
            ctx.strokeStyle = '#7c3aed';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(10, 10, 8, 0, Math.PI * 2);
            ctx.stroke();
        }
        else if (patternType === 'diamonds') {
            patternCanvas.width = 20;
            patternCanvas.height = 20;
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(10, 0); ctx.lineTo(20, 10);
            ctx.lineTo(10, 20); ctx.lineTo(0, 10);
            ctx.closePath();
            ctx.stroke();
        }
        else if (patternType === 'zigzag') {
            patternCanvas.width = 20;
            patternCanvas.height = 20;
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 15);
            ctx.lineTo(10, 5);
            ctx.lineTo(20, 15);
            ctx.stroke();
        }
        else if (patternType === 'triangles') {
            patternCanvas.width = 20;
            patternCanvas.height = 20;
            ctx.fillStyle = 'rgba(124, 58, 237, 0.1)';
            ctx.beginPath();
            ctx.moveTo(10, 2);
            ctx.lineTo(18, 18);
            ctx.lineTo(2, 18);
            ctx.closePath();
            ctx.fill();
        }
        else if (patternType === 'bricks') {
            patternCanvas.width = 40;
            patternCanvas.height = 20;
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1;
            ctx.beginPath();
            // Brick 1
            ctx.rect(0, 0, 20, 10);
            // Brick 2
            ctx.rect(20, 0, 20, 10);
            // Brick 3 (offset)
            ctx.rect(10, 10, 20, 10);
            // Partial
            ctx.rect(-10, 10, 20, 10);
            ctx.rect(30, 10, 20, 10);
            ctx.stroke();
        }
        else if (patternType === 'scales') {
            patternCanvas.width = 20;
            patternCanvas.height = 20;
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(10, 0, 10, 0, Math.PI);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 10, 10, 0, Math.PI);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(20, 10, 10, 0, Math.PI);
            ctx.stroke();
        }
        else if (patternType === 'stars') {
            patternCanvas.width = 30;
            patternCanvas.height = 30;
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            // Simple star shape
            const cx = 15, cy = 15, outerRadius = 8, innerRadius = 4;
            for (let i = 0; i < 5; i++) {
                ctx.lineTo(Math.cos((18 + i * 72) / 180 * Math.PI) * outerRadius + cx,
                    -Math.sin((18 + i * 72) / 180 * Math.PI) * outerRadius + cy);
                ctx.lineTo(Math.cos((54 + i * 72) / 180 * Math.PI) * innerRadius + cx,
                    -Math.sin((54 + i * 72) / 180 * Math.PI) * innerRadius + cy);
            }
            ctx.closePath();
            ctx.fill();
        }
        else if (patternType === 'hearts') {
            patternCanvas.width = 30;
            patternCanvas.height = 30;
            ctx.fillStyle = '#f43f5e';
            ctx.beginPath();
            const x = 15, y = 15, s = 0.5;
            ctx.moveTo(x, y + 6);
            ctx.bezierCurveTo(x, y, x - 10, y - 5, x - 10, y - 10);
            ctx.bezierCurveTo(x - 10, y - 15, x - 5, y - 15, x, y - 10);
            ctx.bezierCurveTo(x + 5, y - 15, x + 10, y - 15, x + 10, y - 10);
            ctx.bezierCurveTo(x + 10, y - 5, x, y, x, y + 6);
            ctx.fill();
        }

        const pattern = new fabric.Pattern({
            source: patternCanvas,
            repeat: 'repeat'
        });

        this.canvas.backgroundColor = pattern;
        this.canvas.requestRenderAll();
        this.saveState();
    }

    applyTextEffect(type: 'outline' | 'gradient' | 'shadow'): void {
        const obj = this.canvas.getActiveObject();
        if (!obj || obj.type !== 'textbox') return;

        if (type === 'outline') {
            obj.set({ stroke: '#000000', strokeWidth: 2 });
        } else if (type === 'gradient') {
            const grad = new fabric.Gradient({
                type: 'linear',
                coords: { x1: 0, y1: 0, x2: obj.getScaledWidth(), y2: 0 },
                colorStops: [{ offset: 0, color: '#7c3aed' }, { offset: 1, color: '#3b82f6' }]
            });
            obj.set({ fill: grad });
        } else if (type === 'shadow') {
            obj.set({ shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.5)', blur: 10, offsetX: 5, offsetY: 5 }) });
        }

        this.canvas.renderAll();
        this.saveState();
    }

    cropSelection(): void {
        const activeObject = this.canvas.getActiveObject();
        if (activeObject && activeObject.type === 'image') {
            this.startCrop(activeObject as fabric.Image);
        }
    }

    private startCrop(img: fabric.Image): void {
        this.isCropping.set(true);
        this.cropTarget = img;

        // 1. Lock all other objects and the canvas
        this.canvas.discardActiveObject();
        this.canvas.getObjects().forEach(obj => {
            (obj as any)._prevSelectable = obj.selectable;
            (obj as any)._prevEvented = obj.evented;
            obj.set({ selectable: false, evented: false });
        });
        this.canvas.selection = false;

        // 2. Create the crop overlay
        // We match it to the image's current dimensions and orientation
        const imgWidth = img.getScaledWidth();
        const imgHeight = img.getScaledHeight();

        this.cropOverlay = new fabric.Rect({
            left: img.left,
            top: img.top,
            width: imgWidth,
            height: imgHeight,
            fill: 'rgba(0, 0, 0, 0.3)',
            stroke: '#ffffff',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            cornerColor: '#7c3aed',
            cornerSize: 12,
            cornerStyle: 'circle',
            transparentCorners: false,
            borderColor: '#7c3aed',
            angle: img.angle,
            originX: img.originX,
            originY: img.originY,
            strokeUniform: true,
            hasRotatingPoint: false, // Professional crop tools don't rotate the crop box separately
            lockRotation: true,
            selectable: true,
            evented: true,
            name: 'crop-overlay'
        });

        // Ensure handles are appropriately visible
        this.cropOverlay.setControlsVisibility({
            mtr: false // No rotation
        });

        this.canvas.add(this.cropOverlay);
        this.canvas.setActiveObject(this.cropOverlay);
        this.canvas.renderAll();
    }

    applyCrop(): void {
        if (!this.cropTarget || !this.cropOverlay) return;

        const img = this.cropTarget;
        const rect = this.cropOverlay;

        // 1. Calculate the transform matrix
        const imgMatrix = img.calcTransformMatrix();
        const invertedImgMatrix = fabric.util.invertTransform(imgMatrix);

        // 2. Get the 4 corners of the crop rectangle in canvas space
        const rectCoords = rect.getCoords();
        const tlCanvas = rectCoords[0];
        const brCanvas = rectCoords[2];

        // 3. Convert them to the image's local coordinate space
        const tlLocal = fabric.util.transformPoint(tlCanvas, invertedImgMatrix);
        const brLocal = fabric.util.transformPoint(brCanvas, invertedImgMatrix);

        // 4. Fabric object local space adjustment based on origins
        let offsetX = tlLocal.x;
        let offsetY = tlLocal.y;

        // If origin is center, local coords are relative to center (-width/2 to width/2)
        // We need them relative to the current crop's top-left
        if (img.originX === 'center') offsetX += img.width / 2;
        if (img.originY === 'center') offsetY += img.height / 2;

        const cropWidth = Math.abs(brLocal.x - tlLocal.x);
        const cropHeight = Math.abs(brLocal.y - tlLocal.y);

        // 5. Update the image's crop properties
        // IMPORTANT: update cropX/Y relative to the CURRENT cropX/cropY
        const currentCropX = img.cropX || 0;
        const currentCropY = img.cropY || 0;

        img.set({
            cropX: currentCropX + offsetX,
            cropY: currentCropY + offsetY,
            width: cropWidth,
            height: cropHeight,
            // Update position to match the overlay's position
            left: rect.left,
            top: rect.top,
            // Keep existing scale but it will naturally apply to the new width/height
            // No need to change scaleX/Y unless we want to "stretch" it, which we don't.
        });

        img.setCoords();

        this.exitCropMode();
        this.canvas.renderAll();
        this.saveState();
    }

    cancelCrop(): void {
        this.exitCropMode();
        this.canvas.renderAll();
    }

    private exitCropMode(): void {
        if (this.cropOverlay) {
            this.canvas.remove(this.cropOverlay);
            this.cropOverlay = null;
        }

        // Restore interactions
        this.canvas.getObjects().forEach(obj => {
            if ((obj as any)._prevSelectable !== undefined) {
                obj.selectable = (obj as any)._prevSelectable;
                obj.evented = (obj as any)._prevEvented;
                delete (obj as any)._prevSelectable;
                delete (obj as any)._prevEvented;
            } else {
                // Fallback: Default to true if no prev state (shouldn't happen)
                obj.selectable = true;
                obj.evented = true;
            }
        });

        // Re-enable target image if it was lost
        if (this.cropTarget) {
            this.cropTarget.set({ selectable: true, evented: true });
            this.canvas.setActiveObject(this.cropTarget);
        }

        this.canvas.selection = true;
        this.isCropping.set(false);
        this.cropTarget = null;
    }

    exportToImage(format: 'png' | 'jpeg'): void {
        const dataURL = this.canvas.toDataURL({ format, multiplier: 2 });
        const link = document.createElement('a');
        link.download = `design.${format}`;
        link.href = dataURL;
        link.click();
    }

    setActiveObject(obj: fabric.Object): void {
        this.canvas.setActiveObject(obj);
        this.canvas.renderAll();
        this.selectedObject.set(obj);
    }

    setZoom(value: number): void {
        this.canvas.setZoom(value);
        this.zoomLevel.set(value);
        this.canvas.renderAll();
    }

    zoomIn(): void {
        const zoom = this.canvas.getZoom() * 1.1;
        this.setZoom(zoom);
    }

    zoomOut(): void {
        const zoom = this.canvas.getZoom() / 1.1;
        this.setZoom(zoom);
    }

    resetZoom(): void {
        this.setZoom(1);
        const obj = this.canvas.getActiveObject();
        if (obj) {
            this.canvas.centerObject(obj);
        } else {
            // If no object, just reset viewport
            this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        }
        this.canvas.renderAll();
    }

    private clipboard: any;

    copy(): void {
        const activeObject = this.canvas.getActiveObject();
        if (activeObject) {
            activeObject.clone().then((cloned: any) => {
                this.clipboard = cloned;
            });
        }
    }

    paste(): void {
        if (!this.clipboard) return;
        this.clipboard.clone().then((clonedObj: any) => {
            this.canvas.discardActiveObject();
            clonedObj.set({
                left: clonedObj.left + 10,
                top: clonedObj.top + 10,
                evented: true,
            });
            this.canvas.add(clonedObj);
            this.canvas.setActiveObject(clonedObj);
            this.canvas.requestRenderAll();
            this.refreshState();
        });
    }

    toggleVisibility(obj: fabric.Object): void {
        obj.set('visible', !obj.visible);
        if (!obj.visible) {
            this.canvas.discardActiveObject();
        }
        this.canvas.requestRenderAll();
        this.refreshState();
        this.saveState();
    }

    toggleLock(obj: fabric.Object): void {
        // Toggle based on lockMovementX as the master 'locked' state
        const isLocked = !!obj.lockMovementX;
        const newLocked = !isLocked;

        obj.set({
            lockMovementX: newLocked,
            lockMovementY: newLocked,
            lockScalingX: newLocked,
            lockScalingY: newLocked,
            lockRotation: newLocked,
            selectable: !newLocked, // Make unselectable if locked
            evented: !newLocked     // Ignore events if locked (optional, but good for "background" feel)
        });

        if (newLocked) {
            this.canvas.discardActiveObject();
        }

        this.canvas.requestRenderAll();
        this.refreshState();
        this.saveState();
    }

    // Layer Ordering
    moveLayer(obj: fabric.Object, direction: 'up' | 'down' | 'top' | 'bottom'): void {
        switch (direction) {
            case 'up':
                this.canvas.bringObjectForward(obj);
                break;
            case 'down':
                this.canvas.sendObjectBackwards(obj);
                break;
            case 'top':
                this.canvas.bringObjectToFront(obj);
                break;
            case 'bottom':
                this.canvas.sendObjectToBack(obj);
                break;
        }
        this.canvas.requestRenderAll();
        this.refreshState();
        this.saveState();
    }

    // Layer Hover Highlight
    setHoveredObject(obj: fabric.Object | null): void {
        // Clear previous highlight
        if (this.highlightOutline) {
            this.canvas.remove(this.highlightOutline);
            this.highlightOutline = null;
        }

        if (obj && obj.visible) {
            // Create a highlight box around the object
            // We use the object's bounding rect
            const bound = obj.getBoundingRect();

            this.highlightOutline = new fabric.Rect({
                left: bound.left - 2,
                top: bound.top - 2,
                width: bound.width + 4,
                height: bound.height + 4,
                fill: 'transparent',
                stroke: '#3b82f6', // Bright blue
                strokeWidth: 2,
                strokeDashArray: [4, 4],
                selectable: false,
                evented: false,
                excludeFromExport: true // Important: Don't export this
            });

            this.canvas.add(this.highlightOutline);
        }
        this.canvas.requestRenderAll();
    }

    // Interactive Layer Reorder (Drag & Drop)
    reorderLayers(fromIndex: number, toIndex: number): void {
        const objs = this.canvas.getObjects();
        const obj = objs[fromIndex];
        if (!obj) return;

        this.canvas.moveObjectTo(obj, toIndex);

        // Force immediate update with filtering
        this.updateObjectsState();

        this.canvas.requestRenderAll();
        // this.refreshState(); 
        this.saveState();
    }

    // Autosave Logic
    private async autoSaveProject(): Promise<void> {
        try {
            const json = this.canvas.toObject(this.SERIALIZE_PROPS);

            // Critical: process images before saving to IDB to ensure persistence
            await this.processImagesForStorage(json);

            await this.imageStorage.saveAutosave(JSON.stringify(json));
        } catch (e) {
            console.warn('Autosave failed', e);
        }
    }

    private async loadAutosave(): Promise<void> {
        // 0. Cancel pending saves
        clearTimeout(this.timeoutId);

        try {
            let jsonStr = await this.imageStorage.getAutosave();
            if (jsonStr) {
                this.isHistoryLoading = true;
                this.isProjectLoading.set(true);
                this.cleanupBlobUrls();

                // Advanced Restoration: Handle both string and direct JSON
                let data = JSON.parse(jsonStr);

                // Strict Sanitization
                data = this.strictSanitize(data);

                // Restore images from DB
                await this.restoreImagesFromStorage(data);

                await this.canvas.loadFromJSON(data);
                this.canvas.renderAll();
                this.refreshState();

                // Force stable refs in history
                const historyObj = this.canvas.toObject(this.SERIALIZE_PROPS);
                this.forceStableRefs(historyObj);
                this.history = [JSON.stringify(historyObj)];
                this.historyStep = 0;

                this.isHistoryLoading = false;
                this.isProjectLoading.set(false);
            }
        } catch (e) {
            console.warn('No autosave found or failed to load', e);
            this.isHistoryLoading = false;
            this.isProjectLoading.set(false);
        }
    }


    public async loadProject(id: string): Promise<void> {
        // 0. Cancel pending saves
        clearTimeout(this.timeoutId);

        const project = this.savedProjects().find(p => p.id === id);
        if (!project) return;

        try {
            this.isHistoryLoading = true;
            this.isProjectLoading.set(true);
            this.cleanupBlobUrls();

            // Fetch payload from Shadow Storage (Priority)
            let data: any = null;
            if (id) {
                data = await this.persistenceService.getDesign(id);
            }

            if (!data) {
                if (project.json && project.json.trim() !== '') {
                    try { data = JSON.parse(project.json); } catch (e) { console.error('Legacy JSON parse failed'); }
                }
            }

            if (!data) throw new Error('Could not retrieve project data from any store');

            // 3. Strict Sanitization: Kill all session-specific blobs
            data = this.strictSanitize(data);

            // Restore images from DB
            await this.restoreImagesFromStorage(data);

            await this.canvas.loadFromJSON(data);

            this.activeProjectId.set(id);
            this.canvas.renderAll();
            this.refreshState();

            // Initialize history with stable refs
            const historyObj = this.canvas.toObject(this.SERIALIZE_PROPS);
            this.forceStableRefs(historyObj);
            this.history = [JSON.stringify(historyObj)];
            this.historyStep = 0;

            this.notificationService.success('Project loaded');
            this.isProjectLoading.set(false);
            this.isHistoryLoading = false;
            console.log('✅ Template/Project loaded successfully');
        } catch (err) {
            console.error('Failed to load template/project', err);
            this.notificationService.error('Failed to load project');
            this.isProjectLoading.set(false);
            this.isHistoryLoading = false;
        }
    }

    // Override saveState to include autosave
    private timeoutId: any;
    private saveState(): void {
        if (this.isHistoryLoading) return;

        const obj = this.canvas.toObject(this.SERIALIZE_PROPS);

        // Sync pass for history stability: 
        // Force indexeddb:// refs for any object that already has an IDB link.
        // This makes history states immune to session blob expiration.
        this.forceStableRefs(obj);

        const json = JSON.stringify(obj);
        this.historyStep++;
        this.history = this.history.slice(0, this.historyStep);
        this.history.push(json);

        // Debounced Autosave (1s)
        clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(() => {
            this.autoSaveProject();
        }, 1000);
    }

    private forceStableRefs(obj: any) {
        if (!obj) return;
        if (obj.objects) {
            obj.objects.forEach((child: any) => this.forceStableRefs(child));
        }

        if (obj.idbId) {
            if (obj.type === 'image') obj.src = `indexeddb://${obj.idbId}`;
            // Handle originalSrc if it exists
            if (obj.originalSrc && (obj.originalSrc.startsWith('blob:') || obj.originalSrc.startsWith('http'))) {
                // Try to keep it as IDB ref if possible
                if (obj.idbId) obj.originalSrc = `indexeddb://${obj.idbId}`;
            }
        }

        // Patterns
        ['fill', 'stroke'].forEach(prop => {
            if (obj[prop] && obj[prop].type === 'pattern' && obj[prop].idbId) {
                obj[prop].source = `indexeddb://${obj[prop].idbId}`;
            }
        });

        // BG/Overlay
        ['backgroundImage', 'overlayImage'].forEach(prop => {
            if (obj[prop] && obj[prop].idbId) {
                obj[prop].src = `indexeddb://${obj[prop].idbId}`;
            }
        });
    }

    // Projects Persistence
    private async initSavedProjects(): Promise<void> {
        try {
            let saved = await this.imageStorage.getProjects();
            // Sort by date descending
            if (saved) {
                saved = saved.sort((a: any, b: any) => (b.date || 0) - (a.date || 0));
                this.savedProjects.set(saved);
            }
        } catch (e) {
            console.warn('Failed to load saved projects', e);
        }
    }

    public async saveProject(name: string = 'Untitled Design'): Promise<void> {
        this.isSaving.set(true);
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();

        const json = this.canvas.toObject(this.SERIALIZE_PROPS);
        // Save dimensions for accurate restoration
        (json as any).width = this.canvas.width;
        (json as any).height = this.canvas.height;
        await this.processImagesForStorage(json);
        const finalJson = JSON.stringify(json);

        const thumbnail = this.canvas.toDataURL({
            format: 'jpeg',
            quality: 0.6,
            multiplier: 0.15
        });

        const current = this.savedProjects();
        const activeId = this.activeProjectId();
        let updated: SavedProject[];
        let targetId: string;

        if (activeId) {
            targetId = activeId;
            const existing = current.find(p => p.id === activeId);
            const others = current.filter(p => p.id !== activeId);

            if (existing) {
                const updatedProject = {
                    ...existing,
                    name: name || existing.name,
                    json: '', // Shadow storage
                    thumbnail,
                    date: Date.now()
                };
                updated = [updatedProject, ...others];
            } else {
                updated = current;
            }
        } else {
            targetId = Date.now().toString();
            const newProject: SavedProject = {
                id: targetId,
                name,
                json: '', // Shadow storage
                thumbnail,
                date: Date.now()
            };
            updated = [newProject, ...current];
            this.activeProjectId.set(targetId);
        }

        // Save bulky JSON to shadow store
        await this.persistenceService.saveDesign(targetId, json);

        this.savedProjects.set(updated);
        await this.imageStorage.saveProjects(updated);
        this.isSaving.set(false);
    }



    /**
     * Professional Save/Load Handlers
     */
    async saveDesignToPersistence(id: string): Promise<void> {
        try {
            // High-fidelity serialization
            const json = this.canvas.toObject(this.SERIALIZE_PROPS);

            // Sync IDs if they exist
            this.forceStableRefs(json);

            // Save to the professional persistence layer
            const db = (this.persistenceService as any).dbPromise || (await (this.persistenceService as any).initDB());
            const designsStore = 'designs';

            // Instead of relying on PersistenceService.saveDesign which uses toJSON(),
            // we manually store the high-fidelity object for better results.
            const dbInstance = await (this.persistenceService as any).dbPromise;
            return new Promise((resolve, reject) => {
                const transaction = dbInstance.transaction([designsStore], 'readwrite');
                const store = transaction.objectStore(designsStore);
                const request = store.put({
                    id,
                    json,
                    timestamp: Date.now()
                });
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error('Failed to save design to persistence:', e);
        }
    }

    async loadDesignFromPersistence(id: string): Promise<void> {
        try {
            this.isHistoryLoading = true;
            this.cleanupBlobUrls();

            const dbInstance = await (this.persistenceService as any).dbPromise;
            const designsStore = 'designs';

            const data: any = await new Promise((resolve, reject) => {
                const transaction = dbInstance.transaction([designsStore], 'readonly');
                const store = transaction.objectStore(designsStore);
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            if (data && data.json) {
                // Restore images from DB
                await this.restoreImagesFromStorage(data.json);

                await this.canvas.loadFromJSON(data.json);
                this.canvas.renderAll();
                this.refreshState();

                // Initialize history with stable refs
                const historyObj = this.canvas.toObject(this.SERIALIZE_PROPS);
                this.forceStableRefs(historyObj);
                this.history = [JSON.stringify(historyObj)];
                this.historyStep = 0;

                console.log(`Design ${id} loaded with high-fidelity accuracy.`);
            } else {
                throw new Error('Design not found in persistence');
            }
            this.isHistoryLoading = false;
        } catch (e) {
            console.error('Failed to load professional design:', e);
            this.isHistoryLoading = false;
        }
    }

    public async deleteProject(id: string): Promise<void> {
        const updated = this.savedProjects().filter(p => p.id !== id);
        this.savedProjects.set(updated);
        await this.imageStorage.saveProjects(updated);
    }

    // Import External Template
    async importExternalTemplate(template: Template): Promise<void> {
        // Just add it to the saved templates.
        try {
            const templates = await this.imageStorage.getTemplates();
            // Check for duplicates? ID is timestamp based so unlikely.
            templates.push(template);
            await this.imageStorage.saveTemplates(templates);
            this.initSavedTemplates(); // Refresh signal

        } catch (e) {
            console.error('Failed to import template', e);
            throw e;
        }
    }

    // --- CURVED TEXT & IMAGE IMPLEMENTATION ---

    reviveCurvedElements(): void {
        const objs = this.canvas.getObjects() as any[];
        objs.forEach(obj => {
            if (obj.type === 'textbox' && obj.curvature) {
                this.updateTextCurve(obj.curvature, obj);
            }
        });
        this.canvas.renderAll();
    }

    updateTextCurve(value: number, targetObj?: any): void {
        const obj = targetObj || this.canvas.getActiveObject() as any;
        if (!obj || obj.type !== 'textbox') return;

        obj.curvature = value;
        this.curvedText.set(value);

        if (value === 0) {
            obj.set('path', null);
        } else {
            // Path-based curvature for Fabric 6+
            const width = obj.width * obj.scaleX;
            // Map 0-100 to radius. Low value = big radius (flat), High value = small radius (curved)
            // Range: 200 (very curved) to 5000 (flat)
            const radius = 5000 / (Math.abs(value) / 10 || 1);
            const pathData = this.calculateArcPath(width, radius, value > 0);

            const path = new fabric.Path(pathData, {
                visible: false,
                stroke: 'transparent',
                fill: 'transparent'
            });

            obj.set({
                path: path,
                pathSide: 'left',
                pathAlign: 'center'
            });
        }

        this.canvas.renderAll();
        // saveState() is usually triggered by object:modified, 
        // but here we manually trigger for slider smoothness if needed, 
        // though better to do it on change:end.
    }

    private calculateArcPath(width: number, radius: number, isUpward: boolean): string {
        const sweep = isUpward ? 0 : 1;
        const startX = 0;
        const startY = 0;
        const endX = width;
        const endY = 0;

        // M X Y A RX RY X-ROT LARGE-ARC SWEEP ENDX ENDY
        return `M ${startX} ${startY} A ${radius} ${radius} 0 0 ${sweep} ${endX} ${endY}`;
    }

    async updateImageCurve(value: number): Promise<void> {
        const currentObj = this.canvas.getActiveObject() as any;
        if (!currentObj) return;

        const sourceImg = currentObj._originalImage || (currentObj.type === 'image' ? currentObj : null);
        if (!sourceImg) return;

        this.curvedImage.set(value);

        if (value === 0 && currentObj.isCurvedGroup) {
            const origSrc = currentObj.originalImageSrc;
            if (origSrc) {
                fabric.Image.fromURL(origSrc).then(orig => {
                    orig.set({
                        left: currentObj.left,
                        top: currentObj.top,
                        angle: currentObj.angle,
                        scaleX: currentObj.scaleX || 1,
                        scaleY: currentObj.scaleY || 1
                    });
                    this.canvas.remove(currentObj);
                    this.canvas.add(orig);
                    this.canvas.setActiveObject(orig);
                    this.canvas.renderAll();
                    this.saveState();
                });
            }
            return;
        }

        if (value === 0) return;

        // Optimized Slicing
        const slicesCount = 30; // Reduced for performance
        const imgWidth = sourceImg.getScaledWidth();
        const radius = 3000 / (Math.abs(value) / 5 || 1);
        const totalAngle = imgWidth / radius;
        const startAngle = -totalAngle / 2;

        const segments: fabric.Object[] = [];

        for (let i = 0; i < slicesCount; i++) {
            // Synchronous clone for performance
            const cloned = new fabric.Image(sourceImg.getElement(), {
                scaleX: sourceImg.scaleX,
                scaleY: sourceImg.scaleY,
                originX: 'center',
                originY: 'center'
            });

            const clipRect = new fabric.Rect({
                left: (i * (sourceImg.width / slicesCount)) - (sourceImg.width / 2),
                top: -sourceImg.height / 2,
                width: sourceImg.width / slicesCount + 0.8, // Overlap to prevent subpixel gaps
                height: sourceImg.height,
                absolutePositioned: false
            });

            cloned.set({ clipPath: clipRect });

            const theta = startAngle + (i / slicesCount) * totalAngle;
            const x = Math.sin(theta) * radius;
            const y = value > 0 ? (Math.cos(theta) * radius - radius) : (-Math.cos(theta) * radius + radius);

            cloned.set({
                left: x,
                top: y,
                angle: theta * (180 / Math.PI)
            });

            segments.push(cloned);
        }

        const group = new fabric.Group(segments, {
            left: currentObj.left,
            top: currentObj.top,
            angle: currentObj.angle,
            originX: 'center',
            originY: 'center'
        }) as any;

        // CRITICAL: Preserve persistence links
        const persistentId = (currentObj as any).idbId;
        if (persistentId) {
            group.idbId = persistentId;
            group.originalImageSrc = `indexeddb://${persistentId}`;
        } else {
            group.originalImageSrc = sourceImg.src || sourceImg.toDataURL();
        }

        group.isCurvedGroup = true;
        group.imageCurvature = value;

        sourceImg.set('visible', false);
        this.canvas.remove(currentObj);
        this.canvas.add(group);
        this.canvas.setActiveObject(group);
        this.canvas.requestRenderAll();
        // Debounce or only save state on slider end in real production, 
        // but for this task we add it here.
        this.saveState();
    }
}
