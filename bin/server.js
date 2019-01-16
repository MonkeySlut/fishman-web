#!/usr/bin/env Node

const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const memoryFileSystem = require('memory-fs');
const ss = require('socket.io-stream');
const fishmanWeb = require('../lib');
const path = require('path'); //used only for express to serve statics

app.use(express.static(path.join(__dirname, '..', 'public')));

const port = process.env.PORT || 8080;
server.listen(port, () => {
    console.log(`open http://localhost:${port}/`);
});

io.on('connection', socket => {
    socket.on('fishmanRequest', request => {
        const options = {
            packageManager: request.pm,
            modules: request.modules,
            incDeps: request.incDeps,
            incDevDeps: request.incDevDeps,
            incTypes: request.incTypes,
            basePath: '/',
        };

        const fileSystem = new memoryFileSystem();

        let finalDownload = {
            stream: ss.createStream(),
            size: 0,
        };

        fishmanWeb.cloneModule(options, fileSystem, finalDownload, (typeOfUpdate, content) => {
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
                    socket.emit('finalDownloadToClientMD', finalDownload.size);
                    ss(socket).emit(typeOfUpdate, finalDownload.stream);
                    break;
                default:
                    console.log(`this should never happen - typeOfUpdate ${typeOfUpdate} did not match!`);
            }
        });
    });

    //TODO
    /*
    socket.on('disconnect', () => {
    });
    */
});
