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
    seeded?: boolean; // Indicates item was seeded from global JSON
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
    private readonly MAX_HISTORY = 50;

    // Writable signals for UI (updated manually since historyStep is a plain property)
    public canUndo = signal<boolean>(false);
    public canRedo = signal<boolean>(false);

    private rbFunctionCache: any = null;

    // State signals
    public selectedObject = signal<fabric.Object | null>(null);
    public objects = signal<fabric.Object[]>([]);
    canvasState = signal<string | null>(null);
    zoomLevel = signal<number>(1);
    isCropping = signal<boolean>(false);

    // Brush & Eraser State
    public isDrawingMode = signal(false);
    public brushType = signal<string>('pen');
    public brushSize = signal(10);
    public brushColor = signal('#000000');
    public brushOpacity = signal(1);
    public brushSmoothing = signal(2); // decimate value
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
    public isMobile = signal<boolean>(false);
    public sidebarWidth = signal<number>(438); // Standard 350px sidebar + 88px nav
    public isPenCutting = signal<boolean>(false);
    public penCutTarget: fabric.Image | null = null;
    private currentPenPath: fabric.Path | null = null;

    private cropOverlay: fabric.Rect | null = null;
    private cropTarget: fabric.Image | null = null;
    private highlightOutline: fabric.Rect | null = null;

    // Track blob URLs to prevent memory leaks
    private activeBlobUrls: string[] = [];

    // Props to include in JSON serialization
    private readonly SERIALIZE_PROPS = [
        'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
        'originX', 'originY', 'flipX', 'flipY', 'skewX', 'skewY',
        'id', 'name', 'idbId', 'src', 'originalSrc', 'isBgRemoved', 'excludeFromExport',
        'originalImageSrc', 'maskType', 'maskHeight', 'maskFlip',
        'opacity', 'visible', 'selectable', 'evented', 'lockMovementX', 'lockMovementY',
        'cropX', 'cropY', 'filters', 'clipPath', 'crossOrigin', 'stroke', 'strokeWidth', 'strokeDashArray', 'fill',
        'shadow', 'rx', 'ry', 'radius', 'points', 'path',
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'overline', 'strikethrough',
        'textAlign', 'lineHeight', 'charSpacing', 'textBackgroundColor'
    ];

    private imageStorage = inject(ImageStorageService);
    private translitService = inject(TransliterationService);
    private persistenceService = inject(PersistenceService);
    private notificationService = inject(NotificationService);

    public brushTypes = [
        { id: 'pen', name: 'Pencil', icon: 'edit', path: 'M20,50 C30,30 70,70 80,50' },
        { id: 'marker', name: 'Highlighter', icon: 'border_color', path: 'M20,50 C30,30 70,70 80,50' },
        { id: 'circle', name: 'Circle', icon: 'circle', path: 'M50,20 A30,30 0 1,1 50,80 A30,30 0 1,1 50,20' },
        { id: 'spray', name: 'Spray', icon: 'blur_on', path: 'M20,50 L80,50' },
        { id: 'pattern', name: 'Pattern', icon: 'stars', path: 'M20,50 L80,50' },
        { id: 'dotted', name: 'Dotted', icon: 'more_horiz', path: 'M20,50 L30,50 M45,50 L55,50 M70,50 L80,50' },
        { id: 'glow', name: 'Glow Path', icon: 'flare', path: 'M20,50 C30,30 70,70 80,50' },
        { id: 'ink', name: 'Artistic Ink', icon: 'history_edu', path: 'M20,60 C40,20 60,80 80,40' },
        { id: 'chalk', name: 'Chalk Dust', icon: 'texture', path: 'M20,50 L30,45 L40,55 L50,45 L60,55 L70,45 L80,50' },
        { id: 'hatch', name: 'Hatched', icon: 'grid_on', path: 'M20,20 L80,80 M20,80 L80,20' },
        { id: 'rainbow', name: 'Rainbow', icon: 'filter_vintage', path: 'M20,70 C40,20 60,20 80,70' },
        { id: 'airbrush', name: 'Airbrush', icon: 'air', path: 'M30,30 C50,70 70,30 90,70' },
        { id: 'crayon', name: 'Crayon', icon: 'draw', path: 'M20,50 L35,55 L50,45 L65,55 L80,50' },
        { id: 'ribbon', name: 'Silk Ribbon', icon: 'reorder', path: 'M20,45 L80,45 M20,55 L80,55' }
    ];

    constructor() {
        this.debouncedSave = this.debounce(this.saveState.bind(this), 300);
        this.debouncedResize = this.debounce(this.handleResize.bind(this), 100);
        this.debouncedRefresh = this.debounce(this.refreshState.bind(this), 50);
    }

    // ... (InitCanvas and other methods remain) ...

    // Manual Adjustment Debouncer
    private debouncedSave: (() => void) & { cancel: () => void };
    private debouncedResize: (() => void) & { cancel: () => void };
    private debouncedRefresh: (() => void) & { cancel: () => void };
    private debounce(func: Function, wait: number): (() => void) & { cancel: () => void } {
        let timeout: any;
        const debounced = (...args: any[]) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
        (debounced as any).cancel = () => clearTimeout(timeout);
        return debounced as any;
    }

    // ... (Skip to applying filters) ...

    applyFilter(filterType: 'Grayscale' | 'Invert' | 'Sepia' | 'None'): void {
        const activeObject = this.canvas.getActiveObject();
        if (activeObject && activeObject.type === 'image') {
            const img = activeObject as fabric.Image;

            // Save COMPREHENSIVE state to prevent any shifting/resizing
            const state = {
                width: img.width,
                height: img.height,
                scaleX: img.scaleX,
                scaleY: img.scaleY,
                left: img.left,
                top: img.top,
                cropX: img.cropX,
                cropY: img.cropY,
                angle: img.angle,
                flipX: img.flipX,
                flipY: img.flipY,
                skewX: img.skewX,
                skewY: img.skewY
            };

            const prevCaching = img.objectCaching;
            img.set('objectCaching', false);

            // Ensure safe execution
            try {
                // Ensure crossOrigin is set for filters to work
                if ((img as any).crossOrigin !== 'anonymous') {
                    img.set({ crossOrigin: 'anonymous' });
                }

                // Remove existing simple filters
                img.filters = (img.filters || []).filter(f =>
                    !['Grayscale', 'Invert', 'Sepia'].includes((f as any).type)
                );

                if (filterType === 'Grayscale') img.filters.push(new fabric.filters.Grayscale());
                else if (filterType === 'Invert') img.filters.push(new fabric.filters.Invert());
                else if (filterType === 'Sepia') img.filters.push(new fabric.filters.Sepia());

                img.applyFilters();

                // CRITICAL: Force Restore of all geometric properties
                // fabric.Image.applyFilters() can sometimes reset scale or dimensions based on the new element
                img.set(state);

                // Force recalculation of coordinates
                img.setCoords();
                img.set('dirty', true);
                img.set('objectCaching', prevCaching);

                this.canvas.renderAll();
                this.saveState();
            } catch (e) {
                console.error('Filter application failed', e);
                img.set('objectCaching', prevCaching);
                this.notificationService.error('Could not apply filter');
            }
        }
    }

    setBrightness(value: number): void {
        this.applyManualFilter('Brightness', new fabric.filters.Brightness({ brightness: value }));
    }

    setContrast(value: number): void {
        this.applyManualFilter('Contrast', new fabric.filters.Contrast({ contrast: value }));
    }

    setSaturation(value: number): void {
        this.applyManualFilter('Saturation', new fabric.filters.Saturation({ saturation: value }));
    }

    private applyManualFilter(type: string, filter: any): void {
        const obj = this.canvas.getActiveObject();
        if (obj && obj.type === 'image') {
            const img = obj as fabric.Image;

            // Save COMPREHENSIVE state
            const state = {
                width: img.width,
                height: img.height,
                scaleX: img.scaleX,
                scaleY: img.scaleY,
                left: img.left,
                top: img.top,
                cropX: img.cropX,
                cropY: img.cropY,
                angle: img.angle,
                flipX: img.flipX,
                flipY: img.flipY,
                skewX: img.skewX,
                skewY: img.skewY
            };

            const prevCaching = img.objectCaching;
            img.set('objectCaching', false);

            try {
                // Ensure crossOrigin is set
                if ((img as any).crossOrigin !== 'anonymous') {
                    img.set({ crossOrigin: 'anonymous' });
                }

                // Clean existing filter of same type
                img.filters = (img.filters || []).filter(f => (f as any).type !== type);
                // Add new
                img.filters.push(filter);

                img.applyFilters();

                // CRITICAL: Force Restore
                img.set(state);

                img.setCoords();
                img.set('dirty', true);
                img.set('objectCaching', prevCaching);

                this.canvas.requestRenderAll();

                // Debounced save to prevent history flooding
                this.debouncedSave();
            } catch (e) {
                console.error(`Failed to set ${type}`, e);
                img.set('objectCaching', prevCaching);
            }
        }
    }

    async initCanvas(canvasId: string): Promise<void> {
        this.updateMobileState();

        const { width, height } = this.calculateCanvasDimensions();

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
            window.addEventListener('resize', () => this.debouncedResize());
        }
    }

    /** Calculate the best canvas dimensions to fit the current viewport */
    private calculateCanvasDimensions(): { width: number; height: number } {
        if (typeof window === 'undefined') return { width: 1200, height: 675 };

        const isMobile = window.innerWidth < 1024;
        this.isMobile.set(isMobile);

        const topNavHeight = isMobile ? 56 : 64;
        // Mobile toolbar at bottom adds 72px
        const bottomBarHeight = isMobile ? 72 : 0;
        // Left nav sidebar width (only on desktop)
        const leftNavWidth = isMobile ? 0 : 88;
        // Right sidebar (only on desktop)
        const rightSidebarWidth = isMobile ? 0 : this.sidebarWidth();
        // Padding around canvas
        const padding = isMobile ? 16 : 60;

        const availableWidth = window.innerWidth - leftNavWidth - rightSidebarWidth - padding;
        const availableHeight = window.innerHeight - topNavHeight - bottomBarHeight - padding;

        const baseWidth = 1200;
        const baseHeight = 675;
        const aspectRatio = baseHeight / baseWidth;

        let width = baseWidth;
        let height = baseHeight;

        if (width > availableWidth) {
            width = Math.max(280, availableWidth);
            height = width * aspectRatio;
        }
        if (height > availableHeight) {
            height = Math.max(180, availableHeight);
            width = height / aspectRatio;
        }

        return { width: Math.round(width), height: Math.round(height) };
    }

    private updateMobileState(): void {
        if (typeof window !== 'undefined') {
            // Modern breakpoint for "Compact/Medium" layouts vs "Expanded"
            this.isMobile.set(window.innerWidth < 1024);
        }
    }

    public setSidebarWidth(width: number): void {
        this.sidebarWidth.set(width);
        this.handleResize();
    }

    /**
     * Public method to trigger canvas recalculation based on current window size and sidebars.
     * Useful for manual resizing interactions.
     */
    public handleResize(): void {
        if (!this.canvas || typeof window === 'undefined') return;

        this.updateMobileState();
        const { width, height } = this.calculateCanvasDimensions();
        const zoom = width / 1200;

        this.canvas.setDimensions({
            width: Math.round(width),
            height: Math.round(height)
        });

        this.canvas.setZoom(zoom);
        this.zoomLevel.set(zoom);
        this.canvas.requestRenderAll();
    }

    public toggleDrawingMode(enabled?: boolean): void {
        const currentlyDrawing = enabled !== undefined ? enabled : !this.isDrawingMode();

        if (currentlyDrawing) {
            // Disable other modes
            this.isErasing.set(false);
            this.isPenCutting.set(false);

            this.canvas.discardActiveObject();
            // Disable selection while drawing
            this.canvas.selection = false;
            this.canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });
            this.canvas.isDrawingMode = true;
            this.setBrushType(this.brushType());
        } else {
            this.canvas.isDrawingMode = false;
            // Restore selection after drawing
            this.canvas.selection = true;
            this.canvas.getObjects().forEach(o => { o.selectable = true; o.evented = true; });
        }

        this.isDrawingMode.set(currentlyDrawing);
        this.canvas.renderAll();
    }


    /**
     * Set the active brush type. Fully compatible with Fabric.js v6/v7.
     * SprayBrush, CircleBrush, PatternBrush are implemented via custom canvas overrides
     * since they were removed from Fabric v6+.
     */
    public setBrushType(type: string): void {
        this.brushType.set(type);
        if (!this.canvas) return;

        const color = this.brushColor();
        const size = this.brushSize();
        const opacityHex = Math.round(this.brushOpacity() * 255).toString(16).padStart(2, '0');
        const colorWithOpacity = color + opacityHex;

        let brush: fabric.PencilBrush;

        switch (type) {
            // ── Highlighter / Marker ──────────────────────────────────────────────
            case 'marker': {
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size * 2.5;
                (brush as any).strokeLineCap = 'square';
                brush.color = color + '55'; // ~33% opacity for highlighter feel
                break;
            }

            // ── Circle Brush (custom – draws filled circles along path) ───────────
            case 'circle': {
                brush = this.createCircleBrush(size, colorWithOpacity);
                break;
            }

            // ── Spray Brush (custom – scatter dots around pointer) ────────────────
            case 'spray': {
                brush = this.createSprayBrush(size, colorWithOpacity);
                break;
            }

            // ── Pattern / Stamp Brush ─────────────────────────────────────────────
            case 'pattern': {
                brush = this.createPatternBrush('star');
                break;
            }

            // ── Glow / Neon ───────────────────────────────────────────────────────
            case 'glow': {
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size;
                brush.color = colorWithOpacity;
                (brush as any).shadow = new fabric.Shadow({
                    color: color,
                    blur: size * 2,
                    offsetX: 0,
                    offsetY: 0
                });
                break;
            }

            // ── Artistic Ink (high-precision, pressure-like) ──────────────────────
            case 'ink': {
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size;
                brush.color = colorWithOpacity;
                brush.decimate = 1;
                (brush as any).strokeLineJoin = 'round';
                (brush as any).strokeLineCap = 'round';
                break;
            }

            // ── Chalk Dust ────────────────────────────────────────────────────────
            case 'chalk': {
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size;
                brush.color = colorWithOpacity;
                (brush as any).strokeDashArray = [2, 3];
                (brush as any).strokeLineCap = 'butt';
                break;
            }

            // ── Silk Ribbon ───────────────────────────────────────────────────────
            case 'ribbon': {
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size * 3;
                brush.color = colorWithOpacity;
                (brush as any).strokeLineCap = 'butt';
                (brush as any).strokeLineJoin = 'miter';
                break;
            }

            // ── Rainbow ───────────────────────────────────────────────────────────
            case 'rainbow': {
                // Cycle through hues using a time-based hue shift
                const hue = (Date.now() / 20) % 360;
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size;
                brush.color = `hsl(${hue}, 100%, 50%)`;
                break;
            }

            // ── Dotted ────────────────────────────────────────────────────────────
            case 'dotted': {
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size;
                brush.color = colorWithOpacity;
                (brush as any).strokeDashArray = [0.1, size * 1.5];
                (brush as any).strokeLineCap = 'round';
                break;
            }

            // ── Airbrush (soft, wide, faint) ──────────────────────────────────────
            case 'airbrush': {
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size * 2.5;
                brush.color = color + '22'; // Very faint
                (brush as any).shadow = new fabric.Shadow({
                    color: color,
                    blur: size * 3,
                    offsetX: 0,
                    offsetY: 0
                });
                break;
            }

            // ── Crayon ────────────────────────────────────────────────────────────
            case 'crayon': {
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size;
                brush.color = colorWithOpacity;
                (brush as any).strokeDashArray = [1, 1.5];
                (brush as any).strokeLineCap = 'round';
                break;
            }

            // ── Hatched ───────────────────────────────────────────────────────────
            case 'hatch': {
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size;
                brush.color = colorWithOpacity;
                (brush as any).strokeDashArray = [6, 4];
                (brush as any).strokeLineCap = 'butt';
                break;
            }

            // ── Pencil (default) ──────────────────────────────────────────────────
            case 'pen':
            default: {
                brush = new fabric.PencilBrush(this.canvas);
                brush.width = size;
                brush.color = colorWithOpacity;
                brush.decimate = this.brushSmoothing();
                break;
            }
        }

        this.canvas.freeDrawingBrush = brush;
    }

    /**
     * Custom Circle Brush – draws filled circles along the drawn path.
     * Fabric v7 compatible (no CircleBrush class needed).
     */
    private createCircleBrush(size: number, color: string): fabric.PencilBrush {
        const brush = new fabric.PencilBrush(this.canvas);
        brush.width = size;
        brush.color = color;
        // Override _drawSegment to draw circles instead of lines
        (brush as any)._drawSegment = (ctx: CanvasRenderingContext2D, p1: any, p2: any) => {
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            ctx.save();
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(midX, midY, size / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };
        return brush;
    }

    /**
     * Custom Spray Brush – scatters random dots around the pointer.
     * Fabric v7 compatible (no SprayBrush class needed).
     */
    private createSprayBrush(size: number, color: string): fabric.PencilBrush {
        const brush = new fabric.PencilBrush(this.canvas);
        brush.width = 1;
        brush.color = 'transparent'; // The real drawing is done in onMouseMove

        const density = 40;
        const dotRadius = Math.max(1, size / 8);
        const sprayRadius = size * 1.5;
        const canvasEl = this.canvas.getElement() as HTMLCanvasElement;
        const ctx = canvasEl.getContext('2d');

        // Override onMouseMove to spray dots
        (brush as any)._onMouseMove = (pointer: any) => {
            if (!ctx) return;
            ctx.save();
            ctx.fillStyle = color;
            for (let i = 0; i < density; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * sprayRadius;
                const x = pointer.x + Math.cos(angle) * radius;
                const y = pointer.y + Math.sin(angle) * radius;
                ctx.beginPath();
                ctx.arc(x, y, dotRadius * Math.random(), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        };
        return brush;
    }

    /**
     * Pattern Brush – stamps a shape/emoji along the drawn path.
     * Uses PencilBrush with a custom canvas source for Fabric v7 compatibility.
     */
    private createPatternBrush(shape: string): fabric.PencilBrush {
        const size = Math.max(24, this.brushSize() * 2.5);
        const color = this.brushColor();

        // Build the stamp canvas
        const stampCanvas = document.createElement('canvas');
        stampCanvas.width = size;
        stampCanvas.height = size;
        const ctx = stampCanvas.getContext('2d')!;

        const emojiMap: Record<string, string> = {
            heart: '❤',
            bubble: '○',
            diamond: '♦',
            leaf: '🍃',
            sparkle: '✨',
            flower: '🌸',
            star: '★'
        };
        const emoji = emojiMap[shape] ?? '★';

        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = color;
        ctx.font = `${size * 0.75}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, size / 2, size / 2);

        // Try native PatternBrush first, fall back to PencilBrush with image stamp
        const fabricAny = fabric as any;
        if (typeof fabricAny.PatternBrush === 'function') {
            const brush = new fabricAny.PatternBrush(this.canvas);
            brush.source = stampCanvas;
            brush.width = size;
            return brush as fabric.PencilBrush;
        }

        // Fallback: use PencilBrush and stamp the emoji at each segment
        const brush = new fabric.PencilBrush(this.canvas);
        brush.width = size;
        brush.color = 'transparent';
        const img = new Image();
        img.src = stampCanvas.toDataURL();
        (brush as any)._drawSegment = (ctx2: CanvasRenderingContext2D, p1: any, p2: any) => {
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            ctx2.drawImage(img, midX - size / 2, midY - size / 2, size, size);
        };
        return brush;
    }

    public updateBrushSize(size: number): void {
        this.brushSize.set(size);
        if ((this.isDrawingMode() || this.isErasing()) && this.canvas.freeDrawingBrush) {
            const type = this.brushType();
            // These brush types need full recreation when size changes
            if (['pattern', 'spray', 'circle', 'ribbon', 'glow', 'airbrush'].includes(type) && !this.isErasing()) {
                this.setBrushType(type);
            } else {
                this.canvas.freeDrawingBrush.width = Number(size);
            }
        }
    }

    public updateBrushColor(color: string): void {
        this.brushColor.set(color);
        if (this.isDrawingMode() && this.canvas.freeDrawingBrush && !this.isErasing()) {
            // These brush types need full recreation when color changes
            const type = this.brushType();
            if (['pattern', 'glow', 'marker', 'spray', 'circle', 'airbrush'].includes(type)) {
                this.setBrushType(type);
            } else {
                const opacityHex = Math.round(this.brushOpacity() * 255).toString(16).padStart(2, '0');
                this.canvas.freeDrawingBrush.color = color + opacityHex;
            }
        }
    }

    /**
     * Toggle eraser mode. Uses destination-out composite operation for true erasing.
     * The erased path is added to the canvas with globalCompositeOperation = 'destination-out'.
     */
    public toggleEraser(enabled?: boolean): void {
        const currentlyErasing = enabled !== undefined ? enabled : !this.isErasing();

        if (currentlyErasing) {
            // Exit other modes
            this.isDrawingMode.set(false);
            this.isPenCutting.set(false);
            this.canvas.discardActiveObject();

            // Disable selection while erasing
            this.canvas.selection = false;
            this.canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });

            this.canvas.isDrawingMode = true;

            // White brush simulates erasing on white canvas; for true transparency use destination-out
            const eraser = new fabric.PencilBrush(this.canvas);
            eraser.width = this.eraserSize();
            eraser.color = '#ffffff'; // White eraser (works on white backgrounds)
            // For transparent erasing, set composite op on the created path via path:created event
            this.canvas.freeDrawingBrush = eraser;

            this.canvas.defaultCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${this.eraserSize()}' height='${this.eraserSize()}' viewBox='0 0 ${this.eraserSize()} ${this.eraserSize()}'%3E%3Ccircle cx='${this.eraserSize() / 2}' cy='${this.eraserSize() / 2}' r='${this.eraserSize() / 2 - 1}' fill='none' stroke='%23333' stroke-width='1.5'/%3E%3C/svg%3E") ${this.eraserSize() / 2} ${this.eraserSize() / 2}, crosshair`;
        } else {
            this.canvas.isDrawingMode = false;
            this.canvas.defaultCursor = 'default';
            // Restore selection
            this.canvas.selection = true;
            this.canvas.getObjects().forEach(o => { o.selectable = true; o.evented = true; });
        }

        this.isErasing.set(currentlyErasing);
        this.canvas.renderAll();
    }

    public updateEraserSize(size: number): void {
        this.eraserSize.set(size);
        if (this.isErasing() && this.canvas.freeDrawingBrush) {
            this.canvas.freeDrawingBrush.width = size;
            // Update cursor size
            this.canvas.defaultCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'%3E%3Ccircle cx='${size / 2}' cy='${size / 2}' r='${size / 2 - 1}' fill='none' stroke='%23333' stroke-width='1.5'/%3E%3C/svg%3E") ${size / 2} ${size / 2}, crosshair`;
        }
    }

    /**
     * Clear all drawn paths from the canvas (paths created by free drawing).
     * Preserves images, text, and shapes.
     */
    public clearDrawings(): void {
        const objects = this.canvas.getObjects();
        const drawingPaths = objects.filter(o => o.type === 'path');
        drawingPaths.forEach(p => this.canvas.remove(p));
        this.canvas.requestRenderAll();
        this.saveState();
        this.notificationService.showToast('Drawing cleared', 'info', 1500);
    }

    private setupKeyboardEvents(): void {
        window.addEventListener('keydown', (e) => {
            // Ignore if input/textarea is focused
            if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.redo();
                } else {
                    this.undo();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                this.redo();
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
            if (this.isPenCutting()) {
                this.handlePenCutPath(e.path);
                return;
            }
            if (this.isErasing()) {
                e.path.set({ globalCompositeOperation: 'destination-out' });
                this.canvas.requestRenderAll();
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
            this.debouncedRefresh();
            this.triggerSelectedUpdate();
        };

        this.canvas.on('object:modified', () => {
            updateUI();
            if (!this.isHistoryLoading) this.saveState();
        });

        this.canvas.on('object:moving', () => {
            this.debouncedRefresh();
            this.triggerSelectedUpdate();
        });


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
            this.debouncedRefresh();
            this.triggerSelectedUpdate();
        });

        this.canvas.on('object:rotating', () => {
            this.debouncedRefresh();
            this.triggerSelectedUpdate();
        });

        const handleSelection = (e: any) => {
            const selected = e.selected?.[0] || null;
            this.selectedObject.set(selected);
            this.refreshState();

            if (selected) {

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
                    obj.selectionStart = newCursor;
                    obj.selectionEnd = newCursor;

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

    /** Sync the canUndo/canRedo signals with current history pointer */
    private updateHistorySignals(): void {
        this.canUndo.set(this.historyStep > 0);
        this.canRedo.set(this.historyStep < this.history.length - 1);
    }

    // private saveState(): void { // Old implementation removed for autosave version }

    async undo(): Promise<void> {
        if (!this.canUndo() || this.isHistoryLoading) return;

        this.debouncedSave.cancel();
        clearTimeout(this.timeoutId);
        this.isHistoryLoading = true;

        try {
            this.historyStep--;
            const stateJson = this.history[this.historyStep];

            if (stateJson) {
                let state = JSON.parse(stateJson);
                state = this.strictSanitize(state);

                this.canvas.discardActiveObject();

                // Restore canvas dimensions
                if (state.width && state.height) {
                    this.canvas.setDimensions({ width: state.width, height: state.height });
                    this.canvas.requestRenderAll();
                }

                // Restore IDB references
                await this.restoreImagesFromStorage(state);

                // For smoother transition, only clear if absolutely necessary, 
                // but loadFromJSON usually handles replacement well.
                await this.canvas.loadFromJSON(state);


                this.refreshState();
                this.canvas.requestRenderAll();
                this.selectedObject.set(null);

                this.notificationService.showToast('Undo Applied', 'info', 1000);
            }
        } catch (err) {
            console.error('Undo failed', err);
            this.historyStep++; // Revert
            this.notificationService.error('Undo failed');
        } finally {
            this.isHistoryLoading = false;
            this.updateHistorySignals();
        }
    }

    async redo(): Promise<void> {
        if (!this.canRedo() || this.isHistoryLoading) return;

        this.debouncedSave.cancel();
        clearTimeout(this.timeoutId);
        this.isHistoryLoading = true;

        try {
            this.historyStep++;
            const stateJson = this.history[this.historyStep];

            if (stateJson) {
                let state = JSON.parse(stateJson);
                state = this.strictSanitize(state);

                this.canvas.discardActiveObject();

                // Restore canvas dimensions
                if (state.width && state.height) {
                    this.canvas.setDimensions({ width: state.width, height: state.height });
                    this.canvas.requestRenderAll();
                }

                await this.restoreImagesFromStorage(state);

                await this.canvas.loadFromJSON(state);


                this.refreshState();
                this.canvas.requestRenderAll();
                this.selectedObject.set(null);

                this.notificationService.showToast('Redo Applied', 'info', 1000);
            }
        } catch (err) {
            console.error('Redo failed', err);
            this.historyStep--; // Revert
            this.notificationService.error('Redo failed');
        } finally {
            this.isHistoryLoading = false;
            this.updateHistorySignals();
        }
    }

    // Safe Canvas Clearing helper
    private safeClear() {
        this.canvas.discardActiveObject();
        this.canvas.getObjects().forEach(o => this.canvas.remove(o));
        this.canvas.clear();
        this.canvas.backgroundColor = '#ffffff';
        this.canvas.renderAll();
    }

    /**
     * Start a completely fresh design/template
     */
    public createNewDesign() {
        this.safeClear();
        this.activeTemplateId.set(null);
        this.activeProjectId.set(null);
        this.history = [];
        this.historyStep = -1;
        this.updateHistorySignals();
        this.setInitialGradient();
        this.notificationService.showToast('New Canvas Ready', 'info', 2000);
    }


    resizeCanvas(width: number, height: number): void {
        this.canvas.setDimensions({ width, height });
        this.canvas.requestRenderAll();
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
        this.canvas.requestRenderAll();
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
                // Explicitly set crossOrigin to support filters on this object
                img.set({ crossOrigin: 'anonymous' });

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
            await Promise.all(json.objects.map((obj: any) => this.offloadObjectImage(obj)));
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
            if (obj.src !== undefined || obj.type === 'image') obj.src = `indexeddb://${obj.idbId}`;
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
            await Promise.all(obj.objects.map((child: any) => this.offloadObjectImage(child)));
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
                let blob: Blob | null = null;

                try {
                    const corsResponse = await fetch(url);
                    if (!corsResponse.ok) throw new Error('Fetch failed');
                    blob = await corsResponse.blob();
                } catch (corsErr) {
                    console.warn('[offloadUrl] Standard fetch failed for:', url);
                    // CRITICAL FIX: For blob URLs, attempt canvas-capture fallback
                    // Look for a canvas object using this URL and capture it
                    if (url.startsWith('blob:')) {
                        blob = await this.captureImageBlobFromCanvas(url);
                    }
                    if (!blob && url.startsWith('http')) return url;
                    if (!blob) {
                        console.error('[offloadUrl] All capture methods failed for blob URL');
                        return url; // Keep original to prevent data loss
                    }
                }

                if (blob) {
                    const id = await this.imageStorage.saveImage(blob);
                    await this.persistenceService.saveImage(id, blob);
                    console.log(`[offloadUrl] Offloaded URL to IDB:`, id);
                    return `indexeddb://${id}`;
                }
                return url;
            } catch (e) {
                console.error('[offloadUrl] Failed to offload URL', url, e);
                return url; // Keep original to prevent data loss
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
    async saveTemplate(name: string, category: string = 'Template', forceNew: boolean = false): Promise<boolean> {
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
        // OPTIMIZATION: Reduced multiplier and quality for "infinite" storage support
        const thumbnail = this.canvas.toDataURL({
            format: 'jpeg',
            multiplier: 0.15,
            quality: 0.7,
            enableRetinaScaling: false
        });

        // 4. Persistence Architecture: Shadow Storage
        // We store the heavy JSON in a dedicated record (designs store) 
        // and keep only metadata in the listing.
        const allSaved = await this.imageStorage.getTemplates();
        const activeId = this.activeTemplateId();

        // LOGIC: If forceNew is true, we ALWAYS create a new entry.
        // Otherwise, we try to update ONLY if the activeId exists AND matches the current intention.
        const existingIndex = forceNew ? -1 : allSaved.findIndex(t => t.id === activeId && t.isCustom);

        let updatedTemplates: Template[];
        let targetId: string;

        if (existingIndex !== -1 && activeId) {
            targetId = activeId;
            updatedTemplates = [...allSaved];
            updatedTemplates[existingIndex] = {
                ...updatedTemplates[existingIndex],
                name: name,
                json: null,
                thumbnail,
                category, // Update category if it changed
                date: new Date()
            };
            console.log(`[Library] Updating existing item: ${targetId} (${name})`);
        } else {
            // Force unique ID for new saves
            targetId = 'tpl_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            const newTemplate: Template = {
                id: targetId,
                name,
                category,
                json: null,
                thumbnail,
                isCustom: true,
                date: new Date()
            };
            updatedTemplates = [newTemplate, ...allSaved];
            console.log(`[Library] Creating NEW item: ${targetId} (${name})`);
        }

        // 5. Save the actual payload to the professional shadow store
        console.log(`[Save Template] Saving design data to shadow storage with ID: ${targetId}`);
        await this.persistenceService.saveDesign(targetId, json);
        console.log(`[Save Template] ✅ Shadow storage save complete for ID: ${targetId}`);

        // REMOVED destructive sanitization that was causing items to disappear if offload lagged
        // If an image stays as blob:, it's better than becoming "" (invisible)

        console.log(`[Library] Saving library with ${updatedTemplates.length} entries.`);
        if (await this.saveTemplatesToStorage(updatedTemplates)) {
            // Force immediate reload of all signals
            await this.initSavedTemplates();
            this.activeTemplateId.set(targetId);
            this.notificationService.success(`${category} "${name}" saved!`);
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
            console.log('🔄 Library Sync: Starting persistence initialization...');
            let local = await this.imageStorage.getTemplates();
            if (!Array.isArray(local)) local = [];

            // ── AUTO-SEED FROM DEPLOYED JSON ─────────────────────────────────
            // Fetch the bundled ready_made_templates.json from the server.
            // If it has entries that are NOT in IndexedDB yet → import them
            // (with their embedded base64 images) so they appear for every user.
            try {
                const response = await fetch('/ready_made_templates.json', { cache: 'default' });
                if (response.ok) {
                    const globals: any[] = await response.json();
                    if (Array.isArray(globals) && globals.length > 0) {
                        const localIds = new Set(local.map((t: any) => t.id));
                        const newGlobals = globals.filter(t => t && t.id && !localIds.has(t.id));

                        if (newGlobals.length > 0) {
                            console.log(`🌐 Seeding ${newGlobals.length} global templates into IndexedDB...`);
                            // Resolve embedded base64 images → IndexedDB blobs
                            for (const tpl of newGlobals) {
                                if (tpl.json) {
                                    await this.seedImagesFromJson(tpl.json);
                                }
                                tpl.isCustom = false;
                                tpl.seeded = true;
                            }
                            // Merge and persist
                            const merged = [...local, ...newGlobals];
                            await this.imageStorage.saveTemplates(merged);
                            local = merged;
                            console.log(`✅ Seeded ${newGlobals.length} global items into local DB.`);
                        }
                    }
                }
            } catch (err) {
                console.warn('[Library] Could not fetch global templates:', err);
            }

            let allItems: Template[] = [...local];

            // Unified filter and sort
            allItems = allItems.filter(t => t && t.id);
            allItems.sort((a, b) => {
                const dateB = b.date ? new Date(b.date).getTime() : 0;
                const dateA = a.date ? new Date(a.date).getTime() : 0;
                return dateB - dateA;
            });

            // Distribute to signals with broad filters
            this.savedTemplates.set(allItems.filter(t =>
                !t.category || ['Template', 'Custom', 'Imported'].includes(t.category) || (t as any).seeded
            ));
            this.savedDesigns.set(allItems.filter(t => t.category === 'Design'));
            this.savedBackgrounds.set(allItems.filter(t => t.category === 'Background'));

            console.log(`✅ Library Sync Complete: Total: ${allItems.length}`);
        } catch (e) {
            console.error('❌ Library failure', e);
        }
    }

    /**
     * Walk a canvas JSON and convert any embedded base64 data-URLs back into
     * IndexedDB blob references (indexeddb://hash).  Called when seeding globals.
     */
    private async seedImagesFromJson(json: any): Promise<void> {
        if (!json) return;

        const processObj = async (obj: any) => {
            if (!obj || typeof obj !== 'object') return;
            for (const key of ['src', 'originalSrc', 'originalImageSrc']) {
                const val = obj[key];
                if (typeof val === 'string' && val.startsWith('data:')) {
                    try {
                        const blob = this.dataURLtoBlob(val);
                        const id = await this.imageStorage.saveImage(blob);
                        await this.persistenceService.saveImage(id, blob);
                        obj[key] = `indexeddb://${id}`;
                        if (!obj.idbId) obj.idbId = id;
                    } catch { /* keep original */ }
                }
            }
            if (Array.isArray(obj.objects)) {
                await Promise.all(obj.objects.map((o: any) => processObj(o)));
            }
            if (obj.clipPath) await processObj(obj.clipPath);
        };

        if (Array.isArray(json.objects)) {
            await Promise.all(json.objects.map((o: any) => processObj(o)));
        }
        if (json.backgroundImage) await processObj(json.backgroundImage);
    }

    // ─── EXPORT / IMPORT LIBRARY ───────────────────────────────────────────────

    /**
     * Exports ALL templates, designs, and backgrounds from IndexedDB into a
     * self-contained JSON file where every image is embedded as base64.
     * The user can then commit this file to `public/ready_made_templates.json`
     * and redeploy → every new visitor will automatically see these items.
     */
    public async exportLibraryToJSON(): Promise<void> {
        if (this.isSaving()) return;
        this.isSaving.set(true);

        const toastId = this.notificationService.showToast('Preparing library export for Vercel…', 'info', 0);
        try {
            const local: any[] = await this.imageStorage.getTemplates();
            if (!local || local.length === 0) {
                this.notificationService.removeToast(toastId);
                this.notificationService.warning('No templates, designs, or backgrounds to export.');
                this.isSaving.set(false);
                return;
            }

            const output: any[] = [];

            for (const tpl of local) {
                // Fetch the full JSON from the shadow store
                let json: any = tpl.json;
                if (!json) {
                    try {
                        json = await this.persistenceService.getDesign(tpl.id);
                    } catch { json = null; }
                }

                // Embed base64 for all IDB images inside the canvas JSON
                if (json) {
                    json = JSON.parse(JSON.stringify(json)); // deep clone
                    await this.embedIdbImagesToBase64(json);
                }

                output.push({
                    id: tpl.id,
                    name: tpl.name,
                    category: tpl.category,
                    thumbnail: tpl.thumbnail ?? '',
                    isCustom: false,   // will be treated as global when re-imported
                    date: tpl.date ?? new Date(),
                    tags: tpl.tags ?? [],
                    json
                });
            }

            const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ready_made_templates.json';
            a.click();
            URL.revokeObjectURL(url);

            this.notificationService.removeToast(toastId);
            this.notificationService.success(
                `Exported ${output.length} item(s). Replace public/ready_made_templates.json and redeploy!`
            );
        } catch (e: any) {
            this.notificationService.removeToast(toastId);
            console.error('Export failed', e);
            this.notificationService.error('Export failed: ' + e.message);
        } finally {
            this.isSaving.set(false);
        }
    }

    private async embedIdbImagesToBase64(json: any): Promise<void> {
        if (!json) return;

        const processObj = async (obj: any) => {
            if (!obj || typeof obj !== 'object') return;

            // 1. Direct Image Sources
            for (const key of ['src', 'originalSrc', 'originalImageSrc']) {
                const val = obj[key];
                if (typeof val === 'string' && val.startsWith('indexeddb://')) {
                    const id = val.replace('indexeddb://', '');
                    try {
                        const blob = await this.imageStorage.getImage(id);
                        if (blob) {
                            obj[key] = await this.imageStorage.blobToDataURL(blob);
                        }
                    } catch { /* keep original ref */ }
                }
            }

            // 2. Pattern Fills or Strokes
            for (const prop of ['fill', 'stroke']) {
                const val = obj[prop];
                if (val && typeof val === 'object' && val.type === 'pattern' && typeof val.source === 'string' && val.source.startsWith('indexeddb://')) {
                    const id = val.source.replace('indexeddb://', '');
                    try {
                        const blob = await this.imageStorage.getImage(id);
                        if (blob) {
                            val.source = await this.imageStorage.blobToDataURL(blob);
                        }
                    } catch { /* keep original */ }
                }
            }

            // 3. Child Objects (Groups)
            if (Array.isArray(obj.objects)) {
                await Promise.all(obj.objects.map((o: any) => processObj(o)));
            }

            // 4. ClipPath
            if (obj.clipPath) await processObj(obj.clipPath);
        };

        // Root level checks
        if (Array.isArray(json.objects)) {
            await Promise.all(json.objects.map((o: any) => processObj(o)));
        }
        if (json.backgroundImage) await processObj(json.backgroundImage);
        if (json.overlayImage) await processObj(json.overlayImage);
        if (json.background && typeof json.background === 'object') {
            await processObj(json.background);
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

            if (!this.rbFunctionCache) {
                this.bgRemovalStatus.set('Initializing AI engine...');
                const imglyModule = await import('@imgly/background-removal');
                this.rbFunctionCache = imglyModule.removeBackground || (imglyModule as any).default?.removeBackground || (imglyModule as any).default;
            }
            const rbFunction = this.rbFunctionCache;

            if (typeof rbFunction !== 'function') {
                throw new Error('Background removal function not found in loaded module.');
            }

            const config: any = {
                progress: (key: string, current: number, total: number) => {
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
                model: 'isnet_fp16',
                output: {
                    format: 'image/png',
                    quality: 0.8
                },
                proxyToWorker: false
            };

            const resultBlob = await rbFunction(originalSrc || imgElement, config);
            const resultUrl = URL.createObjectURL(resultBlob);
            const imgObj = new Image();
            imgObj.src = resultUrl;

            imgObj.onload = async () => {
                const newImg = new fabric.Image(imgObj);

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

    // --- PEN CUT (MANUAL BG REMOVAL) ---

    private penCutPaths: fabric.Path[] = [];

    public startPenCut(): void {
        const activeObject = this.canvas.getActiveObject();
        if (!activeObject || activeObject.type !== 'image') {
            this.notificationService.warning('Please select an image first');
            return;
        }

        // Clean up any old paths before starting (Safe removal pattern)
        this.clearAllPenPaths();
        this.penCutPaths = [];

        this.penCutTarget = activeObject as fabric.Image;
        this.isPenCutting.set(true);

        // De-select and lock the image so user doesn't move it while cutting
        this.canvas.discardActiveObject();
        this.penCutTarget.set({
            selectable: false,
            evented: false,
            lockMovementX: true,
            lockMovementY: true
        });

        // Setup specialized brush for high-precision
        this.canvas.isDrawingMode = true;
        const brush = new fabric.PencilBrush(this.canvas);
        brush.width = 2 / (this.canvas.getZoom() || 1);
        brush.color = '#7c3aed';
        brush.decimate = 0.05; // High precision
        brush.strokeLineCap = 'round';
        brush.strokeLineJoin = 'round';

        brush.shadow = new fabric.Shadow({
            color: 'rgba(255,255,255,0.9)',
            blur: 3 / (this.canvas.getZoom() || 1),
            offsetX: 0,
            offsetY: 0
        });

        this.canvas.freeDrawingBrush = brush;
        this.canvas.defaultCursor = 'crosshair';
        this.canvas.renderAll();

        this.notificationService.showToast('Trace around the object. You can draw multiple shapes.', 'info', 4000);
    }

    private handlePenCutPath(path: fabric.Path): void {
        if (!this.penCutTarget) {
            this.canvas.remove(path);
            return;
        }

        // Tag this path so we can find it later for removal
        (path as any).isPenCutPath = true;

        // 1. Auto-close the path for clipping purposes
        if (path.path && path.path.length > 0) {
            const pathData = path.path as any[];
            const lastMove = pathData[pathData.length - 1];
            if (lastMove && lastMove[0] !== 'Z') {
                pathData.push(['Z']);
            }
        }

        this.penCutPaths.push(path);
        this.currentPenPath = path;

        // 2. Configure path for Visual Trace
        path.set({
            fill: 'rgba(124, 58, 237, 0.2)', // Semi-transparent for better visualization
            stroke: '#7c3aed',
            strokeWidth: 2 / (this.canvas.getZoom() || 1),
            absolutePositioned: true,
            selectable: false,
            evented: false,
            visible: true,
            opacity: 0.8
        });

        // 3. Real-time Preview: Update target's clipPath
        this.updatePenCutPreview();
    }

    private async updatePenCutPreview(): Promise<void> {
        if (!this.penCutTarget || this.penCutPaths.length === 0) return;

        // Clone all paths for a combined preview mask
        const clones = await Promise.all(this.penCutPaths.map(p => p.clone()));

        const maskGroup = clones.length > 1
            ? new fabric.Group(clones, { absolutePositioned: true, visible: false })
            : clones[0];

        (maskGroup as any).set({ absolutePositioned: true, visible: false });

        if (this.penCutTarget) {
            this.penCutTarget.set({
                clipPath: maskGroup,
                dirty: true
            });
            this.canvas.requestRenderAll();
        }
    }

    public async finishPenCut(): Promise<void> {
        if (!this.penCutTarget || this.penCutPaths.length === 0) {
            this.cancelPenCut();
            return;
        }

        const img = this.penCutTarget;

        try {
            // 1. Create a permanent ClipPath (Local coordinates)
            const clips = await Promise.all(this.penCutPaths.map(async (rawPath) => {
                const finalPath = await rawPath.clone() as fabric.Path;

                // Translate world to local
                const worldCenter = rawPath.getCenterPoint();
                const invMatrix = fabric.util.invertTransform(img.calcTransformMatrix());
                const localPoint = fabric.util.transformPoint(worldCenter, invMatrix);

                finalPath.set({
                    absolutePositioned: false,
                    originX: 'center',
                    originY: 'center',
                    left: localPoint.x,
                    top: localPoint.y,
                    angle: (rawPath.angle || 0) - (img.angle || 0),
                    scaleX: (rawPath.scaleX || 1) / (img.scaleX || 1),
                    scaleY: (rawPath.scaleY || 1) / (img.scaleY || 1),
                    fill: 'white',
                    stroke: 'transparent'
                });
                return finalPath;
            }));

            const finalClip = clips.length > 1
                ? new fabric.Group(clips, { absolutePositioned: false, fill: 'white' })
                : clips[0];

            img.set({
                clipPath: finalClip,
                selectable: true,
                evented: true,
                lockMovementX: false,
                lockMovementY: false,
                perPixelTargetFind: false, // Fix selection difficulty: Use bounding box
                isBgRemoved: true, // Enable 'Restore' button
                dirty: true
            });

            // 2. PRESERVE THE SKETCH (Requested functionality)
            this.penCutPaths.forEach(path => {
                (path as any).isPenCutPath = false; // Prevents removal in reset
                path.set({
                    name: 'Pen Cut Trace',
                    selectable: true,
                    evented: true,
                    opacity: 1,
                    strokeDashArray: [5, 5],
                    fill: 'transparent'
                });
            });

            img.setCoords();
            this.canvas.setActiveObject(img);
            this.canvas.renderAll();

            this.notificationService.success('Cut finished. Trace kept as Layer.');
            this.saveState();
        } catch (err) {
            console.error('[PenCut] Finish failed:', err);
            this.notificationService.error('Could not apply cut');
        } finally {
            this.resetPenCutState(false); // Don't remove if they was just finished
        }
    }

    public cancelPenCut(): void {
        if (this.penCutTarget) {
            this.penCutTarget.set({
                clipPath: undefined,
                selectable: true,
                evented: true,
                lockMovementX: false,
                lockMovementY: false
            });
            this.canvas.setActiveObject(this.penCutTarget);
        }

        this.resetPenCutState(true); // Remove paths on cancel
    }

    private resetPenCutState(removePaths: boolean = true): void {
        this.isPenCutting.set(false);
        this.penCutTarget = null;
        this.currentPenPath = null;
        this.canvas.isDrawingMode = false;

        if (removePaths) {
            this.clearAllPenPaths();
        }

        this.penCutPaths = [];
        this.canvas.defaultCursor = 'default';
        this.canvas.renderAll();
    }

    public undoLastPenPath(): void {
        const last = this.penCutPaths.pop();
        if (last) {
            this.canvas.remove(last);
            this.updatePenCutPreview();
            this.canvas.renderAll();
        }
    }

    public clearAllPenPaths(): void {
        const tracePaths = this.canvas.getObjects().filter(obj => (obj as any).isPenCutPath);
        tracePaths.forEach(p => this.canvas.remove(p));
        this.penCutPaths = [];
        this.updatePenCutPreview();
        this.canvas.renderAll();
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
                    clipPath: undefined,
                    isBgRemoved: false,
                    idbId: rawOriginalSrc.startsWith('indexeddb://') ? rawOriginalSrc.replace('indexeddb://', '') : (currentImg as any).idbId,
                    originalSrc: rawOriginalSrc
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
                this.autoSaveProject(); // Update autosave without polluting history
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
            await Promise.all(json.objects.map((obj: any) => this.restoreObjectImage(obj)));
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
                if (obj.src !== undefined || obj.type === 'image') obj.src = restored;
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
            await Promise.all(obj.objects.map((child: any) => this.restoreObjectImage(child)));
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

    /**
     * Canvas-capture fallback: When a blob URL can't be fetched (revoked/dead),
     * find the corresponding canvas image element and draw it to get the data.
     */
    private async captureImageBlobFromCanvas(blobUrl: string): Promise<Blob | null> {
        try {
            const objs = this.canvas.getObjects();
            for (const obj of objs) {
                if (obj.type === 'image') {
                    const imgObj = obj as fabric.Image;
                    const element = (imgObj as any)._element || (imgObj as any).getElement?.();
                    if (element && (element.src === blobUrl || (imgObj as any).src === blobUrl)) {
                        // Found the image on canvas, capture its pixels
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = element.naturalWidth || element.width || 300;
                        tempCanvas.height = element.naturalHeight || element.height || 300;
                        const ctx = tempCanvas.getContext('2d');
                        if (ctx) {
                            ctx.drawImage(element, 0, 0);
                            return new Promise<Blob | null>((resolve) => {
                                tempCanvas.toBlob((blob) => {
                                    resolve(blob);
                                }, 'image/png');
                            });
                        }
                    }
                }
            }
            return null;
        } catch (e) {
            console.error('[captureImageBlobFromCanvas] Failed:', e);
            return null;
        }
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
        const currentZoom = this.canvas.getZoom();
        const currentWidth = this.canvas.width;
        const currentHeight = this.canvas.height;

        // Temporarily reset to full base design size for high-res export
        this.canvas.setDimensions({ width: 1200, height: 675 });
        this.canvas.setZoom(1);

        const dataURL = this.canvas.toDataURL({
            format,
            multiplier: 2, // Gives 2400x1350px image
            quality: 1.0,
            enableRetinaScaling: true
        });

        // Restore user's view state (mobile-fit or zoom)
        this.canvas.setDimensions({ width: currentWidth!, height: currentHeight! });
        this.canvas.setZoom(currentZoom);
        this.canvas.requestRenderAll();

        const link = document.createElement('a');
        link.download = `designhub-${Date.now()}.${format}`;
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
    // CRITICAL FIX: Reuse the already-stable history state (which has indexeddb:// refs)
    // instead of re-serializing from canvas (which has live blob: URLs that can fail to offload).
    private async autoSaveProject(): Promise<void> {
        try {
            // Use the latest history entry which already has stable indexeddb:// refs
            // thanks to forceStableRefs() in saveState()
            let stableJson: string | null = null;

            if (this.history.length > 0 && this.historyStep >= 0 && this.historyStep < this.history.length) {
                stableJson = this.history[this.historyStep];
            }

            if (stableJson) {
                // The history entry already has indexeddb:// refs.
                // We parse it, run processImagesForStorage to ensure any remaining
                // non-indexeddb refs are offloaded, then save.
                const jsonObj = JSON.parse(stableJson);
                await this.processImagesForStorage(jsonObj);
                await this.imageStorage.saveAutosave(JSON.stringify(jsonObj));
            } else {
                // Fallback: serialize from canvas and process
                const json = this.canvas.toObject(this.SERIALIZE_PROPS);

                // Add dimensions for accurate fallback
                (json as any).width = this.canvas.width;
                (json as any).height = this.canvas.height;

                this.forceStableRefs(json);
                await this.processImagesForStorage(json);
                await this.imageStorage.saveAutosave(JSON.stringify(json));
            }
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
                this.updateHistorySignals();
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
            this.updateHistorySignals();
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

        // CRITICAL: Save canvas dimensions in history state
        (obj as any).width = this.canvas.width;
        (obj as any).height = this.canvas.height;

        this.forceStableRefs(obj);
        const json = JSON.stringify(obj);

        // Prevent duplicate states
        if (this.history.length > 0 && this.historyStep >= 0) {
            const currentState = this.history[this.historyStep];
            if (currentState === json) return; // No change
        }

        // Branching history
        if (this.historyStep < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyStep + 1);
        }

        this.history.push(json);

        // Limit history size
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
        } else {
            this.historyStep++;
        }

        // Fix step pointer if we shifted
        this.historyStep = Math.min(this.historyStep, this.history.length - 1);

        // Update UI signals
        this.updateHistorySignals();

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
            // Handle originalSrc: Only override if it's a dead blob/http URL.
            // If originalSrc already points to a different IDB entry (e.g. for bg-removed images),
            // respect it — don't overwrite with the current idbId.
            if (obj.originalSrc && typeof obj.originalSrc === 'string') {
                if (obj.originalSrc.startsWith('blob:') || obj.originalSrc.startsWith('http')) {
                    // Only use idbId as fallback if there's no separate originalSrc IDB ref
                    obj.originalSrc = `indexeddb://${obj.idbId}`;
                }
                // If already indexeddb://, leave it as-is (it may point to the original pre-bg-removal image)
            }
            // Same for originalImageSrc
            if (obj.originalImageSrc && typeof obj.originalImageSrc === 'string') {
                if (obj.originalImageSrc.startsWith('blob:') || obj.originalImageSrc.startsWith('http')) {
                    obj.originalImageSrc = `indexeddb://${obj.idbId}`;
                }
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

        const rawJson = this.canvas.toObject(this.SERIALIZE_PROPS);
        // CRITICAL FIX: Deep-clone before processing to avoid mutating live canvas objects
        const json = JSON.parse(JSON.stringify(rawJson));
        // Force stable indexeddb:// refs before offloading
        this.forceStableRefs(json);
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
            const existingIndex = current.findIndex(p => p.id === activeId);

            if (existingIndex !== -1) {
                targetId = activeId;
                // Safe Update
                // We create a new array and a new object for the updated project
                updated = [...current];
                updated[existingIndex] = {
                    ...updated[existingIndex],
                    name: name || updated[existingIndex].name,
                    json: '', // Shadow storage
                    thumbnail,
                    date: Date.now()
                };
            } else {
                // If activeId not found (rare), treat as new
                targetId = Date.now().toString();
                const newProject: SavedProject = {
                    id: targetId,
                    name,
                    json: '',
                    thumbnail,
                    date: Date.now()
                };
                updated = [newProject, ...current];
                this.activeProjectId.set(targetId);
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
                this.updateHistorySignals();

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



    /**
     * Helper for the user to export their currently saved templates from IndexedDB
     * so they can be committed to the repository and used as Global Templates.
     */
    public async exportAllTemplatesToJSON(): Promise<void> {
        const templates = await this.imageStorage.getTemplates();
        const exportData = [];

        for (const t of templates) {
            // Fetch deep payload from shadow storage
            const designData = await this.persistenceService.getDesign(t.id);
            exportData.push({
                ...t,
                json: designData || t.json // Ensure the full Fabric.js JSON is included
            });
        }

        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = 'ready_made_templates.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        this.notificationService.success('Templates exported! Save this file as "public/ready_made_templates.json" to include it in deployment.');
    }
}
    