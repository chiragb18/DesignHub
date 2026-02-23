/**
 * cropUtils.ts
 * Utility to extract a cropped region from an image on an HTML Canvas.
 * Optionally applies CSS filter string (brightness/contrast/sat/blur) to the export.
 */

export interface PixelCrop {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Creates an HTMLImageElement from a URL, resolving when loaded. */
const createImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.setAttribute('crossOrigin', 'anonymous');
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = url;
    });

/**
 * Crops the image to the specified pixel region.
 * Does NOT apply filters — preserves raw pixel data so filter state is kept separately.
 *
 * @param imageSrc   - Source image URL or data URL
 * @param pixelCrop  - { x, y, width, height } in actual image pixels
 * @returns          - Data URL of the cropped image (PNG)
 */
export const getCroppedImg = async (
    imageSrc: string,
    pixelCrop: PixelCrop
): Promise<string> => {
    const image = await createImage(imageSrc);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(pixelCrop.width);
    canvas.height = Math.round(pixelCrop.height);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');

    // Draw only the cropped region — no filter applied here so adjustments are preserved
    ctx.drawImage(
        image,
        Math.round(pixelCrop.x),     // source x
        Math.round(pixelCrop.y),     // source y
        Math.round(pixelCrop.width), // source width
        Math.round(pixelCrop.height),// source height
        0,                           // dest x
        0,                           // dest y
        Math.round(pixelCrop.width), // dest width
        Math.round(pixelCrop.height) // dest height
    );

    return canvas.toDataURL('image/png');
};

/**
 * Exports the image with CSS filters "baked in" to a downloadable PNG.
 * Used for the final Save/Export action only.
 *
 * @param imageSrc     - Source image URL or data URL
 * @param filterString - CSS filter string e.g. "brightness(120%) contrast(90%)"
 * @param filename     - Download filename
 */
export const exportWithFilters = async (
    imageSrc: string,
    filterString: string,
    filename = 'designhub-export.png'
): Promise<void> => {
    const image = await createImage(imageSrc);

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');

    // Apply CSS filter on canvas context (supported in all modern browsers)
    ctx.filter = filterString || 'none';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Trigger download
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
};
