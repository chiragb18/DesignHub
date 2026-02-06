# Template System - Code Flow Documentation

## Overview
This document explains how the template save/load system works in the Banner UI Editor.

## Architecture

```
User Interface (templates-panel.html)
         ↓
Component Logic (templates-panel.ts)
         ↓
Service Layer (banner.service.ts)
         ↓
Storage Layer (image-storage.service.ts)
         ↓
IndexedDB (Browser Database)
```

## Save Flow

### 1. User Clicks Save Button
**File**: `templates-panel.html` (lines 5-16)
```html
<button (click)="saveAsTemplate()">Template</button>
<button (click)="saveAsDesign()">Design</button>
<button (click)="saveAsBackground()">BG</button>
```

### 2. Modal Opens
**File**: `templates-panel.ts` (lines 108-119)
```typescript
openSaveModal(category: string = 'Template') {
    this.saveCategory = category;
    this.templateNameInput = 'Untitled ' + category;
    this.isSaveModalOpen = true;
}
```

### 3. User Confirms Save
**File**: `templates-panel.ts` (lines 125-134)
```typescript
async confirmSaveTemplate() {
    const success = await this.bannerService.saveTemplate(
        this.templateNameInput, 
        this.saveCategory
    );
    if (success) {
        // Show success message
    }
}
```

### 4. Service Saves Template
**File**: `banner.service.ts` (lines 606-666)
```typescript
async saveTemplate(name: string, category: string = 'Template') {
    // 1. Deselect objects
    this.canvas.discardActiveObject();
    
    // 2. Export canvas to JSON
    const json = this.canvas.toObject(customProps);
    
    // 3. Process images (save to IndexedDB)
    await this.processImagesForStorage(json);
    
    // 4. Generate thumbnail
    const thumbnail = this.canvas.toDataURL({...});
    
    // 5. Create template object
    const newTemplate: Template = {
        id: Date.now().toString(),
        name,
        category,
        json,        // ← Canvas data as object
        thumbnail,
        isCustom: true,
        date: new Date()
    };
    
    // 6. Save to IndexedDB
    await this.saveTemplatesToStorage([...allSaved, newTemplate]);
    
    // 7. Refresh UI
    await this.initSavedTemplates();
}
```

### 5. Storage Layer Saves to IndexedDB
**File**: `image-storage.service.ts`
```typescript
async saveTemplates(templates: Template[]): Promise<void> {
    // Saves to IndexedDB 'templates' store
}
```

## Load Flow

### 1. User Clicks Template
**File**: `templates-panel.html` (line 91)
```html
<div class="item-card" (click)="applyTemplate(t)">
```

### 2. Component Handles Click
**File**: `templates-panel.ts` (lines 171-176)
```typescript
applyTemplate(template: Template) {
    console.log('Apply template clicked:', template);
    if (confirm('Replace current design with this?')) {
        this.bannerService.activeTemplateId.set(template.id);
        console.log('Loading template with json:', template.json);
        this.bannerService.loadTemplate(template.json);
    }
}
```

### 3. Service Loads Template
**File**: `banner.service.ts` (lines 900-947)
```typescript
async loadTemplate(templateJson: any): Promise<void> {
    try {
        console.log('Loading template...', templateJson);
        
        // 1. Parse JSON (handles both string and object)
        let data;
        if (typeof templateJson === 'string') {
            data = JSON.parse(templateJson);
        } else if (typeof templateJson === 'object') {
            data = JSON.parse(JSON.stringify(templateJson));
        }
        
        console.log('Parsed template data:', data);
        
        // 2. Restore images from IndexedDB
        await this.restoreImagesFromStorage(data);
        
        // 3. Load into Fabric.js canvas
        await this.canvas.loadFromJSON(data);
        
        // 4. Render and update state
        this.canvas.requestRenderAll();
        this.reviveCurvedElements();
        this.refreshState();
        
        console.log('Template loaded successfully');
        
        // 5. Show success banner
        this.showTemplateInfo.set(true);
    } catch (err) {
        console.error('Load template failed:', err);
        alert('Failed to load template: ' + err.message);
    }
}
```

