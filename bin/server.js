#!/usr/bin/env Node

const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const fishmanWeb = require('../lib');
const streamBuffers = require('stream-buffers');
const path = require('path'); //used only for express to serve statics

app.use(express.static(path.join(__dirname, '..', 'public')));

const port = process.env.PORT || 8080;
server.listen(port, () => {
    console.log(`open http://localhost:${port}/`);
});

io.on('connection', socket => {
    let provider = null;

    socket.on('fishmanRequest', request => {
        const options = {
            packageManager: request.pm,
            modules: request.modules,
            incDeps: request.incDeps,
            incDevDeps: request.incDevDeps,
            incTypes: request.incTypes,
        };

        let finalDownload = new streamBuffers.WritableStreamBuffer({
            initialSize: (100 * 1024 * 4),   // start at 400 kilobytes.
            incrementAmount: (100 * 1024) // grow by 100 kilobytes each time buffer overflows.
        });

        // TODO move updates to event handler on provider
        provider = fishmanWeb.cloneModule(options, finalDownload, (typeOfUpdate, content) => {
            switch (typeOfUpdate) {
                case 'downloadProgress':
                    socket.emit(typeOfUpdate, content);
                    break;
                case 'regularUpdate':
                    content.message = decodeURIComponent(content.message);
                    socket.emit(typeOfUpdate, content); //decode
                    break;
                case 'criticalError':
                    content.message = decodeURIComponent(content.message);
                    socket.emit(typeOfUpdate, content); //decode
                    socket.disconnect();
                    break;
                case 'finalDownloadToClient':
                    socket.emit(typeOfUpdate, finalDownload.getContents());
                    break;
                default:
                    console.log(`this should never happen - typeOfUpdate ${typeOfUpdate} did not match!`);
            }
        });
    });

    socket.on('disconnect', () => {
        // known bug: disconnect happens randomly, commented out for now
        // console.log(`User Disconnected. Cancelling request.`);
        // if (provider) {
        //     provider.cancel();
        // }
    });
});
