# Quick Reference: Template Loading Flow

## 🔄 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    USER SAVES TEMPLATE                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  1. Canvas → JSON Export                                     │
│     - Text objects                                           │
│     - Shape objects                                          │
│     - Image objects (with data URLs)                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. Process Images (processImagesForStorage)                 │
│     - Find all image objects                                 │
│     - Convert data URLs → Blobs                              │
│     - Save blobs to IndexedDB                                │
│     - Replace src: "data:image/..." → "indexeddb://[id]"    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  3. Save Template                                            │
│     Template = {                                             │
│       id: "1738748123456",                                   │
│       name: "My Template",                                   │
│       json: {                                                │
│         objects: [{                                          │
│           type: "image",                                     │
│           src: "indexeddb://abc123"  ← Reference to DB       │
│         }]                                                   │
│       }                                                      │
│     }                                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Stored in IndexedDB                                      │
│     - templates store: Template metadata + JSON              │
│     - images store: Image blobs                              │
└─────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────┐
│                    USER LOADS TEMPLATE                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  1. Retrieve Template from IndexedDB                         │
│     template = {id, name, json, thumbnail, ...}              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. Parse JSON                                               │
│     data = JSON.parse(template.json)                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  3. Restore Images (restoreImagesFromStorage) ✨ FIXED       │
│                                                              │
│     A. Clean up old blob URLs                                │
│        cleanupBlobUrls() → Revoke previous URLs              │
│                                                              │
│     B. For each image object:                                │
│        - Find src: "indexeddb://abc123"                      │
│        - Get blob from IndexedDB                             │
│        - Create blob URL                                     │
│        - Replace src: "blob:http://localhost:4200/xyz"       │
│        - ✅ TRACK URL in activeBlobUrls[]                    │
│                                                              │
│     activeBlobUrls = ["blob://xyz", "blob://abc", ...]       │
│     ↑ These URLs stay alive!                                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Load into Fabric.js Canvas                               │
│     canvas.loadFromJSON(data)                                │
│     - Fabric.js loads each object                            │
│     - For images, fetches from blob URLs                     │
│     - ✅ URLs are still valid (tracked!)                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  5. Render Complete                                          │
│     - All objects visible on canvas                          │
│     - Images loaded successfully                             │
│     - Blob URLs remain in activeBlobUrls[]                   │
└─────────────────────────────────────────────────────────────┘
```

## ❌ What Was Wrong (Before Fix)

```
Restore Images:
  Create blob URL → "blob://xyz"
  Set obj.src = "blob://xyz"
  ↓
  (Function returns, blob URL goes out of scope)
  ↓
  Garbage collection → blob URL invalidated
  ↓
Fabric.js tries to load:
  fetch("blob://xyz") → ❌ ERR_FILE_NOT_FOUND
```

## ✅ What's Fixed (After Fix)

```
Restore Images:
  Create blob URL → "blob://xyz"
  Set obj.src = "blob://xyz"
  activeBlobUrls.push("blob://xyz") ← ✅ TRACKED!
  ↓
  (Function returns, but URL is referenced in array)
  ↓
  Garbage collection → ✅ URL stays alive
  ↓
Fabric.js tries to load:
  fetch("blob://xyz") → ✅ SUCCESS!
```

## 🔑 Key Concepts

### Blob URLs
- Created with: `URL.createObjectURL(blob)`
- Format: `blob:http://localhost:4200/uuid`
- **Must be kept in memory** until used
- Revoked with: `URL.revokeObjectURL(url)`

### The Fix
```typescript
// ❌ BEFORE (URLs get garbage collected)
const url = URL.createObjectURL(blob);
obj.src = url;
// url goes out of scope → garbage collected

// ✅ AFTER (URLs stay alive)
const url = URL.createObjectURL(blob);
obj.src = url;
this.activeBlobUrls.push(url);  // Keep reference!
```

### Cleanup
```typescript
// When loading new template:
cleanupBlobUrls() {
  // Revoke old URLs
  this.activeBlobUrls.forEach(url => URL.revokeObjectURL(url));
  // Clear array
  this.activeBlobUrls = [];
}
```

## 📊 Console Output Example

### Successful Load
```
✓ Apply template clicked: {name: "My Template"}
✓ Loading template...
✓ Parsed template data: {objects: [...]}
✓ Restoring images from storage...
✓ Cleaning up 0 blob URLs
✓ Restoring image from IndexedDB: 1738748123456
✓ Image restored successfully: 1738748123456 → blob:http://localhost:4200/abc-123
✓ Image restoration complete. Active blob URLs: 1
✓ Template loaded successfully
```

### Failed Load (Before Fix)
```
✓ Apply template clicked: {name: "My Template"}
✓ Loading template...
✓ Parsed template data: {objects: [...]}
✓ Restoring images from storage...
✓ Restoring image from IndexedDB: 1738748123456
✓ Image restored successfully: 1738748123456 → blob:http://localhost:4200/abc-123
✓ Image restoration complete. Active blob URLs: 1
❌ Failed to load resource: net::ERR_FILE_NOT_FOUND
❌ fabric: Error loading blob:http://localhost:4200/abc-123
```

## 🎯 Testing Checklist

- [ ] Save template with 1 image
- [ ] Load template → Check console for "Image restored successfully"
- [ ] Verify image appears on canvas
- [ ] Save template with multiple images
- [ ] Load template → Check "Active blob URLs: [count]"
- [ ] Verify all images appear
- [ ] Load different template → Check "Cleaning up [count] blob URLs"
- [ ] Verify old blobs are cleaned up
- [ ] No "ERR_FILE_NOT_FOUND" errors
- [ ] No "fabric: Error loading blob" errors

## 🚀 You're All Set!

The blob URL lifecycle is now properly managed. Your templates with images should load perfectly every time! 🎨✨
