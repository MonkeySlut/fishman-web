/**
 * Module dependencies
 */
const async = require('async');
const tar = require('tar-stream');
const MemoryFileSystem = require('memory-fs');
const utils = require('./utils');

class Provider {
    /**
     * Initializes a new instance of Provider.
     * This is an abstract class that should not by instantiated directly.
     * @abstract
     * @class Provider Base class for package manager providers
     * @param {Boolean} incDeps Should download module dependencies
     * @param {Boolean} incDevDeps Should download module dev dependencies
     * @param {Boolean} incTypes Should download types module (like typescript module)
     * @param {Function} cbUpdate Callback function (typeOfUpdate, content)
     */
    constructor(incDeps, incDevDeps, incTypes, cbUpdate) {
        this.incDeps = incDeps;
        this.incDevDeps = incDevDeps;
        this.incTypes = incTypes;
        this.cbUpdate = cbUpdate;

        this.fileSystem = new MemoryFileSystem();
        this._isCancelled = false;
    }

    // Abstract methods

    /**
     * Return path to the package file
     * @param {String} module Module name
     * @param {String} ver Version string
     * @param {String} path current path
     * @return {String} path to the package file
     */
    getPackagePath(module, ver, path) {
        throw new Error('Abstract method!');
    }

    /**
     * Return path to the package folder
     * @param {String} path Current path
     * @return {String} path to the package folder
     */
    getPackageFolder(path) {
        throw new Error('Abstract method!');
    }

    /**
     * Download a type module to local or in-memory repository
     * @param {String} module Module name
     * @param {String} ver Version string
     * @param {String} path current path
     * @return {String} path to the package file
     */
    // TODO: remove to npm provider since only valid in JS/TS
    getTypesModuleIfExist(module, ver, path) {
        throw new Error('Abstract method!');
    }

    /**
     * Check if the module already exists
     * @param {String} module Module name
     * @param {String} ver Version string
     * @param {String} path Current path
     * @param {Function} callback Callback function (err, exists)
     */
    isModuleExist(module, ver, path, callback) {
        throw new Error('Abstract method!');
    }

    /**
     * Download a single module to local or in-memory repository
     * @abstract
     * @param {String} module Module name
     * @param {String} ver Version string
     * @param {String} path Current path
     * @param {Function} callback Callback function (err, ver)
     */
    cloneSingleModule(module, ver, path, callback) {
        callback(new Error('Abstract method!'));
    }

    // Implemented methods

    /**
     * Read the package metadata
     * @param {String} module Module name
     * @param {String} ver Version string
     * @param {String} path Current path
     * @param {Function} callback Callback function (err, package)
     */
    readPackage(module, ver, path, callback) {
        const packagePath = this.getPackagePath(module, ver, path);
        this.readPackageFromPath(packagePath, callback);
    }

    /**
     * Read the package metadata from a given path
     * @param {String} packagePath file path
     * @param {Function} callback Callback function (err, package)
     */
    readPackageFromPath(packagePath, callback) {
        this.fileSystem.exists(packagePath, exists => {
            let errorMessage, packageJson;
            if (exists) {
                this.fileSystem.readFile(packagePath, (error, fileContents) => {
                    if (error) throw error;
                    packageJson = JSON.parse(fileContents);
                    callback(null, packageJson);
                });
            } else {
                errorMessage = `package file couldn't be found: ${packagePath}`;
                this.cbUpdate('criticalError', { message: errorMessage });
                callback(new Error(errorMessage));
            }
        });
    }

    /**
     * Clone a package file
     * @abstract
     * @param {String} packagePath file path
     * @param {Function} callback Callback function (err)
     */
    clonePackageFile(packagePath, callback) {
        async.waterfall([callback => this.readPackageFromPath(packagePath, callback), this.clonePackage], callback);
    }

