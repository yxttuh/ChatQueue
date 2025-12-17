const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const tmi = require('tmi.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- STATE MANAGEMENT ---
let linkQueue = [];
let currentLink = null;
let currentChannel = null; // We start with no channel

// --- TWITCH SETUP ---
const client = new tmi.Client({
    channels: [] // Start empty
});

client.connect().catch(console.error);

client.on('message', (channel, tags, message, self) => {
    // Only accept messages from the currently active channel
    // (tmi.js handles channel names with a '#' prefix)
    if (currentChannel && channel === `#${currentChannel.toLowerCase()}`) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const foundLinks = message.match(urlRegex);

        if (foundLinks) {
            foundLinks.forEach((link) => {
                const linkData = {
                    user: tags['display-name'],
                    url: link,
                    id: Date.now() + Math.random()
                };
                
                linkQueue.push(linkData);
                // Send updated queue to frontend
                io.emit('updateQueue', linkQueue);
            });
        }
    }
});

// --- SOCKET.IO EVENTS ---
io.on('connection', (socket) => {
    // Send current state to new user
    socket.emit('updateQueue', linkQueue);
    socket.emit('viewLink', currentLink);
    // Tell the frontend which channel we are currently in
    socket.emit('statusUpdate', currentChannel || "None");

    // Handle Joining a new channel
    socket.on('joinChannel', async (newChannelName) => {
        if (!newChannelName) return;
        const sanitizedChannel = newChannelName.replace('#', '').toLowerCase();

        try {
            // 1. Leave old channel if exists
            if (currentChannel) {
                await client.part(currentChannel).catch(err => console.log("Error parting:", err));
            }

            // 2. Join new channel
            await client.join(sanitizedChannel);
            currentChannel = sanitizedChannel;

            console.log(`Switched to channel: ${currentChannel}`);

            // 3. Clear the queue (optional, but usually desired when switching streams)
            linkQueue = [];
            currentLink = null;

            // 4. Update everyone connected
            io.emit('updateQueue', linkQueue);
            io.emit('viewLink', null);
            io.emit('statusUpdate', currentChannel);

        } catch (err) {
            console.error("Could not join channel:", err);
        }
    });

    // Handle "Next Link"
    socket.on('next', () => {
        if (linkQueue.length > 0) {
            currentLink = linkQueue.shift();
            io.emit('viewLink', currentLink);
            io.emit('updateQueue', linkQueue);
        } else {
            currentLink = null;
            io.emit('viewLink', null);
        }
    });

    // Handle "Remove Link"
    socket.on('remove', (id) => {
        linkQueue = linkQueue.filter(item => item.id !== id);
        io.emit('updateQueue', linkQueue);
    });
});

server.listen(3000, () => {
    console.log('Server running at http://localhost:3000');
});