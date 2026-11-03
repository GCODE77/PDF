// PDF 공작소 데스크톱 앱 (Electron) - (c) 2026 GLORY KIM
const { app, BrowserWindow, protocol, Menu, shell, ipcMain, net } = require('electron');
const { spawn } = require('child_process');
const os = require('os');
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
  // 새 버전 설치 파일을 내려받아 실행 (이 저장소의 릴리스 주소만 허용)
  ipcMain.handle('install-update', async (e, url) => {
    if (!/^https:\/\/github\.com\/GCODE77\/PDF\/releases\//.test(String(url))) throw new Error('허용되지 않은 주소');
    const res = await net.fetch(url);
    if (!res.ok) throw new Error('다운로드 실패 ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    const file = path.join(os.tmpdir(), 'PDF-Gongjakso-Setup-update.exe');
    const out = fs.createWriteStream(file);
    const reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.write(value); got += value.length;
      if (total) e.sender.send('update-progress', got / total);
    }
    await new Promise(r => out.end(r));
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 600);
  });
  ipcMain.handle('initial-file', () => { const f = initial; initial = null; return f; });
  app.setAppUserModelId('kim.glory.pdfgongjakso');
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
