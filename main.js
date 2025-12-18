const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const tmi = require('tmi.js');

let mainWindow;
let client;
let currentChannel = null;
let linkQueue = [];
let currentLink = null;
let isQueueOpen = true; 

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';


function isYouTube(url) {
    return url.includes('youtube.com') || url.includes('youtu.be');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#1a1a1a',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,
            experimentalFeatures: true 
        }
    });
    
    session.defaultSession.setUserAgent(USER_AGENT);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('open-external', (event, url) => {
    if (url) shell.openExternal(url);
});

ipcMain.on('toggle-queue', (event, status) => {
    isQueueOpen = status;
});

ipcMain.on('join-channel', async (event, channelName) => {
    if (!channelName) return;
    const sanitizedChannel = channelName.replace('#', '').toLowerCase();
    currentLink = null;
    linkQueue = [];
    if (client) await client.disconnect().catch(() => {});

    client = new tmi.Client({ channels: [sanitizedChannel] });
    
    client.on('message', (channel, tags, message) => {
        if (!isQueueOpen) return;
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const foundLinks = message.match(urlRegex);

        if (foundLinks && mainWindow) {
            let role = "";
            if (tags['badges']) {
                if (tags['badges']['broadcaster']) role = "STREAMER";
                else if (tags['badges']['moderator']) role = "MOD";
                else if (tags['badges']['vip']) role = "VIP";
                else if (tags['badges']['subscriber']) role = "SUB";
            }

            foundLinks.forEach((link) => {
                const linkData = {
                    user: tags['display-name'],
                    role: role,
                    url: link,
                    id: Date.now() + Math.random()
                };

                if (!currentLink) {
                    currentLink = linkData;
                    // Check if the first link is YouTube
                    if (isYouTube(currentLink.url)) {
                        mainWindow.webContents.send('youtube-warning', currentLink);
                    }
                    mainWindow.webContents.send('load-url', currentLink);
                } else {
                    linkQueue.push(linkData);
                    mainWindow.webContents.send('update-queue', linkQueue);
                }
            });
        }
    });

    client.connect().then(() => {
        currentChannel = sanitizedChannel;
        if (mainWindow) {
            mainWindow.webContents.send('update-queue', linkQueue);
            mainWindow.webContents.send('status-update', currentChannel);
        }
    }).catch(console.error);
});

ipcMain.on('remove-link', (event, id) => {
    linkQueue = linkQueue.filter(item => item.id !== id);
    if (mainWindow) mainWindow.webContents.send('update-queue', linkQueue);
});

ipcMain.on('next-link', () => {
    if (!mainWindow) return;
    if (linkQueue.length > 0) {
        currentLink = linkQueue.shift();
        if (isYouTube(currentLink.url)) {
            mainWindow.webContents.send('youtube-warning', currentLink);
        }
        mainWindow.webContents.send('load-url', currentLink);
        mainWindow.webContents.send('update-queue', linkQueue);
    } else {
        currentLink = null;
        mainWindow.webContents.send('reset-view');
        mainWindow.webContents.send('update-queue', linkQueue);
    }
});

ipcMain.on('load-link-by-id', (event, id) => {
    const itemToLoad = linkQueue.find(item => item.id === id);
    if (itemToLoad && mainWindow) {
        currentLink = itemToLoad;
        if (isYouTube(currentLink.url)) {
            mainWindow.webContents.send('youtube-warning', currentLink);
        }
        mainWindow.webContents.send('load-url', currentLink);
        linkQueue = linkQueue.filter(item => item.id !== id);
        mainWindow.webContents.send('update-queue', linkQueue);
    }
});

ipcMain.on('clear-session', async () => {
    try {
        await session.defaultSession.clearStorageData();
        app.relaunch();
        app.exit();
    } catch (e) {
        console.error('Failed to clear session:', e);
    }
});