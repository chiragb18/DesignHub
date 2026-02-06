# Edge Masking / Soft Cut Feature

## Overview
We've added a new **Edge Style / Mask** feature to the Image Settings panel. This allows users to apply organic, vector-based shapes to the edges of their images, creating "Cloud", "Wave", or "Organic" cut effects.

## How It Works
The feature uses Fabric.js `clipPath` property to mask the image content non-destructively.
- **Vector Based**: Uses SVG paths for crisp edges at any scale.
- **Dynamic**: The path is generated on the fly based on the image dimensions and user settings.
- **Persisted**: The mask state (`maskType`, `maskHeight`, `maskFlip`) is saved with the project/template.

## Features
1.  **Mask Types**:
    *   **None**: Standard rectangular image.
    *   **Cloud**: A fluffy, cloudy edge (great for sky replacements or soft footers).
    *   **Wave**: A stylistic sine-wave edge.
    *   **Organic**: A smooth, asymmetric blob-like curve.

2.  **Controls**:
    *   **Mask Depth**: Slider to control how "deep" the effect cuts into the image (0% to 60%).
    *   **Flip Edge**: Toggle to switch the effect from the bottom edge to the top edge.

3.  **Usage**:
    1.  Select an image on the canvas.
    2.  Open the **Filters** tab in the right sidebar.
    3.  Scroll to **Edge Style / Mask**.
    4.  Select a style (Cloud, Wave, Organic).
    5.  Adjust depth and orientation.

## Technical Implementation
- **Service**: `BannerService.applyImageMask()` handles the geometry generation.
- **State**: Custom properties (`maskType`, `maskHeight`, `maskFlip`) are attached to Fabric objects and included in JSON export.
- **UI**: Added a new section to `RightSidebarComponent` with visual previews.

## Future Improvements
- **Rounded Fade**: To implement a true "Fade" (opacity gradient), we would need to implement an Alpha Mask filter or SVG Masking, as `clipPath` only handles hard vector clipping.
- **Sides**: Currently supports Top/Bottom. Could add Left/Right support.
