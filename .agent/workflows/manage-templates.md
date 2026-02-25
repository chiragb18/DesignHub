---
description: How to manage templates and make them persistent after deployment
---

# Managing Templates in Banner UI Editor

To ensure your templates are visible after deployment and shared with all users, follow these steps:

## 1. Create and Save your Design
- Open the editor and create your template.
- Click **Save as Template** or **Save as Design** in the left panel.
- This saves it to your *local browser storage* and *personal cloud*.

## 2. Export for Production (System Templates)
- In the **Templates** tab, find your saved design.
- Click the **Download (Export)** icon on the card.
- A JSON file named `[Your_Name]_system_tpl.json` will be downloaded.

## 3. Add to Project Assets
- Open your project code.
- Navigate to `src/assets/templates/system_templates.json`.
- Open the file and you will see a list `[]`.
- Copy-paste the content of the downloaded JSON file into this array.
- **Note:** Ensure it is a valid JSON array. Example:
  ```json
  [
    { "id": "tpl_123...", "name": "...", "json": { ... }, "isSystem": true },
    { "id": "tpl_456...", "name": "...", "json": { ... }, "isSystem": true }
  ]
  ```

## 4. Deploy to Vercel
- Commit your changes to Git.
- Push to your repository.
- Vercel will rebuild the app, and the new templates will be bundled in the `/assets` folder.
- **Everyone** visiting your site will now see these templates in the "System" section.

## 5. Alternative: Cloud Management
- If you have Firebase Firestore set up, you can also add documents directly to the `system_templates` collection in the Firebase Console.
- The app will automatically sync these templates on the next refresh!
