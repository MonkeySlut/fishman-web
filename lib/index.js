/**
 * Module dependencies
 */
const Npm = require('./providers/npm');
const async = require('async');

const basePath = '/';

/**
 * Download module and its dependencies from different package managers
 * @param {Object} options:
 *		packageManager: Package manager name
 *		module: Module name
 *		version: Version string
 *		basePath: Local or in-memory repository directory
 *		incDeps: Should download module dependencies
 *		incDevDeps: Should download module dev dependencies
 * @param {Object} result:
 *      stream: (socket.io-stream).createStream() object
 *      size: Length of above stream
 * @param {Function} cbUpdate Callback function (typeOfUpdate, content)
 */
function cloneModule(
    { packageManager, incDeps, incDevDeps, incTypes, modules },
    streamToWriteTo,
    cbUpdate
) {
    let provider = null;

    switch (packageManager) {
        case 'npm':
            provider = new Npm(incDeps, incDevDeps, incTypes, cbUpdate);
            break;
        default:
            provider = null;
            break;
    }

    if (!provider) {
        cbUpdate('criticalError', { message: 'this package manager is not supported!' });
    } else {
        let moduleFailed = 0;
        async.each(
            modules,
            (module, cbFinish) => {
                // If module name contains '/' char, replace it with '-'
                const path = provider.fileSystem.join(
                    basePath,
                    `${module.name.replace('/', '-')}${module.ver ? `-${module.ver}` : ''}`
                );
                async.waterfall(
                    [
                        callback => provider.fileSystem.mkdir(path, err => callback(err)),
                        callback => provider.cloneModule(module.name, module.ver, path, callback),
                    ],
                    err => {
                        if (err) {
                            cbUpdate('regularUpdate', {
                                message: `failed to cloned ${module.name} ${err.toString()}`,
                                color: 'red',
                            });
                            moduleFailed++;
                        }

                        if (moduleFailed == modules.length) {
                            return cbFinish('Failed to download packages');
                        }

                        cbFinish();
                    }
                );
            },
            err => {
                if (err) {
                    cbUpdate('criticalError', { message: `something wrong happened!! ${err.toString()}` });
                } else {
                    provider.getDownloadStreamFromBasePath(
                        streamToWriteTo,
                        basePath,
                        err => cbUpdate('criticalError', { message: `something wrong happened!! ${err.toString()}` })
                    );
                }
            }
        );
    }

    return provider;
}

exports.cloneModule = cloneModule;
