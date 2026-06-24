# ClapClip - Premium YouTube Video Clipper

ClapClip is a sleek, modern, glassmorphic dark-themed web application designed to trim, download, loop, and upload your favorite YouTube moments directly to your channel. It features direct integration with YouTube Data API v3, Google OAuth2, local database persistence, and server-side video processing.

---

## 🚀 Tech Stack

### 1. Frontend
* **UI/UX**: HTML5, Vanilla CSS3 (Glassmorphism design, vibrant color gradients, responsive grid layouts).
* **Typography**: Modern fonts (Outfit & Plus Jakarta Sans via Google Fonts).
* **Interactions**: Vanilla Javascript (ES Modules), responsive state bindings.
* **Build System**: Vite (v5) dev server and compiler.

### 2. Backend
* **Server**: Node.js middlewares integrated within Vite's developer server (`configureServer` lifecycle).
* **Database**: SQLite3 (`sqlite3` driver) for local credentials and upload transaction tracking.
* **Video Utilities**:
  * `yt-dlp`: Downloads the specific section of a YouTube stream dynamically.
  * `ffmpeg`: Handles merging audio/video streams and container wrapping into clean `.mp4` files (using static binaries via `ffmpeg-static`).

### 3. Integrations
* **Google OAuth 2.0**: Consent redirection, access & refresh token rotation, secure client secrets parsing.
* **YouTube Data API v3**: Channels metadata retrieving, playlists synchronization, multipart video uploads, and playlist item additions.

---

## 🏛️ System Architecture

```
                                  +-----------------------+
                                  |   ClapClip Frontend   |
                                  | (HTML5 / Vanilla CSS) |
                                  +-----------+-----------+
                                              |
                                     HTTP API | (/api/*)
                                              v
+---------------------------------------------+---------------------------------------------+
|                                  Vite Dev Server (Node.js)                                 |
|                                                                                           |
|  +--------------------+    +--------------------+    +--------------------+               |
|  |   OAuth Handler    |    |  Database Methods  |    |  Video Processor   |               |
|  |  (Token exchange / |    |   (src/db.js /     |    | (yt-dlp & ffmpeg)  |               |
|  |    refreshes)      |    |    clipper.db)     |    |                    |               |
|  +---------+----------+    +---------+----------+    +---------+----------+               |
+------------|-------------------------|-------------------------|--------------------------+
             |                         |                         |
             | HTTP (OAuth / API)      | SQL Queries             | Process Spawn / Streams
             v                         v                         v
   +---------+---------+     +---------+---------+     +---------+---------+
   |   Google APIs     |     |   clipper.db      |     |  Local Filesystem |
   |  (YouTube v3)     |     | (SQLite Database) |     |     (./temp/)     |
   +-------------------+     +-------------------+     +-------------------+
```

---

## 🔄 Core Process Flows

### 1. Channel OAuth Connection Flow
1. **Initiation**: The client clicks "Connect Channel". The frontend queries `GET /api/config` to check if a `.env` file contains credentials.
2. **Consent Redirection**: The server routes `GET /api/auth`, bundles credentials (or environment fallbacks) and scopes (`youtube.upload`, `youtube.readonly`, and `youtube`), and redirects to Google Accounts.
3. **Callback & Exchange**: The user signs in and is redirected back to `GET /api/callback`. The server exchanges the authorization code for access & refresh tokens, queries Google for YouTube channel details, and stores credentials in the local `channels` table in `clipper.db`.
4. **Integration**: A script closes the popup, sends channel info to the parent window, and displays the channel as connected.

### 2. Clipping & Download Flow
1. The user inputs a YouTube video link, start/end timestamps, and clicks "Download Clip".
2. The browser requests `GET /api/download` with video params.
3. The server ensures the OS-specific `yt-dlp` binary is downloaded/present inside the `./bin/` directory.
4. The server runs `yt-dlp` in a child process with arguments:
   `--download-sections "*start_seconds-end_seconds"`
5. `yt-dlp` downloads the section, calls `ffmpeg` to merge streams into a clean `.mp4` file in `./temp/`, and the server pipes the stream download back to the client as an attachment.
6. The temp file is automatically deleted from the server once stream delivery completes.

### 3. YouTube Upload & Playlist Assignment Flow
1. The user selects a connected channel, start/end timestamps, fills metadata fields (title, description, playlist), and clicks "Upload to YouTube".
2. The browser initiates a request to `POST /api/upload-youtube`.
3. The server logs the transaction in the `uploads` table (status: `pending`), checks if the channel token has expired, and automatically requests a fresh token using `refresh_token` if necessary.
4. The video is trimmed locally to a `.mp4` file in the `./temp/` directory.
5. The server creates a multipart payload consisting of metadata (JSON) and media content (binary file data) separated by boundaries, and posts it to:
   `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status`
6. Once uploaded, Google returns the new Video ID.
7. **Playlist insertion**: If a playlist ID is selected, the server performs a `POST` request to `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet` using the `youtube` management scope.
8. The database record is marked as `completed` with the returned YouTube Video ID, and the temporary file is deleted.

---

## 📂 Project Structure

```text
├── bin/                       # Automatically downloaded platform-specific yt-dlp binaries
├── dist/                      # Production bundles (generated via npm run build)
├── node_modules/              # Dependency files
├── scratch/                   # Developer script testing folder
├── src/
│   ├── db.js                  # Database connection, helpers, and tables initializer
│   ├── main.js                # Frontend controllers, event handlers, and endpoints binder
│   └── style.css              # Main dark-mode glassmorphic stylesheets
├── temp/                      # Working folder for downloaded video clips (auto-cleaned)
├── tests/                     # Integration and unit test cases
├── .env                       # Environment configuration secrets (GOOGLE_CLIENT_ID/SECRET)
├── clipper.db                 # Local SQLite database instance (auto-created on start)
├── index.html                 # Main interface template file
├── package.json               # Manifest dependencies configuration
├── PROJECT_STATUS.md          # Current system status audit document
├── README.md                  # This file
└── vite.config.js             # Server config, dev server endpoints, and upload processes
```

---

## 🛠️ Getting Started

### 1. Setup Environment
Create a `.env` file in the root directory:
```env
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:5173/](http://localhost:5173/) in your web browser.
