	document.getElementById('terminal').focus();
	
	const xLogoScale = 15;
	const yLogoScale = 8;
	      
	const xWaveScale = 5;
    const yWaveScale = 5;
    const arrArgs = ['--modules', '-m', '--pm', '--deps', '--dev', '--t'];
	
	var windowWidth = window.innerWidth;
	var windowHeight = window.innerHeight;
	
	var sitelogo = document.getElementById('fishmanLogo');
	var wave = document.getElementById('wave');
	
	document.onmousemove = function (e) {
		var ratioX = e.pageX / (windowWidth / 2) - 1;
		var ratioY = e.pageY / (windowHeight / 2) - 1;
		
		var logoX = ratioX * xLogoScale / 2;
		var logoY = ratioY * yLogoScale / 2;
		
		var waveX = ratioX * xWaveScale / 2 * (-1);
		var waveY = ratioY * yWaveScale / 2 * (-1);
		
		sitelogo.style.transform = 'translate(' + logoX + 'px, ' + logoY + 'px)';
		wave.style.backgroundPositionX = waveX + 'px';
		wave.style.backgroundPositionY = 'calc(100% + (' + waveY + 'px))';
	};
	
	var printProgress = function (term, percent) {
        if(percent <= 100) {
            var width = term.cols() - 10;
            var size = Math.round(width * percent / 100);
            var left = '', taken = '', i;
            for (i = size; i--;) {
                taken += '#';
            }
            
            for (i = width-size; i--;) {
                left += '-';
            }
            
            term.set_prompt('[' + taken + left + '] ' + percent + '%');

            if(percent == 100) {
                term.set_prompt('> fishman ');
            }
        }
    }

    const getFileName = function(){
        const now = new Date();
        const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        const time = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
        return `${date}_${time}.tar`;
    }

    var downloadFileFromBlob = (function () {
        var a = document.createElement("a");
        document.body.appendChild(a);
        a.style = "display: none";
        return function (data, fileName) {
            var blob = new Blob(data, {
                type : "octet/stream"
            });
            var url = window.URL.createObjectURL(blob);
            a.href = url;
            a.download = fileName;
            a.click();
            window.URL.revokeObjectURL(url);
        };
    }());

    $('#terminal').terminal(function (command, term) {
        var socket = io.connect();
        var domCounterLimit = 100;
        var domCounterBuffer = 5;
        var domCounter = 0;
        var fileLength = 0;
        fileBuffer = [];
        socket.on('finalDownloadToClientMD', function(streamSize) {
            ss(socket).on('finalDownloadToClient', function (stream) {
                stream.on('data',function(chunk) {
                    fileLength += chunk.length;
                    fileBuffer.push(chunk);
                    var precentage = ((fileLength / streamSize) * 100).toFixed(2);
                    printProgress(term, precentage);
                });

                stream.on('end', function () {
                    printProgress(term, 100);
                    var filedata = new Uint8Array(fileLength),
                    i = 0;

                    //== Loop to fill the final array
                    fileBuffer.forEach(function (buff) {
                        for (var j = 0; j < buff.length; j++) {
                                filedata[i] = buff[j];
                                    i++;
                            }
                    });

                    //== Download file in browser
                    downloadFileFromBlob([filedata], getFileName());
                });
            });          
        });

        socket.on('criticalError', function (error) {
            term.error(error.message);
        });

        socket.on('regularUpdate', function (update) {
            if (domCounter + domCounterBuffer >= domCounterLimit) {
                term.echo('!terminal will clear soon to keep DOM lightweight!');

                if (domCounter == domCounterLimit) {
                    term.clear();
                    domCounter = 0;
                    term.echo('!DOM cleared!')
                }
            }
            term.echo('[[;'+update.color+';]'+update.message+']');
            domCounter++;
        });

        socket.on('downloadProgress', function (update) {
                printProgress(term, update.percentage);
        });

        if (command !== '') {
            var parsed = $.terminal.parse_command ('fishaman ' + command);
            var pm, modulesArr = [], incTypes = true, incDeps = true, incDevDeps = false;
            let index = 0;
            while(index < parsed.args.length) {
                if (parsed.args[index] == arrArgs[0] || parsed.args[index] == arrArgs[1]) {
                    for (let j = index + 1; j < parsed.args.length && arrArgs.indexOf(parsed.args[j]) === -1; j++) {
                        modulesArr.push(parsed.args[j]);
                        index++;
                    }
                    
                    index++;
                }
                else {
                    if (parsed.args[index] == arrArgs[2]) {
                        pm = parsed.args[index+1];
                    } else if (parsed.args[index] == arrArgs[3]) {
                        incDeps = parsed.args[index+1] === 'true';
                    } else if (parsed.args[index] == arrArgs[4]) {
                        incDevDeps = parsed.args[index+1] === 'true';
                    } else if (parsed.args[index] == arrArgs[5]) {
                        incTypes = parsed.args[index+1] === 'true';
                    } else {
                        term.error ('wrong input "' + parsed.args[i] +'"');
                    }

                    index += 2;
                }
            }

            if(pm && modulesArr) {
                const modulesObj = modulesArr.map(m => {
                    const arrNameVersion = m.split(":");
                    return { name: arrNameVersion[0], ver: arrNameVersion[1] }
                })
                const request = {
                    pm : pm,
                    modules : modulesObj,
                    incDeps: incDeps,
                    incDevDeps: incDevDeps,
                    incTypes: incTypes
                }

                socket.emit('fishmanRequest', request);
            } else {
                term.error ('--pm and --modules is required');
            }
        } else {
            term.echo('');
        }
    }, {
        greetings: '',
        name: 'js_demo',
        height: $(window).height() * 0.25,
        prompt: '> fishman '
    });