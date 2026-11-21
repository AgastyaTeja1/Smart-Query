// A stand-in "other app" for the macOS tests: a real, separate process with one ordinary window
// that the test moves around through stdin. Commands (one per line, JSON):
//   {"cmd":"bounds","x":..,"y":..,"w":..,"h":..}   {"cmd":"fullscreen","on":true}   {"cmd":"quit"}
// Replies (stdout, JSON per line): {"ready":true,"bounds":{...},"pid":..} / {"ok":true,"bounds":{...}}
const { app, BrowserWindow } = require('electron');
const readline = require('node:readline');

app.whenReady().then(async () => {
  const [x, y, w, h] = (process.env.HELPER_BOUNDS || '300,260,760,420').split(',').map(Number);
  const win = new BrowserWindow({ x, y, width: w, height: h, title: 'Driftsky test window', backgroundColor: '#ececf0', show: false });
  await win.loadURL('data:text/html,<body style="font:20px -apple-system;padding:40px;background:#ececf0">A real macOS window</body>');
  win.show();
  win.focus();
  const reply = (o) => process.stdout.write(JSON.stringify({ ...o, bounds: win.getBounds() }) + '\n');
  setTimeout(() => reply({ ready: true, pid: process.pid }), 500);
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.cmd === 'bounds') win.setBounds({ x: m.x, y: m.y, width: m.w, height: m.h });
    if (m.cmd === 'fullscreen') win.setSimpleFullScreen(!!m.on);
    if (m.cmd === 'quit') return app.quit();
    setTimeout(() => reply({ ok: true }), 50);
  });
});
