// PDF 공작소 데스크톱 앱 (Electron) - (c) 2026 GLORY KIM
const { app, BrowserWindow, protocol, Menu, shell, ipcMain, net, dialog } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const root = path.join(__dirname, 'app');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.gz': 'application/gzip', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream' };
const pdfArg = argv => argv.slice(1).find(a => /\.pdf$/i.test(a) && fs.existsSync(a));
const readPdf = p => { try { return { name: path.basename(p), data: fs.readFileSync(p) }; } catch { return null; } };

// Windows 「설정 → 기본 앱」 목록에 PDF 공작소가 나타나도록 사용자 영역(HKCU)에 등록한다 (관리자 권한 불필요)
const regRun = args => new Promise(res => execFile('reg.exe', args, { windowsHide: true }, () => res()));
async function registerAssociations(force) {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const exe = process.execPath, marker = path.join(app.getPath('userData'), 'assoc.json');
  if (!force) { try { const m = JSON.parse(fs.readFileSync(marker, 'utf8')); if (m.exe === exe && m.v === app.getVersion()) return; } catch { /* 처음 등록 */ } }
  const S = 'HKCU\\Software\\';
  const def = (key, val) => regRun(['add', S + key, '/ve', '/d', val, '/f']);
  const val = (key, name, v) => regRun(['add', S + key, '/v', name, '/d', v, '/f']);
  const prog = 'PDFGongjakso.pdf', cap = 'PDFGongjakso\\Capabilities', base = path.basename(exe);
  await def('Classes\\' + prog, 'PDF 문서');
  await def('Classes\\' + prog + '\\DefaultIcon', '"' + exe + '",0');
  await def('Classes\\' + prog + '\\shell\\open\\command', '"' + exe + '" "%1"');
  await val('Classes\\.pdf\\OpenWithProgids', prog, '');
  await def('Classes\\Applications\\' + base + '\\shell\\open\\command', '"' + exe + '" "%1"');
  await val('Classes\\Applications\\' + base, 'FriendlyAppName', 'PDF 공작소');
  await val('Classes\\Applications\\' + base + '\\SupportedTypes', '.pdf', '');
  await val(cap, 'ApplicationName', 'PDF 공작소');
  await val(cap, 'ApplicationDescription', 'PDF 편집·변환·서명·압축 프로그램');
  await val(cap, 'ApplicationIcon', exe + ',0');
  await val(cap + '\\FileAssociations', '.pdf', prog);
  await val('RegisteredApplications', 'PDF 공작소', 'Software\\' + cap);
  try { fs.writeFileSync(marker, JSON.stringify({ exe, v: app.getVersion() })); } catch { /* 기록 실패는 무시 */ }
}
process.on('uncaughtException', err => console.error('uncaught', err));
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
  win.webContents.on('will-prevent-unload', e => {
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['저장하지 않고 닫기', '취소'], defaultId: 1, cancelId: 1, title: 'PDF 공작소',
      message: '저장하지 않은 변경 사항이나 진행 중인 작업이 있습니다.', detail: '지금 닫으면 저장하지 않은 편집 내용이 사라지고, 진행 중인 작업은 멈춥니다 (문자 인식 결과는 임시저장됩니다). 닫을까요?',
    });
    if (r === 0) e.preventDefault();          // 닫기 허용
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
  let updating = false;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const logFile = () => path.join(app.getPath('userData'), 'update.log');
  const log = msg => { try { fs.appendFileSync(logFile(), new Date().toISOString() + ' ' + msg + '\n'); } catch { /* 기록 실패는 무시 */ } };
  // 오래된 임시 설치 파일 정리
  const cleanOld = () => { try { for (const n of fs.readdirSync(os.tmpdir())) if (n.startsWith('pdfg-update-')) { const p = path.join(os.tmpdir(), n); if (Date.now() - fs.statSync(p).mtimeMs > 864e5) fs.rmSync(p, { recursive: true, force: true }); } } catch { /* 무시 */ } };
  async function download(url, e, file) {
    const res = await net.fetch(url);
    if (!res.ok) throw new Error('서버가 파일을 주지 않았습니다 (HTTP ' + res.status + ')');
    const total = +res.headers.get('content-length') || 0;
    const out = fs.createWriteStream(file);
    const reader = res.body.getReader();
    let got = 0;
    await new Promise((resolve, reject) => {
      out.on('error', reject);
      out.on('close', resolve);          // 'finish'가 아니라 파일 핸들이 완전히 닫힌 뒤(close)에 이어간다
      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!out.write(value)) await new Promise(r => out.once('drain', r));
            got += value.length;
            if (total) e.sender.send('update-progress', got / total);
          }
          out.end();
        } catch (err) { out.destroy(); reject(err); }
      })();
    });
    if (total && got !== total) throw new Error('내려받은 파일이 완전하지 않습니다 (' + got + '/' + total + ')');
    return got;
  }
  // 설치 파일 실행: 직접 실행 → 셸 실행 → cmd start 순서로 시도 (잠김은 기다렸다 재시도)
  async function launch(file) {
    const errs = [];
    for (let i = 0; i < 40; i++) {
      await wait(i ? 1000 : 300);
      if (!fs.existsSync(file)) throw new Error('설치 파일이 사라졌습니다. 보안 프로그램(백신)이 지웠을 수 있습니다');
      try {
        const child = spawn(file, [], { detached: true, stdio: 'ignore' });
        await new Promise((res, rej) => { child.once('error', rej); child.once('spawn', res); });
        child.unref(); log('launch spawn ok'); return;
      } catch (e2) {
        errs.push(e2.code || String(e2));
        if (e2.code !== 'EBUSY' && e2.code !== 'ETXTBSY' && e2.code !== 'EPERM') break;   // 잠김만 기다렸다 재시도
      }
    }
    log('spawn failed: ' + errs.join(','));
    const err = await shell.openPath(file);                       // 권한 상승이 필요한 경우 등
    if (!err) { log('launch openPath ok'); return; }
    errs.push(err);
    try {
      const c = spawn('cmd.exe', ['/c', 'start', '', file], { detached: true, stdio: 'ignore', windowsHide: true });
      await new Promise((res, rej) => { c.once('error', rej); c.once('spawn', res); });
      c.unref(); log('launch cmd start'); return;
    } catch (e3) { errs.push(e3.code || String(e3)); }
    throw new Error('설치 파일을 실행하지 못했습니다 (' + errs.join(' / ') + ')');
  }
  ipcMain.handle('install-update', async (e, url) => {
    if (!/^https:\/\/github\.com\/GCODE77\/PDF\/releases\//.test(String(url))) throw new Error('허용되지 않은 주소');
    if (updating) throw new Error('이미 내려받는 중입니다');
    updating = true;
    cleanOld();
    let file = '';
    try {
      // 매번 새 임시 폴더를 써서 이전 시도의 잠긴 파일과 겹치지 않게 한다
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfg-update-'));
      file = path.join(dir, 'PDF-Gongjakso-Setup.exe');
      log('start v=' + app.getVersion() + ' url=' + url);
      let got = 0, lastErr = null;
      for (let t = 1; t <= 3; t++) {                               // 네트워크가 흔들리면 최대 3번
        try { got = await download(url, e, file); lastErr = null; break; }
        catch (err) { lastErr = err; log('download try ' + t + ' failed: ' + (err.message || err)); await wait(1500 * t); }
      }
      if (lastErr) throw new Error('내려받지 못했습니다: ' + String(lastErr.message || lastErr).replace(/^net::/, ''));
      // 회사 보안 장치가 안내 페이지로 바꿔치기한 경우를 걸러낸다
      const head = Buffer.alloc(2); const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 2, 0); fs.closeSync(fd);
      if (got < 5e6 || head.toString('latin1') !== 'MZ') throw new Error('내려받은 파일이 설치 파일이 아닙니다 (회사 보안 장치·프록시가 막았을 수 있음)');
      if (process.env.PDFG_TEST_FAKE_EXE) fs.copyFileSync(process.env.PDFG_TEST_FAKE_EXE, file);   // 시험용: 실제 설치 대신 가짜 실행 파일
      if (process.env.PDFG_TEST_NO_LAUNCH) return { file, size: got };
      try { await launch(file); }
      catch (err) {
        // 자동 실행이 끝내 안 되면, 내려받은 설치 파일이 있는 폴더를 열어 직접 실행하게 한다
        log('launch failed: ' + (err.message || err));
        try { shell.showItemInFolder(file); } catch { /* 무시 */ }
        throw new Error('MANUAL|' + (err.message || err) + '|' + file);
      }
      setTimeout(() => app.quit(), 800);
      return { started: true };
    } catch (err) {
      log('error: ' + (err.message || err));
      if (!String(err.message).startsWith('MANUAL|')) throw new Error(String(err.message || err) + '|LOG|' + logFile());
      throw err;
    } finally { updating = false; }
  });
  ipcMain.handle('open-default-apps', async () => { await registerAssociations(true); return shell.openExternal('ms-settings:defaultapps'); });
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
    registerAssociations(false).catch(() => {});
  });
  app.on('window-all-closed', () => app.quit());
}
