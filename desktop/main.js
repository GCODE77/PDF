// PDF 공작소 데스크톱 앱 (Electron) - (c) 2026 GLORY KIM
const { app, BrowserWindow, protocol, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, 'app');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.gz': 'application/gzip', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream' };
const pdfArg = argv => argv.slice(1).find(a => /\.pdf$/i.test(a) && fs.existsSync(a));
const readPdf = p => { try { return { name: path.basename(p), data: fs.readFileSync(p) }; } catch { return null; } };

let win = null;
let initial = (() => { const p = pdfArg(process.argv); return p ? readPdf(p) : null; })();

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 900, minHeight: 600, backgroundColor: '#f5f6f8', title: 'PDF 공작소',
    icon: path.join(root, 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('app://')) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://pdf/index.html');
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const p = pdfArg(argv);
    if (p) win.webContents.send('open-file', readPdf(p));
  });
  ipcMain.handle('initial-file', () => { const f = initial; initial = null; return f; });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('app', async req => {
      let rel = decodeURIComponent(new URL(req.url).pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const f = path.normalize(path.join(root, rel));
      if (!f.startsWith(root)) return new Response('Forbidden', { status: 403 });
      try {
        const data = await fs.promises.readFile(f);
        return new Response(data, { headers: { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
