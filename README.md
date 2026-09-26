# Pantry Ledger

A pantry tracker — item, category, location, stock level, and purchase
history (price / store / date). Static site, no backend to run yourself;
data lives in a free Firebase (Firestore) database so it stays in sync
across every device you open it on.

## 1. Create a Firebase project (free)

1. Go to https://console.firebase.google.com and sign in with any Google account.
2. Click **Add project**, give it a name (e.g. `pantry-ledger`), and finish the wizard (you can decline Google Analytics — not needed).
3. In the left sidebar, click **Build → Firestore Database**, then **Create database**.
   - Choose a location close to you.
   - Start in **production mode** (we'll set the actual rules in step 3).
4. Click the gear icon (top left) → **Project settings**. Under **Your apps**, click the **</>** (web) icon to register a new web app. Give it any nickname, skip Firebase Hosting.
5. It will show a `firebaseConfig` object. Copy it.

## 2. Configure the app

Open `firebase-config.js` in this folder and paste your values in, replacing the placeholders:

```js
window.firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

This file is safe to commit — a Firebase **web** API key isn't a secret by itself. Access control comes from the security rules below.

## 3. Set Firestore security rules

In the Firebase console: **Firestore Database → Rules**, replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /items/{itemId} {
      allow read, write: if true;
    }
  }
}
```

Click **Publish**. This keeps things simple for a personal/family list — anyone who has your app's URL *and* somehow finds your Firebase project ID could read or write it, since there's no login. For a public repo, that risk is low but not zero. If you want more protection later, the easy upgrade is restricting the API key to your GitHub Pages domain: **Google Cloud Console → APIs & Services → Credentials → your key → Application restrictions → HTTP referrers**, and adding `https://<your-username>.github.io/*`.

## 4. Push to GitHub and turn on Pages

```bash
cd pantry-app
git init
git add .
git commit -m "Pantry Ledger"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages** → under "Build and deployment", set **Source** to "Deploy from a branch", branch `main`, folder `/ (root)`, **Save**.

GitHub gives you a URL like `https://<your-username>.github.io/<repo-name>/` within a minute or two.

## 5. Add it to your iPhone home screen

1. Open the GitHub Pages URL in **Safari** (must be Safari, not Chrome).
2. Tap the **Share** icon → **Add to Home Screen** → **Add**.

It launches full-screen with its own icon, like a native app.

## Scanning a receipt

Tap **Scan a receipt**, take or choose a photo. It reads the text entirely on your own device (via [Tesseract.js](https://github.com/naptha/tesseract.js), no API key, no server, nothing leaves your phone) and pulls out candidate item/price lines. You then get a review step — uncheck anything that isn't an item, fix a misread name or price, set a category for new items — before anything is written to your database. Rows that match an item you already track are added as a new purchase entry on that item instead of creating a duplicate.

Notes:
- Receipt OCR from a phone photo is never perfect, especially on thermal-printer receipts — the review step exists because of that, not despite it.
- The first scan on a given device downloads the OCR engine and English language data (a few MB) and caches it in the browser; later scans start instantly.
- Works best with a flat, well-lit, straight-on photo of the receipt.

## First load

The very first time the app connects to your (empty) Firestore database, it seeds it with the pantry list from `seed-data.js` (your original list, with locations left blank for you to fill in). After that first write, `seed-data.js` is never used again — edit or clear it before your first load if you'd rather start from scratch.

## Notes

- Everyone who opens the URL sees and edits the same shared list, live — there's no per-person login.
- If you ever want to reset all data, delete all documents in the `items` collection from the Firestore console (**Firestore Database → Data**).
- Free Firebase tier (Spark plan) covers this comfortably — a household pantry list is a tiny fraction of the free quota.
