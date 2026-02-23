/**
 * ImageEditor.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-ready Canva-style image editor with:
 *  • Non-destructive CSS filter adjustments (brightness, contrast, saturation, blur)
 *  • Manual crop via react-easy-crop (user-initiated, no auto-crop/auto-resize)
 *  • Preserved adjustments after crop (filters re-apply to cropped image)
 *  • Export: bakes filters + crop together onto canvas and downloads
 *  • Undo history for adjustments + crop
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
    useState,
    useCallback,
    useMemo,
    useRef,
    useEffect,
} from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import AdjustmentSlider from './AdjustmentSlider';
import { getCroppedImg, exportWithFilters } from '../utils/cropUtils';
import styles from './ImageEditor.module.css';

// ── Types ────────────────────────────────────────────────────────────────────
export interface Adjustments {
    brightness: number; // 0–200  (100 = normal)
    contrast: number; // 0–200  (100 = normal)
    saturation: number; // 0–200  (100 = normal)
    blur: number; // 0–20   (0  = none; in px)
    grayscale: number; // 0-100
    sepia: number; // 0-100
    invert: number; // 0-100
    hueRotate: number; // 0-360
    opacity: number; // 0-100 (100 = opaque)
}

const DEFAULT_ADJUSTMENTS: Adjustments = {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    blur: 0,
    grayscale: 0,
    sepia: 0,
    invert: 0,
    hueRotate: 0,
    opacity: 100,
};

const PRESETS: Record<string, Partial<Adjustments>> = {
    'None': {},
    'Grayscale': { grayscale: 100, saturation: 0 },
    'Sepia': { sepia: 100, brightness: 105, saturation: 80 },
    'Invert': { invert: 100 },
    'Vintage': { sepia: 80, contrast: 120, brightness: 90 },
    'Dramatic': { contrast: 160, saturation: 40, brightness: 110 },
    'Faded': { contrast: 80, saturation: 60, brightness: 110 },
    'Vibrant': { saturation: 160, contrast: 110 },
};

interface HistoryEntry {
    imageSrc: string;
    adjustments: Adjustments;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const buildFilterString = (adj: Adjustments): string => {
    const filters = [];
    if (adj.brightness !== 100) filters.push(`brightness(${adj.brightness}%)`);
    if (adj.contrast !== 100) filters.push(`contrast(${adj.contrast}%)`);
    if (adj.saturation !== 100) filters.push(`saturate(${adj.saturation}%)`);
    if (adj.blur !== 0) filters.push(`blur(${adj.blur}px)`);
    if (adj.grayscale !== 0) filters.push(`grayscale(${adj.grayscale}%)`);
    if (adj.sepia !== 0) filters.push(`sepia(${adj.sepia}%)`);
    if (adj.invert !== 0) filters.push(`invert(${adj.invert}%)`);
    if (adj.hueRotate !== 0) filters.push(`hue-rotate(${adj.hueRotate}deg)`);
    if (adj.opacity !== 100) filters.push(`opacity(${adj.opacity}%)`);

    return filters.join(' ') || 'none';
};

// ── Component ────────────────────────────────────────────────────────────────
const ImageEditor: React.FC = () => {
    // Image state
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [imageFilename, setImageFilename] = useState('image');
    const [imageInfo, setImageInfo] = useState<{ w: number; h: number } | null>(null);

    // Adjustment state
    const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);

    // History (undo stack)
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [historyIdx, setHistoryIdx] = useState(-1);

    // Crop state
    const [isCropping, setIsCropping] = useState(false);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
    const [lockAspect, setLockAspect] = useState(false);
    const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

    // UI state
    const [activeTab, setActiveTab] = useState<'adjust' | 'crop'>('adjust');
    const [isExporting, setIsExporting] = useState(false);
    const [isCropApplying, setIsCropApplying] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    // ── Derived ───────────────────────────────────────────────────────────────
    const filterString = useMemo(() => buildFilterString(adjustments), [adjustments]);

    const aspectRatio = useMemo(() => {
        if (!naturalSize) return undefined;
        return naturalSize.w / naturalSize.h;
    }, [naturalSize]);

    const canUndo = historyIdx > 0;
    const isAdjusted = JSON.stringify(adjustments) !== JSON.stringify(DEFAULT_ADJUSTMENTS);

    // ── History Management ────────────────────────────────────────────────────
    const pushHistory = useCallback((src: string, adj: Adjustments) => {
        setHistory(prev => {
            // Correctly truncate history if we're not at the last index
            const truncated = prev.slice(0, historyIdx + 1);
            return [...truncated, { imageSrc: src, adjustments: { ...adj } }].slice(-30);
        });
        setHistoryIdx(prev => Math.min(prev + 1, 29));
    }, [historyIdx]);

    const handleUndo = useCallback(() => {
        if (historyIdx <= 0) return;
        const entry = history[historyIdx - 1];
        setHistoryIdx(prev => prev - 1);
        setImageSrc(entry.imageSrc);
        setAdjustments(entry.adjustments);
    }, [history, historyIdx]);

    // ── Image Upload ──────────────────────────────────────────────────────────
    const loadFile = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) return;
        const name = file.name.replace(/\.[^/.]+$/, '');
        setImageFilename(name);
        const reader = new FileReader();
        reader.onload = (e) => {
            const src = e.target?.result as string;
            // Get natural dimensions
            const img = new Image();
            img.onload = () => {
                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                setImageInfo({ w: img.naturalWidth, h: img.naturalHeight });
            };
            img.src = src;

            setImageSrc(src);
            setAdjustments(DEFAULT_ADJUSTMENTS);
            setHistory([{ imageSrc: src, adjustments: DEFAULT_ADJUSTMENTS }]);
            setHistoryIdx(0);
            setIsCropping(false);
            setCrop({ x: 0, y: 0 });
            setZoom(1);
        };
        reader.readAsDataURL(file);
    }, []);

    const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) loadFile(file);
    }, [loadFile]);

    // ── Drag & Drop ───────────────────────────────────────────────────────────
    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) loadFile(file);
    }, [loadFile]);

    const onDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const onDragLeave = useCallback(() => setIsDragging(false), []);

    // ── Adjustments ───────────────────────────────────────────────────────────
    const updateAdjustment = useCallback(
        <K extends keyof Adjustments>(key: K, value: Adjustments[K]) => {
            setAdjustments(prev => ({ ...prev, [key]: value }));
        },
        []
    );

    const resetAdjustment = useCallback(
        (key: keyof Adjustments) => {
            if (!imageSrc) return;
            setAdjustments(prev => {
                const next = { ...prev, [key]: DEFAULT_ADJUSTMENTS[key] };
                pushHistory(imageSrc, next);
                return next;
            });
        },
        [imageSrc, pushHistory]
    );

    const resetAllAdjustments = useCallback(() => {
        if (!imageSrc) return;
        setAdjustments(DEFAULT_ADJUSTMENTS);
        pushHistory(imageSrc, DEFAULT_ADJUSTMENTS);
    }, [imageSrc, pushHistory]);

    const applyPreset = useCallback((presetName: string) => {
        if (!imageSrc) return;
        const presetValues = PRESETS[presetName];
        if (!presetValues) return;

        setAdjustments(prev => {
            const next = { ...DEFAULT_ADJUSTMENTS, ...presetValues };
            pushHistory(imageSrc, next);
            return next;
        });
    }, [imageSrc, pushHistory]);

    // Save adjustment snapshot to history when user stops sliding
    const saveAdjustmentSnapshot = useCallback(() => {
        if (!imageSrc) return;
        pushHistory(imageSrc, adjustments);
    }, [imageSrc, adjustments, pushHistory]);

    // ── Crop ──────────────────────────────────────────────────────────────────
    const onCropComplete = useCallback((_: Area, pixels: Area) => {
        setCroppedAreaPixels(pixels);
    }, []);

    const enterCropMode = useCallback(() => {
        if (!imageSrc) return;
        setIsCropping(true);
        setActiveTab('crop');
        setCrop({ x: 0, y: 0 });
        setZoom(1);
    }, [imageSrc]);

    const cancelCrop = useCallback(() => {
        setIsCropping(false);
    }, []);

    /**
     * Apply Crop:
     * 1. Extract cropped raw pixels (no filters baked in)
     * 2. Set the cropped data URL as new imageSrc
     * 3. Keep all CSS filter adjustments exactly as they were
     * 4. Save to history
     */
    const applyCrop = useCallback(async () => {
        if (!imageSrc || !croppedAreaPixels) return;

        // Guard: ensure meaningful crop size
        if (croppedAreaPixels.width < 10 || croppedAreaPixels.height < 10) {
            alert('Crop area too small. Please select a larger area.');
            return;
        }

        setIsCropApplying(true);
        try {
            const croppedSrc = await getCroppedImg(imageSrc, croppedAreaPixels);

            // Update natural size info for the new cropped image
            const img = new Image();
            img.onload = () => {
                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                setImageInfo({ w: img.naturalWidth, h: img.naturalHeight });
            };
            img.src = croppedSrc;

            setImageSrc(croppedSrc);
            setIsCropping(false);
            setCrop({ x: 0, y: 0 });
            setZoom(1);

            // Push to history — adjustments deliberately preserved
            pushHistory(croppedSrc, adjustments);
        } catch (err) {
            console.error('Crop failed:', err);
            alert('Crop failed. Please try again with a different image or region.');
        } finally {
            setIsCropApplying(false);
        }
    }, [imageSrc, croppedAreaPixels, adjustments, pushHistory]);

    // ── Export ────────────────────────────────────────────────────────────────
    const handleExport = useCallback(async () => {
        if (!imageSrc) return;
        setIsExporting(true);
        try {
            await exportWithFilters(imageSrc, filterString, `${imageFilename}-edited.png`);
        } catch (err) {
            console.error('Export failed:', err);
            alert('Export failed. Please try again.');
        } finally {
            setIsExporting(false);
        }
    }, [imageSrc, filterString, imageFilename]);

    // ── Keyboard Shortcuts ────────────────────────────────────────────────────
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                handleUndo();
            }
            if (e.key === 'Escape' && isCropping) {
                cancelCrop();
            }
            if (e.key === 'Enter' && isCropping && croppedAreaPixels) {
                applyCrop();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleUndo, isCropping, cancelCrop, applyCrop, croppedAreaPixels]);

    // ── Render: Upload Zone ───────────────────────────────────────────────────
    if (!imageSrc) {
        return (
            <div className={styles.appShell}>
                <header className={styles.header}>
                    <div className={styles.logo}>
                        <span className={styles.logoIcon}>✦</span>
                        <span>DesignHub</span>
                        <span className={styles.logoBadge}>Image Editor</span>
                    </div>
                </header>

                <div
                    className={`${styles.uploadZone} ${isDragging ? styles.dragging : ''}`}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload image"
                    onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                >
                    <div className={styles.uploadContent}>
                        <div className={styles.uploadIcon}>
                            {isDragging ? '📥' : '🖼️'}
                        </div>
                        <h2 className={styles.uploadTitle}>
                            {isDragging ? 'Drop it!' : 'Upload an Image'}
                        </h2>
                        <p className={styles.uploadSub}>
                            Drag & drop or click to choose a file
                        </p>
                        <p className={styles.uploadFormats}>PNG · JPEG · WebP · GIF · BMP</p>
                        <button
                            className={styles.uploadBtn}
                            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                        >
                            Choose File
                        </button>
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className={styles.hiddenInput}
                        onChange={onFileChange}
                        aria-hidden="true"
                    />
                </div>
            </div>
        );
    }

    // ── Render: Editor ────────────────────────────────────────────────────────
    return (
        <div className={styles.appShell}>
            {/* ── Header ── */}
            <header className={styles.header}>
                <div className={styles.logo}>
                    <span className={styles.logoIcon}>✦</span>
                    <span>DesignHub</span>
                    <span className={styles.logoBadge}>Image Editor</span>
                </div>

                <div className={styles.headerMeta}>
                    {imageInfo && (
                        <span className={styles.dimension}>
                            {imageInfo.w} × {imageInfo.h}px
                        </span>
                    )}
                </div>

                <div className={styles.headerActions}>
                    <button
                        className={styles.btnSecondary}
                        onClick={handleUndo}
                        disabled={!canUndo}
                        title="Undo (Ctrl+Z)"
                    >
                        ↩ Undo
                    </button>
                    <button
                        className={styles.btnSecondary}
                        onClick={() => { setImageSrc(null); setHistory([]); setHistoryIdx(-1); }}
                        title="Upload a new image"
                    >
                        ↑ New
                    </button>
                    <button
                        className={`${styles.btnPrimary} ${isExporting ? styles.loading : ''}`}
                        onClick={handleExport}
                        disabled={isExporting}
                    >
                        {isExporting ? '⏳ Exporting…' : '⬇ Export PNG'}
                    </button>
                </div>
            </header>

            {/* ── Main Layout ── */}
            <div className={styles.editorLayout}>

                {/* ── Sidebar ── */}
                <aside className={styles.sidebar}>
                    {/* Tab Switcher */}
                    <div className={styles.tabs}>
                        <button
                            className={`${styles.tab} ${activeTab === 'adjust' ? styles.tabActive : ''}`}
                            onClick={() => { setActiveTab('adjust'); if (isCropping) cancelCrop(); }}
                        >
                            🎨 Adjust
                        </button>
                        <button
                            className={`${styles.tab} ${activeTab === 'crop' ? styles.tabActive : ''}`}
                            onClick={() => { setActiveTab('crop'); if (!isCropping) enterCropMode(); }}
                        >
                            ✂️ Crop
                        </button>
                    </div>

                    {/* ── Adjust Panel ── */}
                    {activeTab === 'adjust' && (
                        <div className={styles.panel}>
                            <div className={styles.panelHeader}>
                                <span className={styles.panelTitle}>Adjustments</span>
                                {isAdjusted && (
                                    <button className={styles.resetAllBtn} onClick={resetAllAdjustments}>
                                        Reset All
                                    </button>
                                )}
                            </div>
                            <div className={styles.sliders}>
                                <AdjustmentSlider
                                    label="Brightness"
                                    icon="☀️"
                                    value={adjustments.brightness}
                                    min={0}
                                    max={200}
                                    defaultValue={100}
                                    unit="%"
                                    onChange={(v) => updateAdjustment('brightness', v)}
                                    onReset={() => resetAdjustment('brightness')}
                                />
                                <AdjustmentSlider
                                    label="Contrast"
                                    icon="◑"
                                    value={adjustments.contrast}
                                    min={0}
                                    max={200}
                                    defaultValue={100}
                                    unit="%"
                                    onChange={(v) => updateAdjustment('contrast', v)}
                                    onReset={() => resetAdjustment('contrast')}
                                />
                                <AdjustmentSlider
                                    label="Saturation"
                                    icon="🎨"
                                    value={adjustments.saturation}
                                    min={0}
                                    max={200}
                                    defaultValue={100}
                                    unit="%"
                                    onChange={(v) => updateAdjustment('saturation', v)}
                                    onReset={() => resetAdjustment('saturation')}
                                />
                                <AdjustmentSlider
                                    label="Blur"
                                    icon="💧"
                                    value={adjustments.blur}
                                    min={0}
                                    max={20}
                                    step={0.5}
                                    defaultValue={0}
                                    unit="px"
                                    onChange={(v) => updateAdjustment('blur', v)}
                                    onReset={() => resetAdjustment('blur')}
                                />
                                <AdjustmentSlider
                                    label="Opacity"
                                    icon="👻"
                                    value={adjustments.opacity}
                                    min={0}
                                    max={100}
                                    defaultValue={100}
                                    unit="%"
                                    onChange={(v) => updateAdjustment('opacity', v)}
                                    onReset={() => resetAdjustment('opacity')}
                                />
                                <AdjustmentSlider
                                    label="Hue"
                                    icon="🌈"
                                    value={adjustments.hueRotate}
                                    min={0}
                                    max={360}
                                    step={1}
                                    defaultValue={0}
                                    unit="°"
                                    onChange={(v) => updateAdjustment('hueRotate', v)}
                                    onReset={() => resetAdjustment('hueRotate')}
                                />
                                <AdjustmentSlider
                                    label="Grayscale"
                                    icon="🌑"
                                    value={adjustments.grayscale}
                                    min={0}
                                    max={100}
                                    defaultValue={0}
                                    unit="%"
                                    onChange={(v) => updateAdjustment('grayscale', v)}
                                    onReset={() => resetAdjustment('grayscale')}
                                />
                                <AdjustmentSlider
                                    label="Sepia"
                                    icon="📜"
                                    value={adjustments.sepia}
                                    min={0}
                                    max={100}
                                    defaultValue={0}
                                    unit="%"
                                    onChange={(v) => updateAdjustment('sepia', v)}
                                    onReset={() => resetAdjustment('sepia')}
                                />
                                <AdjustmentSlider
                                    label="Invert"
                                    icon="🔄"
                                    value={adjustments.invert}
                                    min={0}
                                    max={100}
                                    defaultValue={0}
                                    unit="%"
                                    onChange={(v) => updateAdjustment('invert', v)}
                                    onReset={() => resetAdjustment('invert')}
                                />
                            </div>

                            <div className={styles.sectionDivider} />

                            <div className={styles.panelHeader}>
                                <span className={styles.panelTitle}>Filter Presets</span>
                            </div>

                            <div className={styles.presetsGrid}>
                                {Object.keys(PRESETS).map(name => {
                                    const isActive = name === 'None'
                                        ? JSON.stringify(adjustments) === JSON.stringify(DEFAULT_ADJUSTMENTS)
                                        : Object.entries(PRESETS[name]).every(([k, v]) => adjustments[k as keyof Adjustments] === v);

                                    return (
                                        <button
                                            key={name}
                                            className={`${styles.filterCard} ${isActive ? styles.filterCardActive : ''}`}
                                            onClick={() => applyPreset(name)}
                                        >
                                            <div
                                                className={styles.filterCardPreview}
                                                style={{ filter: buildFilterString({ ...DEFAULT_ADJUSTMENTS, ...PRESETS[name] }) }}
                                            />
                                            <span className={styles.filterCardName}>{name}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className={styles.filterPreview}>
                                <span className={styles.filterLabel}>Active Filter</span>
                                <code className={styles.filterCode}>{filterString}</code>
                            </div>

                            {/* Save snapshot button */}
                            <button
                                className={styles.snapshotBtn}
                                onClick={saveAdjustmentSnapshot}
                                disabled={!isAdjusted}
                                title="Save current adjustments as a restore point"
                            >
                                📌 Save Restore Point
                            </button>
                        </div>
                    )}

                    {/* ── Crop Panel ── */}
                    {activeTab === 'crop' && (
                        <div className={styles.panel}>
                            <div className={styles.panelHeader}>
                                <span className={styles.panelTitle}>Crop</span>
                            </div>

                            <div className={styles.cropInfo}>
                                <p>Drag to position · Scroll to zoom · Press <kbd>Enter</kbd> to apply</p>
                            </div>

                            <div className={styles.cropOptions}>
                                <label className={styles.checkboxLabel}>
                                    <input
                                        type="checkbox"
                                        checked={lockAspect}
                                        onChange={(e) => setLockAspect(e.target.checked)}
                                    />
                                    <span>Lock aspect ratio</span>
                                </label>
                            </div>

                            <div className={styles.zoomControl}>
                                <span className={styles.zoomLabel}>Zoom</span>
                                <input
                                    type="range"
                                    min={1}
                                    max={3}
                                    step={0.01}
                                    value={zoom}
                                    onChange={(e) => setZoom(Number(e.target.value))}
                                    className={styles.zoomSlider}
                                    aria-label="Crop zoom"
                                />
                                <span className={styles.zoomValue}>{zoom.toFixed(2)}×</span>
                            </div>

                            {croppedAreaPixels && (
                                <div className={styles.cropSizeInfo}>
                                    <span className={styles.cropSizeLabel}>Selection</span>
                                    <span className={styles.cropSize}>
                                        {Math.round(croppedAreaPixels.width)} × {Math.round(croppedAreaPixels.height)}px
                                    </span>
                                </div>
                            )}

                            <div className={styles.cropActions}>
                                <button
                                    className={styles.btnSecondary}
                                    onClick={cancelCrop}
                                >
                                    Cancel
                                </button>
                                <button
                                    className={`${styles.btnPrimary} ${isCropApplying ? styles.loading : ''}`}
                                    onClick={applyCrop}
                                    disabled={!croppedAreaPixels || isCropApplying}
                                >
                                    {isCropApplying ? '⏳ Applying…' : '✓ Apply Crop'}
                                </button>
                            </div>

                            <div className={styles.cropNote}>
                                <span>⚡</span>
                                <span>Adjustments are preserved after crop and won't reset.</span>
                            </div>
                        </div>
                    )}
                </aside>

                {/* ── Canvas Area ── */}
                <main className={styles.canvasArea}>
                    {isCropping ? (
                        /* Crop mode: react-easy-crop overlay */
                        <div className={styles.cropContainer}>
                            <Cropper
                                image={imageSrc}
                                crop={crop}
                                zoom={zoom}
                                aspect={lockAspect && aspectRatio ? aspectRatio : undefined}
                                onCropChange={setCrop}
                                onZoomChange={setZoom}
                                onCropComplete={onCropComplete}
                                style={{
                                    containerStyle: { borderRadius: 'var(--radius-lg)', overflow: 'hidden' },
                                    mediaStyle: { filter: filterString }, // Show adjustments in crop preview too!
                                    cropAreaStyle: {
                                        border: '2px solid rgba(139,92,246,0.9)',
                                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                                    },
                                }}
                                showGrid
                                restrictPosition={false}
                            />

                            {/* Floating crop action bar */}
                            <div className={styles.cropBar}>
                                <button className={styles.cropBarCancel} onClick={cancelCrop}>
                                    ✕ Cancel <kbd>Esc</kbd>
                                </button>
                                <button
                                    className={`${styles.cropBarApply} ${isCropApplying ? styles.loading : ''}`}
                                    onClick={applyCrop}
                                    disabled={!croppedAreaPixels || isCropApplying}
                                >
                                    {isCropApplying ? '⏳ Applying…' : '✓ Apply Crop'}
                                    {!isCropApplying && <kbd>↵</kbd>}
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Preview mode */
                        <div className={styles.previewContainer}>
                            <img
                                ref={imgRef}
                                src={imageSrc}
                                alt="Editing preview"
                                className={styles.previewImage}
                                style={{ filter: filterString }}
                                draggable={false}
                            />

                            {/* Quick-access crop button overlay */}
                            <button
                                className={styles.cropOverlayBtn}
                                onClick={() => { setActiveTab('crop'); enterCropMode(); }}
                                title="Enter crop mode"
                            >
                                ✂️ Crop
                            </button>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default ImageEditor;