### 4. Image Restoration
**File**: `banner.service.ts` (lines 1008-1036)
```typescript
private async restoreImagesFromStorage(json: any) {
    // Recursively finds images with 'indexeddb://' URLs
    // Loads them from IndexedDB
    // Converts to blob URLs for Fabric.js
}
```

## Add to Canvas Flow (Designs)

### User Clicks "Add" Button
**File**: `templates-panel.html` (line 70)
```html
<button (click)="addToCanvas(t)">Add</button>
```

### Component Handles Add
**File**: `templates-panel.ts` (lines 178-181)
```typescript
addToCanvas(template: Template) {
    console.log('Add to canvas clicked:', template);
    this.bannerService.addTemplateToCanvas(template.json);
}
```

### Service Adds Objects
**File**: `banner.service.ts` (lines 950-1016)
```typescript
async addTemplateToCanvas(templateJson: any): Promise<void> {
    try {
        // 1. Parse JSON
        let data = /* parse logic */;
        
        // 2. Restore images
        await this.restoreImagesFromStorage(data);
        
        // 3. Add each object individually
        for (const objData of data.objects) {
            const objects = await fabric.util.enlivenObjects([objData]);
            const obj = objects[0];
            
            // Offset position to avoid overlap
            obj.set({
                left: obj.left + 20,
                top: obj.top + 20
            });
            
            this.canvas.add(obj);
        }
        
        // 4. Render
        this.canvas.requestRenderAll();
    } catch (err) {
        alert('Failed to add template: ' + err.message);
    }
}
```

## Data Structures

### Template Interface
```typescript
interface Template {
    id: string;           // Unique ID (timestamp)
    name: string;         // User-provided name
    category: string;     // 'Template' | 'Design' | 'Background'
    thumbnail: string;    // Base64 JPEG data URL
    json: any;           // Canvas JSON (object or string)
    isCustom: boolean;   // true for user templates
    date?: Date;         // Creation date
    tags?: string[];     // Optional tags
}
```

### Canvas JSON Structure
```typescript
{
    version: string;
    objects: [
        {
            type: 'textbox' | 'image' | 'rect' | ...,
            left: number,
            top: number,
            width: number,
            height: number,
            // ... other properties
        }
    ],
    background: string | Gradient | Pattern,
    // ... other canvas properties
}
```

## Storage Details

### IndexedDB Stores
1. **templates** - Stores template metadata and JSON
2. **images** - Stores image blobs referenced by templates
3. **cutouts** - Stores background-removed images

### Image Storage Strategy
- Large images are stored separately in IndexedDB
- Template JSON references them as `indexeddb://[id]`
- On load, images are retrieved and converted to blob URLs
- This avoids data URL size limits

## Error Handling

### Save Errors
- JSON serialization failures
- IndexedDB quota exceeded
- Image processing errors

### Load Errors
- Invalid JSON format
- Missing images in IndexedDB
- Fabric.js parsing errors
- Corrupted template data

All errors are:
1. Logged to console with details
2. Shown to user via alert
3. Prevent app crash with try-catch

## Console Logging

### Save Process
```
Saving template...
Template saved successfully
```

### Load Process
```
Apply template clicked: {id: "...", name: "..."}
Loading template with json: {...}
Loading template...
Parsed template data: {...}
Template loaded successfully
```

### Errors
```
Load template failed: [Error details]
Failed to parse template JSON string: [Parse error]
```

## Testing the Flow

1. **Open Console** (F12)
2. **Save a template** - Watch for save logs
3. **Click the template** - Watch for load logs
4. **Check for errors** - Red text indicates issues

Each step logs its progress, making debugging straightforward!
