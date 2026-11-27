# Family Hub

The grown-up's one place for the four learning apps on this site (Math Arena, Language Quest, Code Quest, Music Quest).

- **Set up once** (on the grown-up's laptop): one PIN, rewards, the private setup codes, an optional AI key, one look, then **Connect his laptop** with one link.
- **His laptop:** open the family link once. Everything else arrives by itself.
- **Every week:** active minutes, lessons and shards per app, reward tickets to approve, and the wallet with ± adjust.

Data lives in the family's own Google Sheet, through a small Apps Script web app (see DEPLOY.md). The API key is AES-GCM encrypted with the family secret. No names are stored in this code. `endpoint.json` can hold the web app address, which lets the 6-character pairing codes work; it gives no access by itself.

Files: `index.html`, `hub.js`, `hub.css`, `codes.js`, `qr.js`, `family-sync.js` (shared, byte-identical in all apps), `family-wallet.js` (shared), `kit/` (pictures and fonts), `endpoint.json`, `SHA256SUMS`.
