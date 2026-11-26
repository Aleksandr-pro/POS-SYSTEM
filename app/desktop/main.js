/* ============================================================
   POS Контроль — настольная версия для Windows
   ============================================================ */

const { app, BrowserWindow, Menu, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'POS Контроль';
const INDEX = path.join(__dirname, 'app', 'index.html');

let mainWindow = null;

/* ---------- сохранение размера и положения окна ---------- */
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8');
    const st = JSON.parse(raw);
    if (st && st.width > 800 && st.height > 600) return st;
  } catch (e) {}
  return { width: 1440, height: 920 };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: win.isMaximized()
    }));
  } catch (e) {}
}

/* ---------- меню ---------- */
function buildMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Открыть папку данных',
          click: () => shell.openPath(app.getPath('userData'))
        },
        {
          label: 'Папка загрузок',
          click: () => shell.openPath(app.getPath('downloads'))
        },
        { type: 'separator' },
        { label: 'Выход', role: 'quit', accelerator: 'Alt+F4' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', role: 'undo' },
        { label: 'Повторить', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' },
        { label: 'Выделить всё', role: 'selectAll' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Обновить', role: 'reload', accelerator: 'F5' },
        { type: 'separator' },
        { label: 'Увеличить', role: 'zoomIn', accelerator: 'CommandOrControl+Plus' },
        { label: 'Уменьшить', role: 'zoomOut', accelerator: 'CommandOrControl+-' },
        { label: 'Обычный масштаб', role: 'resetZoom', accelerator: 'CommandOrControl+0' },
        { type: 'separator' },
        { label: 'Полный экран', role: 'togglefullscreen', accelerator: 'F11' },
        { label: 'Строка меню', role: 'toggleMenuBar' },
        { label: 'Инструменты разработчика', role: 'toggleDevTools', accelerator: 'Ctrl+Shift+I', visible: true }
      ]
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'О программе',
              message: APP_NAME,
              detail: [
                'Версия: ' + app.getVersion(),
                'Продажи, склад, время и аналитика. Работает офлайн.',
                '',
                'Данные хранятся на этом компьютере:',
                app.getPath('userData'),
                '',
                'Горячие клавиши:',
                'Ctrl+K — поиск по системе',
                'Ctrl+B — свернуть меню',
                'Alt+1…9 — разделы',
                'F11 — полный экран'
              ].join('\n'),
              buttons: ['OK'],
              noLink: true
            });
          }
        },
        {
          label: 'Руководство',
          click: () => {
            if (mainWindow) mainWindow.webContents.executeJavaScript("location.hash = '#/help'");
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- сохранение файлов (Excel, JSON) ---------- */
function setupDownloads() {
  session.defaultSession.on('will-download', (event, item) => {
    const suggested = item.getFilename();
    const result = dialog.showSaveDialogSync(mainWindow, {
      title: 'Сохранить файл',
      defaultPath: path.join(app.getPath('downloads'), suggested),
      filters: [
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'Все файлы', extensions: ['*'] }
      ]
    });
    if (!result) {
      item.cancel();
      return;
    }
    item.setSavePath(result);
    item.once('done', (e, state) => {
      if (state === 'completed' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(
          "window.toast && toast('Файл сохранён: " + JSON.stringify(path.basename(result)).slice(1, -1) + "', 'success', 4200)"
        ).catch(() => {});
      }
    });
  });
}

/* ---------- окно ---------- */
function createWindow() {
  const st = loadWindowState();

  mainWindow = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f5fa',
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false
    }
  });

  if (st.maximized) mainWindow.maximize();
  mainWindow.loadFile(INDEX);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  // внешние ссылки — в браузер, а не в приложении
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('render-process-gone', () => {
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Приложение перезапустится',
      message: 'Окно приложения было закрыто из-за ошибки. Данные сохранены.',
      buttons: ['Перезапустить']
    }).then(() => mainWindow && mainWindow.reload());
  });
}

/* ---------- запуск ---------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('kz.poskontrol.desktop');
    buildMenu();
    setupDownloads();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
