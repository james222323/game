export class FSGAMEPlayer {
  static async loadFromManifest(manifestUrl) {
    const loadingText = document.getElementById("loading-text");
    const progressBar = document.getElementById("progress-bar");
    const iframe = document.getElementById("game-frame");

    try {
      // Fetch manifest
      const res = await fetch(manifestUrl);
      if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
      const manifest = await res.json();

      if (!manifest.files || !manifest.files.length)
        throw new Error("Manifest missing 'files' array.");

      loadingText.textContent = `📥 Downloading ${manifest.files.length} files...`;

      // Download files sequentially (could be parallelized if needed)
      const buffers = [];
      for (let i = 0; i < manifest.files.length; i++) {
        const url = manifest.files[i];
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Failed to fetch ${url}`);
        const buf = await r.arrayBuffer();
        buffers.push(buf);
        const percent = Math.floor(((i + 1) / manifest.files.length) * 50);
        progressBar.style.width = percent + "%";
        loadingText.textContent = `📥 Downloading file ${i + 1}/${manifest.files.length}...`;
      }

      // Merge buffers
      const mergedBuffer = this.mergeBuffers(buffers);
      loadingText.textContent = `📦 Merging files...`;
      progressBar.style.width = "55%";

      // Unpack
      await this.unpackFSGAME(mergedBuffer, progressBar, loadingText);
      
      // Hide loading UI
      progressBar.style.width = "100%";
      loadingText.style.display = "none";

      // Launch game
      iframe.style.display = "block";
      iframe.src = "index.html"; // main HTML inside FSGAME archive

    } catch (err) {
      console.error("❌ FSGAME Player error:", err);
      loadingText.textContent = `❌ ${err.message}`;
      progressBar.style.background = "#f00";
    }
  }

  static mergeBuffers(buffers) {
    const totalSize = buffers.reduce((sum, b) => sum + b.byteLength, 0);
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    for (const buf of buffers) {
      merged.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
    return merged.buffer;
  }

  static async unpackFSGAME(arrayBuffer, progressBar, loadingText) {
    const DB_NAME = "fsgame_storage";
    const STORE_NAME = "files";

    const openDB = () => new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });

    const saveFile = async (path, data) => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(data, path);
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
    };

    const dv = new DataView(arrayBuffer);
    let offset = 0;
    const version = dv.getUint32(offset, true); offset += 4;
    const fileCount = dv.getUint32(offset, true); offset += 4;
    console.log(`📜 Archive version ${version}, files: ${fileCount}`);

    for (let i = 0; i < fileCount; i++) {
      const nameLen = dv.getUint16(offset, true); offset += 2;
      const nameBytes = new Uint8Array(arrayBuffer, offset, nameLen); offset += nameLen;
      const name = new TextDecoder().decode(nameBytes);

      const compSize = dv.getUint32(offset, true); offset += 4;
      const origSize = dv.getUint32(offset, true); offset += 4;
      offset += 4; // timestamp

      const compData = new Uint8Array(arrayBuffer, offset, compSize); offset += compSize;
      const inflated = pako.inflate(compData);

      let type = "application/octet-stream";
      if (name.endsWith(".html")) type = "text/html";
      else if (name.endsWith(".js")) type = "text/javascript";
      else if (name.endsWith(".json")) type = "application/json";
      else if (name.endsWith(".css")) type = "text/css";
      else if (name.endsWith(".png")) type = "image/png";
      else if (name.endsWith(".jpg") || name.endsWith(".jpeg")) type = "image/jpeg";
      else if (name.endsWith(".wasm")) type = "application/wasm";

      await saveFile(name, new Blob([inflated], { type }));

      // Update progress bar (50–100%)
      const percent = 50 + Math.floor(((i + 1) / fileCount) * 50);
      progressBar.style.width = percent + "%";
      loadingText.textContent = `📦 Unpacking file ${i + 1}/${fileCount}...`;
    }

    console.log("✅ Unpack complete!");
  }
}
