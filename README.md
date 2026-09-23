# all-english-media

Centralized media and canonical curriculum repository for All-English phonics learning applications:
- **Phonics Flash**
- **MatchMaker**
- **Sunken Treasure**
- **Word-Tac-Toe**

---

## 📁 Repository Structure

```
├── SmartPhonics/               # Phonics media assets (Books 1–5)
│   ├── 1/pics/                 # Book 1 images
│   ├── 1/sounds/               # Book 1 audio (SingleLetters, Vocabulary)
│   ├── 2/                      # Book 2 media
│   ├── 3/                      # Book 3 media
│   ├── 4/                      # Book 4 media
│   └── 5/                      # Book 5 media
├── shared/
│   └── class-sync.js           # Universal client sync library & curriculum adapter
├── curriculum.json             # Canonical master curriculum (5 levels, 41 units, 413 words)
├── _headers                    # Netlify headers (CORS and cache control)
└── README.md
```

---

## 🚀 Deployment (Netlify)

This repository is designed to be hosted on Netlify as a static site (e.g. `https://all-english-media.netlify.app`).

### Steps to Deploy:
1. Initialize git in this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: centralized phonics media & canonical curriculum"
   ```
2. Push to GitHub (`All-English/all-english-media` or personal repo):
   ```bash
   gh repo create All-English/all-english-media --public --source=. --push
   # Or create on github.com and:
   # git remote add origin https://github.com/All-English/all-english-media.git
   # git push -u origin main
   ```
3. Link to Netlify:
   - Create new site from Git in Netlify.
   - Choose repository: `all-english-media`.
   - Build command: *(none / blank)*.
   - Publish directory: `.` (root).
   - Set custom site name: `all-english-media` (giving `https://all-english-media.netlify.app`).

---

## ⚡ How It Works Across Games

1. **3-Tier Load Chain**:
   - **Upstash Redis** (`shared_phonics_curriculum`): Real-time live edits made in the Phonics Flash Editor.
   - **Netlify CDN** (`curriculum.json`): Master curriculum deployed from GitHub.
   - **Bundled Fallback**: Local static fallback in each game repo ensures offline functionality if the network is unavailable.

2. **Universal Adapter (`CurriculumAdapter`)**:
   - `toPhonicsFlash(data)`: Adapts canonical format for Phonics Flash & Editor.
   - `toMatchMaker(data)`: Adapts canonical format for MatchMaker (including `imageSound` mapping and single letter sounds).
   - `toWordBank(data)`: Adapts canonical format for Sunken Treasure and Word-Tac-Toe word banks.

3. **Netlify `_headers`**:
   - `Access-Control-Allow-Origin: *` enables any origin to fetch media and curriculum safely.
   - Media assets (`/SmartPhonics/*`): `Cache-Control: public, max-age=31536000, immutable`
   - Master JSON (`/curriculum.json`): `Cache-Control: public, max-age=300, must-revalidate`
   - Shared client code (`/shared/*`): `Cache-Control: public, max-age=3600, must-revalidate`
