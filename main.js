const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const tmi = require('tmi.js');
const Store = require('electron-store');

const store = new Store();
let mainWindow;
let client;
let currentChannel = null;
let linkQueue = [];
let isQueueOpen = true; 
let savedBans = store.get('bannedUsers', []); 
let banList = new Set(savedBans); 

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 350,
        height: 700,
        backgroundColor: '#1a1a1a',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: false 
        }
    });
    
    session.defaultSession.setUserAgent(USER_AGENT);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile('index.html');

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('update-ban-list', Array.from(banList));
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

function updateBanList(user, isBanning) {
    if (!user) return;
    const targetUser = user.toLowerCase().replace('@', ''); 
    
    if (isBanning) {
        banList.add(targetUser);
        // Clean queue if banned
        linkQueue = linkQueue.filter(item => item.user.toLowerCase() !== targetUser);
        if (mainWindow) mainWindow.webContents.send('update-queue', linkQueue);
    } else {
        banList.delete(targetUser);
    }
    
    const listArray = Array.from(banList);
    store.set('bannedUsers', listArray); 
    if (mainWindow) mainWindow.webContents.send('update-ban-list', listArray);
}

ipcMain.on('ban-user', (event, username) => updateBanList(username, true));
ipcMain.on('unban-user', (event, username) => updateBanList(username, false));

ipcMain.on('join-channel', async (event, channelName) => {
    if (!channelName) return;
    const sanitizedChannel = channelName.replace('#', '').toLowerCase();
    linkQueue = [];

    if (client) await client.disconnect().catch(() => {});
    client = new tmi.Client({ channels: [sanitizedChannel] });
    
    client.on('message', (channel, tags, message, self) => {
        if (self) return;
        const username = tags['username'].toLowerCase();
        const isMod = tags.mod || (tags.badges && tags.badges.broadcaster === '1');

        if (isMod) {
            if (message.startsWith('%ban ')) {
                updateBanList(message.split(' ')[1], true);
                return;
            }
            
            if (message.startsWith('%remove ')) {
                const target = message.split(' ')[1]?.toLowerCase().replace('@', '');
                if (target) {
                    linkQueue = linkQueue.filter(item => item.user.toLowerCase() !== target);
                    if (mainWindow) mainWindow.webContents.send('update-queue', linkQueue);
                }
                return;
            }

            if (message.startsWith('%unban ')) {
                updateBanList(message.split(' ')[1], false);
                return;
            }
        }
        
        if (!isQueueOpen || banList.has(username)) return;

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
                    id: 'wv-' + Date.now() + Math.random().toString(36).substr(2, 9), 
                    clicked: false 
                };
                linkQueue.push(linkData);
                mainWindow.webContents.send('update-queue', linkQueue);
            });
        }
    });

    client.connect().then(() => {
        currentChannel = sanitizedChannel;
        if (mainWindow) mainWindow.webContents.send('status-update', currentChannel);
    }).catch(console.error);
});

ipcMain.on('remove-link', (event, id) => {
    linkQueue = linkQueue.filter(item => item.id !== id);
    if (mainWindow) mainWindow.webContents.send('update-queue', linkQueue);
});

ipcMain.on('next-link', () => {
    linkQueue = linkQueue.filter(item => !item.clicked);
    const nextItem = linkQueue.find(item => !item.clicked);
    if (nextItem) {
        nextItem.clicked = true; 
        shell.openExternal(nextItem.url);
        if (mainWindow) mainWindow.webContents.send('update-queue', linkQueue);
    }
});

ipcMain.on('load-link-by-id', (event, id) => {
    const itemToLoad = linkQueue.find(item => item.id === id);
    if (itemToLoad) {
        itemToLoad.clicked = true; 
        shell.openExternal(itemToLoad.url);
        if (mainWindow) mainWindow.webContents.send('update-queue', linkQueue);
    }
});

ipcMain.on('request-initial-data', (event) => {
    event.reply('update-ban-list', Array.from(banList));
});