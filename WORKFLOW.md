# Firebase Integration Workflow

This project uses a **Hybrid Cloud** architecture.
- **Local Database (IndexedDB)**: Ensures your app works offline and is super fast.
- **Cloud Database (Firebase)**: Backs up your designs and allows you to share/deploy them.

## 1. Firebase Setup (One-Time)

Firebase offers a **Spark Plan** which is **100% Free** for small projects. You do not need a credit card.

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Create a new project.
3. Enable **Firestore Database** (start in Test Mode).
4. Enable **Storage** (start in Test Mode).
5. Go to **Project Settings** -> **General** -> scroll down to "Your apps".
6. Click the Web icon (`</>`) to register a web app.
7. Copy the `firebaseConfig` object.

## 2. Configure Your Project

Open `src/environments/environment.ts` and paste your config:

```typescript
export const environment = {
  production: false,
  firebase: {
    apiKey: "AIzaSy...",
    authDomain: "your-project-id.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project-id.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef"
  }
};
```

**Note:** Do the same for `src/environments/environment.prod.ts` if you are deploying to Vercel/Netlify.

## 3. How Saving Works

### Saving a Template/Design
1. Click **Save** in the UI.
2. The app **instantly** saves your work to your browser's local storage (IndexedDB).
3. In the background, it converts all images to permanent URLs and uploads them to Firebase Storage.
4. It saves the design JSON (with cloud links) to Firestore.

**If you are offline or have no API key:**
- The app will show: *"Saved locally, but cloud sync failed."*
- Your design is SAFE in your local browser.
- You can continue working normally.

### Loading Templates
- The app loads your **Local** templates first (instant).
- Then it checks the Cloud for any new templates or system templates and merges them in.

## 4. Deployment Check

Before deploying to Vercel:
1. Ensure `environment.prod.ts` has the correct values.
2. Build the app with `npm run build`.
3. Firebase domains must be authorized in your Firebase Console authentication settings (if using Auth, though this project currently uses public read/write).
