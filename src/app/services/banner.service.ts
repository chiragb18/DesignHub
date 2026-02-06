import { Injectable, signal, inject } from '@angular/core';
import * as fabric from 'fabric';
import { TransliterationService } from './transliteration.service';
import { ImageStorageService } from './image-storage.service';
import { removeBackground, Config } from '@imgly/background-removal';

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
    public typingLanguage = signal<'en' | 'mr'>('en');
    public isSaving = signal(false);
    public isProjectLoading = signal(false);
    public activeProjectId = signal<string | null>(null);
    public curvedText = signal<number>(0);
    public curvedImage = signal<number>(0);

    private cropOverlay: fabric.Rect | null = null;
    private cropTarget: fabric.Image | null = null;
    private highlightOutline: fabric.Rect | null = null;

    // Track blob URLs to prevent garbage collection
    private activeBlobUrls: string[] = [];

    private imageStorage = inject(ImageStorageService);
    private translitService = inject(TransliterationService);

    constructor() { }

    initCanvas(canvasId: string): void {
        this.canvas = new fabric.Canvas(canvasId, {
            width: 1200,
            height: 675,
            backgroundColor: '#ffffff',
            preserveObjectStacking: true
        });

        // Set initial gradient from user request
        this.setInitialGradient();

        this.setupEvents();
        this.setupZoomEvents();
        this.setupKeyboardEvents();
        this.initSavedProjects();
        this.initSavedTemplates();
        this.initCutouts();

        // Try loading autosave; if none, it remains blank
        this.loadAutosave();

        this.refreshState();
        this.saveState();
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
        const cursor = obj.selectionStart || 0;

        // Strategy: Match the English word ending at the cursor
        const textBeforeCursor = text.substring(0, cursor);
        const match = textBeforeCursor.match(/[A-Za-z]+$/);

        if (match) {
            const word = match[0];
            const transliterated = this.translitService.phoneticMarathi(word);

            if (transliterated !== word) {
                const newTextBefore = textBeforeCursor.substring(0, textBeforeCursor.length - word.length) + transliterated;
                const newFullText = newTextBefore + text.substring(cursor);

                (obj as any)._isTransliterating = true;
                obj.set('text', newFullText);

                // Set cursor to end of transliterated part
                const newCursor = newTextBefore.length;
                obj.setSelectionStart(newCursor);
                obj.setSelectionEnd(newCursor);

                this.canvas.renderAll();
                (obj as any)._isTransliterating = false;
            }
        }
    }

    private isPhoneticChar(char: string): boolean {
        if (!char) return false;
        if (/[A-Za-z']/.test(char)) return true;
        const code = char.charCodeAt(0);
        return (code >= 0x0900 && code <= 0x097F);
    }

    private setInitialGradient(): void {
        this.canvas.backgroundColor = '#ffffff'; // White default
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

    undo(): void {
        if (this.historyStep > 0) {
            this.isHistoryLoading = true;
            this.historyStep--;
            const state = this.history[this.historyStep];
            this.canvas.loadFromJSON(state).then(() => {
                this.canvas.renderAll();
                this.refreshState();
                this.isHistoryLoading = false;
            }).catch(err => {
                console.error('Undo failed', err);
                this.isHistoryLoading = false;
            });
        }
    }

    redo(): void {
        if (this.historyStep < this.history.length - 1) {
            this.isHistoryLoading = true;
            this.historyStep++;
            const state = this.history[this.historyStep];
            this.canvas.loadFromJSON(state).then(() => {
                this.canvas.renderAll();
                this.refreshState();
                this.isHistoryLoading = false;
            }).catch(err => {
                console.error('Redo failed', err);
                this.isHistoryLoading = false;
            });
        }
    }


    resizeCanvas(width: number, height: number): void {
        this.canvas.setDimensions({ width, height });
        this.canvas.renderAll();
        this.saveState();
    }

    addText(text: string = 'New Text', options: any = {}): void {
        const textbox = new fabric.Textbox(text, {
            left: 100,
            top: 100,
            width: 200,
            fontSize: 32,
            fill: '#7c3aed',
            fontFamily: 'Inter',
            ...options
        });
        this.canvas.add(textbox);
        this.canvas.centerObject(textbox);
        this.canvas.setActiveObject(textbox);
        this.canvas.renderAll();
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

    addImage(url: string): void {
        const imgObj = new Image();
        imgObj.src = url;
        imgObj.crossOrigin = 'anonymous'; // Critical for external images to not taint canvas

        imgObj.onload = () => {
            const img = new fabric.Image(imgObj);
            const canvasW = this.canvas.width || 1200;
            const scale = Math.min(300 / (img.width || 1), 1);
            img.scale(scale);
            this.canvas.add(img);
            this.canvas.centerObject(img);
            this.canvas.setActiveObject(img);
            this.canvas.renderAll();
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

        // 1. Handle Images
        if (obj.type === 'image' && obj.src) {
            obj.src = await this.offloadUrl(obj.src);
        }

        // 2. Handle Patterns in fill or stroke (Critical for backgrounds & shapes)
        for (const prop of ['fill', 'stroke']) {
            const val = obj[prop];
            if (val && typeof val === 'object' && val.type === 'pattern' && val.source) {
                if (typeof val.source === 'string') {
                    val.source = await this.offloadUrl(val.source);
                }
            }
        }

        // 3. Recursively handle groups
        if (obj.objects) {
            for (const child of obj.objects) {
                await this.offloadObjectImage(child);
            }
        }
    }

    private async offloadUrl(url: string): Promise<string> {
        if (!url || typeof url !== 'string' || url.startsWith('indexeddb://')) return url;

        if (url.startsWith('data:')) {
            try {
                const blob = this.dataURLtoBlob(url);
                const id = await this.imageStorage.saveImage(blob);
                return `indexeddb://${id}`;
            } catch (e) {
                console.error('Failed to offload data-url', e);
                return url;
            }
        } else if (url.startsWith('blob:')) {
            let blob: Blob | null = null;
            try {
                const response = await fetch(url);
                blob = await response.blob();
                const id = await this.imageStorage.saveImage(blob);
                return `indexeddb://${id}`;
            } catch (e) {
                console.error('Failed to offload blobUrl, attempting fallback...', e);
                if (blob) {
                    try {
                        return await this.blobToDataURL(blob);
                    } catch (e2) { }
                }
                return url;
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
        const customProps = ['curvature', 'imageCurvature', 'isCurvedGroup', 'id', 'name', 'originalImageSrc', 'maskType', 'maskHeight', 'maskFlip'];
        const json = this.canvas.toObject(customProps);
        // Save dimensions to ensure accurate restore
        (json as any).width = this.canvas.width;
        (json as any).height = this.canvas.height;

        await this.processImagesForStorage(json);

        // 3. Generate clean thumbnail
        const thumbnail = this.canvas.toDataURL({
            format: 'jpeg',
            multiplier: 0.2,
            quality: 0.7,
            enableRetinaScaling: false
        });

        // Get all templates from storage to check for existing
        const allSaved = await this.imageStorage.getTemplates();
        const activeId = this.activeTemplateId();
        const existingIndex = allSaved.findIndex(t => t.id === activeId && t.isCustom);

        let updatedTemplates: Template[];

        if (existingIndex !== -1 && activeId && allSaved[existingIndex].name === name) {
            // UPDATE existing
            updatedTemplates = [...allSaved];
            updatedTemplates[existingIndex] = {
                ...updatedTemplates[existingIndex],
                json,
                thumbnail,
                category,
                date: new Date() // Ensure date is updated to show as recent
            };
        } else {
            // CREATE new
            const newTemplate: Template = {
                id: Date.now().toString(),
                name,
                category,
                json,
                thumbnail,
                isCustom: true,
                date: new Date()
            };
            updatedTemplates = [...allSaved, newTemplate];
        }

        // Final Safety Check: Ensure NO "blob:" URLs persist in the JSON.
        // If offloading failed for any reason, a "blob:" URL is a time bomb.
        updatedTemplates.forEach(t => {
            const str = JSON.stringify(t.json);
            if (str.includes('"blob:')) {
                console.warn('⚠️ Found residual blob URLs in template, sanitizing...');
                // Replace blob URLs with empty string to prevent load crashes
                const sanitized = str.replace(/"blob:[^"]+"/g, '""');
                t.json = JSON.parse(sanitized); // Note: this reparses the JSON structure
            }
        });

        if (await this.saveTemplatesToStorage(updatedTemplates)) {
            // Reload all signals to keep UI in sync
            await this.initSavedTemplates();

            // If it was a new template, switch ID
            if (existingIndex === -1) {
                const newId = updatedTemplates[updatedTemplates.length - 1].id;
                this.activeTemplateId.set(newId);
            }
            return true;
        }
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
            alert('Failed to save template: ' + e.message);
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
            alert('Please select an image first');
            return;
        }

        const originalImg = activeObject as fabric.Image;
        const originalSrc = (originalImg as any)._element?.src || (originalImg as any).src;

        if (!originalSrc) return;

        try {
            this.isRemovingBg.set(true);
            this.bgRemovalProgress.set(0);

            let processingSource: string | Blob = originalSrc;

            // Try to get data URL for better reliability, but fallback to original if it fails (CORS)
            try {
                const tempCanvas = document.createElement('canvas');
                const imgElement = (originalImg as any)._element as HTMLImageElement;
                tempCanvas.width = imgElement.naturalWidth || imgElement.width;
                tempCanvas.height = imgElement.naturalHeight || imgElement.height;
                const ctx = tempCanvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(imgElement, 0, 0);
                    processingSource = tempCanvas.toDataURL('image/png');
                }
            } catch (e) {
                console.warn('Could not create DataURL (likely CORS), falling back to original source URL', e);
            }

            const config: Config = {
                progress: (key, current, total) => {
                    const percent = Math.round((current / total) * 100);
                    this.bgRemovalProgress.set(percent);
                },
                model: 'isnet',
                output: {
                    format: 'image/png',
                    quality: 0.8
                }
            };

            // @imgly/background-removal works offline with WASM
            const resultBlob = await removeBackground(processingSource, config);

            // Create URL for the transparent result
            const resultUrl = URL.createObjectURL(resultBlob);

            // Load onto canvas
            const imgObj = new Image();
            imgObj.src = resultUrl;

            imgObj.onload = async () => {
                // Store the original src so we can "restore" later if needed
                const newImg = new fabric.Image(imgObj);

                // Copy properties
                newImg.set({
                    left: originalImg.left,
                    top: originalImg.top,
                    scaleX: originalImg.scaleX,
                    scaleY: originalImg.scaleY,
                    angle: originalImg.angle,
                    originX: originalImg.originX,
                    originY: originalImg.originY,
                    flipX: originalImg.flipX,
                    flipY: originalImg.flipY,
                    opacity: originalImg.opacity,
                    skewX: (originalImg as any).skewX,
                    skewY: (originalImg as any).skewY
                });

                // Attach metadata for "re-edit/restore" requirement
                (newImg as any).originalSrc = originalSrc;
                (newImg as any).isBgRemoved = true;

                const index = this.canvas.getObjects().indexOf(originalImg);
                this.canvas.remove(originalImg);
                this.canvas.add(newImg);
                if (index !== -1) {
                    this.canvas.moveObjectTo(newImg, index);
                }

                this.canvas.setActiveObject(newImg);
                this.canvas.renderAll();

                // Save to IndexedDB
                await this.saveAsCutout(resultBlob, 'AI Cutout ' + new Date().toLocaleTimeString());

                this.isRemovingBg.set(false);
                this.saveState();
                URL.revokeObjectURL(resultUrl);
            };

        } catch (error: any) {
            console.error('Offline Background Removal Error:', error);
            alert('AI Removal Failed: ' + error.message);
            this.isRemovingBg.set(false);
        }
    }

    async restoreOriginalImage(): Promise<void> {
        const activeObject = this.canvas.getActiveObject();
        if (!activeObject || !(activeObject as any).originalSrc) {
            alert('No original image found to restore');
            return;
        }

        const currentImg = activeObject as fabric.Image;
        const originalSrc = (currentImg as any).originalSrc;

        const imgObj = new Image();
        imgObj.src = originalSrc;
        imgObj.onload = () => {
            const restoredImg = new fabric.Image(imgObj);
            restoredImg.set({
                left: currentImg.left,
                top: currentImg.top,
                scaleX: currentImg.scaleX,
                scaleY: currentImg.scaleY,
                angle: currentImg.angle,
                originX: currentImg.originX,
                originY: currentImg.originY
            });

            this.canvas.remove(currentImg);
            this.canvas.add(restoredImg);
            this.canvas.setActiveObject(restoredImg);
            this.canvas.renderAll();
            this.saveState();
        };
    }

    async saveAsCutout(blob: Blob, name: string): Promise<void> {
        try {
            await this.imageStorage.saveCutout(blob, name);
            await this.initCutouts(); // Refresh the list
        } catch (e) {
            console.error('Failed to save cutout', e);
        }
    }

    async addCutoutToCanvas(cutout: Cutout): Promise<void> {
        const url = URL.createObjectURL(cutout.blob);
        const imgObj = new Image();
        imgObj.src = url;

        imgObj.onload = () => {
            const img = new fabric.Image(imgObj);
            const scale = Math.min(400 / (img.width || 1), 1);
            img.scale(scale);

            this.canvas.add(img);
            this.canvas.centerObject(img);
            this.canvas.setActiveObject(img);
            this.canvas.renderAll();
            this.saveState();

            URL.revokeObjectURL(url);
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
        try {
            console.log('Loading template...', templateJson);
            this.isHistoryLoading = true;
            this.canvas.discardActiveObject();

            // If it's a string, parse it; otherwise use as object
            let data;
            if (typeof templateJson === 'string') {
                try {
                    data = JSON.parse(templateJson);
                } catch (e) {
                    console.error('Failed to parse template JSON string:', e);
                    throw new Error('Invalid template JSON format');
                }
            } else if (typeof templateJson === 'object' && templateJson !== null) {
                // Deep clone to avoid reference issues
                data = JSON.parse(JSON.stringify(templateJson));
            } else {
                throw new Error('Template data must be a string or object');
            }

            console.log('Parsed template data:', data);

            // CRITICAL FIX: Brute-force sanitize any remaining blob: URLs to prevent Fabric crash
            // This catches deep properties that recursive search might miss or fail to clear
            try {
                const jsonStr = JSON.stringify(data);
                if (jsonStr.includes('blob:')) {
                    console.warn('🧹 Sanitizing blob URLs from template JSON...');
                    // Replace "blob:..." with "" (empty string)
                    const sanitized = jsonStr.replace(/"blob:[^"]+"/g, '""');
                    data = JSON.parse(sanitized);
                }
            } catch (e) {
                console.error('Error sanitizing JSON:', e);
            }

            // Restore images from DB
            await this.restoreImagesFromStorage(data);

            // Restore canvas dimensions if present (fixes layout accuracy)
            if (data.width && data.height) {
                this.resizeCanvas(data.width, data.height);
            }

            console.log(`Template images restored. Object count in JSON: ${data.objects?.length || 0}`);

            // MODERN FABRIC 7+ LOADING
            try {
                // Ensure canvas is clean and reset before loading
                this.canvas.discardActiveObject();
                this.canvas.clear();

                // Reset viewport/zoom to defaults for consistent loading
                this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
                this.canvas.setZoom(1);

                // For Fabric 7, loadFromJSON is the best way to restore backgrounds + objects
                // We ensure it's awaited.
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
            this.refreshState();
            this.selectedObject.set(null);
            this.isHistoryLoading = false;
            this.saveState();

            console.log('✅ Template load process complete');

            // Trigger info banner
            this.showTemplateInfo.set(true);
            setTimeout(() => this.showTemplateInfo.set(false), 4000);
        } catch (err) {
            console.error('Load template failed:', err);
            alert('Failed to load template: ' + (err as Error).message);
            this.isHistoryLoading = false;
        }
    }

    // Add template to existing canvas (without clearing)
    async addTemplateToCanvas(templateJson: any): Promise<void> {
        try {
            console.log('Adding template to canvas...', templateJson);

            // Parse the template JSON
            let data;
            if (typeof templateJson === 'string') {
                try {
                    data = JSON.parse(templateJson);
                } catch (e) {
                    console.error('Failed to parse template JSON string:', e);
                    throw new Error('Invalid template JSON format');
                }
            } else if (typeof templateJson === 'object' && templateJson !== null) {
                data = JSON.parse(JSON.stringify(templateJson));
            } else {
            }

            // CRITICAL FIX: Brute-force sanitize any remaining blob: URLs
            try {
                const jsonStr = JSON.stringify(data);
                if (jsonStr.includes('blob:')) {
                    console.warn('🧹 Sanitizing blob URLs from template JSON (Add)...');
                    const sanitized = jsonStr.replace(/"blob:[^"]+"/g, '""');
                    data = JSON.parse(sanitized);
                }
            } catch (e) {
                console.error('Error sanitizing JSON:', e);
            }

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
            alert('Failed to add template: ' + (err as Error).message);
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

        // 1. Handle Images
        if (obj.type === 'image' && obj.src) {
            obj.src = await this.restoreUrl(obj.src);
        }

        // 2. Handle Patterns
        for (const prop of ['fill', 'stroke']) {
            const val = obj[prop];
            if (val && typeof val === 'object' && val.type === 'pattern' && val.source) {
                if (typeof val.source === 'string') {
                    val.source = await this.restoreUrl(val.source);
                }
            }
        }

        // 3. Recursively handle groups
        if (obj.objects) {
            for (const child of obj.objects) {
                await this.restoreObjectImage(child);
            }
        }
    }

    private async restoreUrl(url: string): Promise<string> {
        if (!url || typeof url !== 'string' || !url.startsWith('indexeddb://')) return url;
        const id = url.replace('indexeddb://', '');
        try {
            const blob = await this.imageStorage.getImage(id);
            if (blob) {
                return await this.blobToDataURL(blob);
            }
            console.warn('Url not found in IDB:', id);
            return '';
        } catch (e) {
            console.error('Failed to restore URL:', id, e);
            return '';
        }
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

    setAntiGravityBg(imageUrl: string): void {
        const imgObj = new Image();
        imgObj.src = imageUrl;
        imgObj.crossOrigin = 'anonymous';

        imgObj.onload = () => {
            const bgImg = new fabric.Image(imgObj);

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

        this.cropOverlay = new fabric.Rect({
            left: img.left,
            top: img.top,
            width: img.getScaledWidth(),
            height: img.getScaledHeight(),
            fill: 'rgba(255, 255, 255, 0.2)',
            stroke: '#7c3aed',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            cornerColor: 'white',
            cornerStrokeColor: '#7c3aed',
            cornerSize: 12,
            transparentCorners: false,
            angle: img.angle
        });
        this.canvas.add(this.cropOverlay);
        this.canvas.setActiveObject(this.cropOverlay);
        this.canvas.renderAll();
    }

    applyCrop(): void {
        if (!this.cropTarget || !this.cropOverlay) return;
        const img = this.cropTarget;
        const rect = this.cropOverlay;

        const rectPoint = new fabric.Point(rect.left!, rect.top!);
        const invertedMatrix = fabric.util.invertTransform(img.calcTransformMatrix());
        const localTopLeft = fabric.util.transformPoint(rectPoint, invertedMatrix);

        const localPoint = {
            x: localTopLeft.x + (img.width! / 2),
            y: localTopLeft.y + (img.height! / 2)
        };

        const absScaleX = Math.abs(img.scaleX! || 1);
        const absScaleY = Math.abs(img.scaleY! || 1);

        img.set({
            cropX: (img.cropX || 0) + localPoint.x,
            cropY: (img.cropY || 0) + localPoint.y,
            width: rect.getScaledWidth() / absScaleX,
            height: rect.getScaledHeight() / absScaleY,
            left: rect.left,
            top: rect.top
        });

        this.cancelCrop();
        this.canvas.renderAll();
        this.saveState();
    }

    cancelCrop(): void {
        if (this.cropOverlay) this.canvas.remove(this.cropOverlay);
        this.cropOverlay = null;
        this.cropTarget = null;
        this.isCropping.set(false);
        this.canvas.renderAll();
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
            // We use the same storage mechanism as templates for safety (handling images)
            // But for performance, we might just dump the JSON if images are already handled?
            // To be safe, let's just dump the current JSON. 
            // If images are data-urls, they might be large, so we prefer IndexedDB over LocalStorage.
            const json = this.canvas.toJSON();
            // We should ideally offload images, but that's async and might lag simple interactions.
            // For now, let's try saving to IndexedDB directly which handles larger blobs better than LS.
            // We'll use a specific key in the 'settings' store from ImageStorageService.

            // We can manually use the imageStorage db instance if we expose a method, 
            // or just add a generic save method there. 
            // Let's add 'saveAutosave' to ImageStorageService ideally, but for now we can reuse saveProject logic or just add a quick method here if we had access?
            // Actually, let's assume we can add a method to ImageStorageService or use a specialized one.
            // For quick fix: localStorage if small, but risk.
            // Better: use imageStorage.

            await this.imageStorage.saveAutosave(JSON.stringify(json));

        } catch (e) {
            console.warn('Autosave failed', e);
        }
    }

    private async loadAutosave(): Promise<void> {
        try {
            const jsonStr = await this.imageStorage.getAutosave();
            if (jsonStr) {
                this.isHistoryLoading = true; // Prevent autosave overlap
                const json = JSON.parse(jsonStr);

                // Restore images from DB if needed (using existing logic for robustness)
                await this.restoreImagesFromStorage(json);

                this.canvas.loadFromJSON(json).then(() => {
                    this.canvas.renderAll();
                    this.refreshState();
                    this.history = [JSON.stringify(json)];
                    this.historyStep = 0;
                    this.isHistoryLoading = false;
                });
            }
        } catch (e) {
            console.warn('No autosave found or failed to load', e);
            this.isHistoryLoading = false;
        }
    }

    // Override saveState to include autosave
    private timeoutId: any;
    private saveState(): void {
        if (this.isHistoryLoading) return;
        const json = JSON.stringify(this.canvas.toJSON());
        this.historyStep++;
        this.history = this.history.slice(0, this.historyStep);
        this.history.push(json);

        // Debounced Autosave (1s)
        clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(() => {
            this.autoSaveProject();
        }, 1000);
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

        // Include custom properties in serialization
        const customProps = ['curvature', 'imageCurvature', 'isCurvedGroup', 'id', 'name', 'originalImageSrc', 'maskType', 'maskHeight', 'maskFlip'];
        const json = this.canvas.toObject(customProps);
        // Save dimensions for accurate restoration
        (json as any).width = this.canvas.width;
        (json as any).height = this.canvas.height;
        await this.processImagesForStorage(json);

        // Safety Check: Sanitize residual blob URLs
        const jsonString = JSON.stringify(json);
        let finalJson = jsonString;
        if (jsonString.includes('"blob:')) {
            console.warn('Sanitizing Project JSON from blob URLs');
            finalJson = jsonString.replace(/"blob:[^"]+"/g, '""');
        }

        const thumbnail = this.canvas.toDataURL({
            format: 'jpeg',
            quality: 0.6,
            multiplier: 0.15
        });

        const activeId = this.activeProjectId();
        const current = this.savedProjects();
        let updated: SavedProject[];

        if (activeId) {
            // Update existing AND move to top
            const existing = current.find(p => p.id === activeId);
            const others = current.filter(p => p.id !== activeId);

            if (existing) {
                const updatedProject = {
                    ...existing,
                    name: name || existing.name,
                    json: finalJson,
                    thumbnail,
                    date: Date.now()
                };
                updated = [updatedProject, ...others];
            } else {
                updated = current; // Should not happen
            }
        } else {
            // Create new
            const newProject: SavedProject = {
                id: Date.now().toString(),
                name,
                json: finalJson,
                thumbnail,
                date: Date.now()
            };
            updated = [newProject, ...current];
            this.activeProjectId.set(newProject.id);
        }

        this.savedProjects.set(updated);
        await this.imageStorage.saveProjects(updated);
        this.isSaving.set(false);
    }

    public async loadProject(id: string): Promise<void> {
        const project = this.savedProjects().find(p => p.id === id);
        if (!project) {
            console.error('Project not found:', id);
            alert('Project not found');
            return;
        }

        try {
            console.log('Loading project:', project.name, id);
            this.isProjectLoading.set(true);
            this.isHistoryLoading = true;
            this.activeProjectId.set(id);
            this.canvas.discardActiveObject();

            // Parse JSON
            let data;
            if (typeof project.json === 'string') {
                try {
                    data = JSON.parse(project.json);
                } catch (e) {
                    console.error('Failed to parse project JSON:', e);
                    throw new Error('Invalid project data format');
                }
            } else {
                data = JSON.parse(JSON.stringify(project.json));
            }

            console.log('Project data parsed, restoring images...');

            // Restore images from IndexedDB
            await this.restoreImagesFromStorage(data);

            console.log('Project images restored, loading into canvas...');

            // Restore canvas dimensions if present
            if (data.width && data.height) {
                this.resizeCanvas(data.width, data.height);
            }

            // MODERN FABRIC 7+ LOADING
            try {
                this.canvas.discardActiveObject();
                this.canvas.clear();
                this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
                this.canvas.setZoom(1);

                await this.canvas.loadFromJSON(data);

                // Fallback check: If objects didn't load (rare async issue)
                if (this.canvas.getObjects().length === 0 && data.objects && data.objects.length > 0) {
                    console.warn('⚠️ Manual object injection fallback for project');
                    const objects = await (fabric.util as any).enlivenObjects(data.objects);
                    if (objects && objects.length > 0) {
                        this.canvas.add(...objects);
                    }
                }

                console.log('🎨 canvas.loadFromJSON project completed');
            } catch (e) {
                console.error('🔥 Error during canvas.loadFromJSON (project):', e);
                if (data.objects) {
                    const objects = await (fabric.util as any).enlivenObjects(data.objects);
                    this.canvas.add(...objects);
                }
            }

            this.canvas.requestRenderAll();
            this.reviveCurvedElements();
            this.refreshState();
            this.selectedObject.set(null);
            this.isHistoryLoading = false;
            this.history = [JSON.stringify(data)];
            this.historyStep = 0;
            this.isProjectLoading.set(false);

            console.log('✅ Project loaded successfully:', project.name);
        } catch (err) {
            console.error('Failed to load project:', err);
            alert('Failed to load project: ' + (err as Error).message);
            this.isHistoryLoading = false;
            this.isProjectLoading.set(false);
            this.activeProjectId.set(null);
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

        group.originalImageSrc = sourceImg.src || sourceImg.toDataURL();
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