    /**
     * Clone a package
     * @abstract
     * @param {Object} packageDescriptor object
     * @param {Function} callback Callback function (err)
     */
    clonePackage(packageDescriptor, path, callback) {
        async.waterfall(
            [
                callback => {
                    if (this.incDeps && packageDescriptor && packageDescriptor.dependencies) {
                        this.cloneDeps(packageDescriptor.dependencies, path, callback);
                    } else {
                        callback();
                    }
                },
                callback => {
                    if (this.incDevDeps && packageDescriptor && packageDescriptor.devDependencies) {
                        this.cloneDeps(packageDescriptor.devDependencies, path, callback);
                    } else {
                        callback();
                    }
                },
            ],
            callback
        );
    }

    /**
     * Download module to local or in-memory repository
     * @param {String} module Module name
     * @param {String} ver Version string
     * @param {String} path Path for downloaded
     * @param {Function} callback Callback function (err)
     */
    cloneModule(module, ver, path, callback) {
        if (this._isCancelled) {
            return;
        }

        const escapedModule = utils.escapeModule(module);
        async.waterfall(
            [
                callback => this.cloneSingleModule(escapedModule, ver, path, callback),
                (ver, callback) => {
                    if (this.incTypes && !this._isCancelled) {
                        this.getTypesModuleIfExist(escapedModule, ver, path, callback);
                    } else {
                        callback(null, ver);
                    }
                },
                (ver, callback) => {
                    this.cbUpdate('regularUpdate', { message: `done cloning ${escapedModule}`, color: 'green' });
                    this.readPackage(escapedModule, ver, path, callback);
                },
                (packageDescriptor, callback) => {
                    this.clonePackage(packageDescriptor, path, callback);
                },
            ],
            callback
        );
    }

    /**
     * Download the dependencies of a module
     * @param {String[]} deps Array of dependencies name
     * @param {Function} callback Callback function (err)
     */
    cloneDeps(deps, path, callback) {
        if (!deps) {
            return callback();
        }

        async.eachSeries(
            Object.keys(deps),
            (dep, callback) => {
                const ver = deps[dep];

                // Not supporting cloning modules from git repositories yet.
                if (/^(git|http|https|ssh)\:.*/.test(ver)) {
                    return callback();
                }

                this.isModuleExist(dep, ver, path, (err, exists) => {
                    if (err) {
                        callback(err);
                    } else if (!exists) {
                        this.cloneModule(dep, ver, path, callback);
                    } else {
                        this.cbUpdate('regularUpdate', { message: `${dep} already exists`, color: 'gray' });
                        callback();
                    }
                });
            },
            callback
        );
    }

    getDownloadStreamFromBasePath(stream, path, callback) {
        const pack = tar.pack();
        const self = this;
        let totalSize = 0;
        function loopFolder(fullPath, callback) {
            self.fileSystem.readdir(fullPath, (err, files) => {
                if (err) {
                    throw err;
                }

                async.each(
                    files,
                    (file, cbNextFile) => {
                        const fileFakePath = self.fileSystem.join(fullPath, file);
                        self.fileSystem.stat(fileFakePath, (err, stat) => {
                            if (stat.isDirectory()) {
                                loopFolder(self.fileSystem.join(fullPath, file), cbNextFile);
                            } else {
                                self.fileSystem.readFile(fileFakePath, (err, contents) => {
                                    totalSize += contents.length;
                                    pack.entry({ name: fileFakePath }, contents, err => {
                                        if (err) {
                                            throw err;
                                        }

                                        cbNextFile();
                                    });
                                });
                            }
                        });
                    },
                    err => {
                        if (err) {
                            throw err;
                        }

                        callback();
                    }
                );
            });
        }

        async.waterfall(
            [
                cbFinishedAllFolders => loopFolder(path, cbFinishedAllFolders),
                cbFinishedPacking => {
                    pack.finalize();
                    pack.pipe(stream.stream);
                    this.cbUpdate('regularUpdate', { message: 'finished packing, starting download', color: 'green' });
                    stream.size = totalSize;
                    cbFinishedPacking();
                },
            ],
            () => this.cbUpdate('finalDownloadToClient')
        );
    }

    cancel() {
        this._isCancelled = true;
    }
}

module.exports = Provider;
