/**
 * Module dependencies
 */
const RegClient = require('npm-registry-client');
const os = require('os');
const path = require('path');
const client = new RegClient({
    registry: 'https://registry.npmjs.org/',
    cache: path.join(os.tmpdir(), '/', Math.random().toString(16).slice(2)),
});
const http = require('http');
const https = require('https');
const async = require('async');
const semver = require('semver');
const Provider = require('../provider');
const prefixModuleTypes = '@types%2f';

class NpmProvider extends Provider {
    /**
     * Create a new npm provider object
     * @class Npm Provider for npm modules
     * @param {Object} fileSystem Either fs or fs-compatible Object
     * @param {Boolean} incDeps Should download module dependencies
     * @param {Boolean} incDevDeps Should download module dev dependencies
     * @param {Function} cbUpdate Callback function (typeOfUpdate, content)
     */
    constructor(fileSystem, incDeps, incDevDeps, incTypes, cbUpdate) {
        super(fileSystem, incDeps, incDevDeps, incTypes, cbUpdate);
    }

    /**
     * Return path to the package file
     * @param {String} module Module name
     * @param {String} ver Version string
     * @param {String} path Current path
     * @return {String} path to the package file
     */
    getPackagePath(module, ver, path) {
        const dirPackage = this.getPackageFolder(path);
        return this.fileSystem.join(dirPackage, `${module}-${ver}.json`);
    }

    /**
     * Return path to the package folder
     * @param {String} path Current path
     * @return {String} path to the package folder
     */
    getPackageFolder(path) {
        return this.fileSystem.join(path, 'packages');
    }

    getTypesModuleIfExist(module, ver, path, callback) {
        // Skip if the Module is types module himself
        if (module.startsWith(prefixModuleTypes)) {
            return callback(null, ver);
        }

        const self = this;
        const moduleTypeName = `${prefixModuleTypes}${module}`;
        self.cloneSingleModule(moduleTypeName, ver, path, function(err, ver) {
            if (err) {
                if (err.statusCode === '404') {
                    self.cbUpdate('regularUpdate', {
                        message: `module for typescript not found, name:${moduleTypeName} version:${ver}`,
                        color: 'gray',
                    });
                } else {
                    self.cbUpdate('regularUpdate', {
                        message: `types for module ${module}:${ver} error: ${err.message}`,
                        color: 'gray',
                    });
                }
            }

            callback(null, ver);
        });
    }

    /**
     * Check if the module already exists (tar file)
     * @param {String} module Module name
     * @param {String} ver Version string
     * @param {String} path Current path
     * @param {Function} cb Callback function (err, exists)
     */
    isModuleExist(module, ver, path, cb) {
        const self = this;
        self.fileSystem.readdir(path, function(err, files) {
            if (err) {
                return cb(err);
            }

            let found = false;
            async.each(
                files,
                function(file, callback) {
                    if (file.substr(0, file.lastIndexOf('-')) == module) {
                        const installedVer = file.substr(file.lastIndexOf('-') + 1).replace('.tgz', '');
                        if (semver.valid(installedVer) && semver.satisfies(installedVer, ver)) {
                            found = true;
                        }
                    }
                    callback();
                },
                function(err) {
                    if (err) {
                        throw err;
                    }
                    cb(null, found);
                }
            );
        });
    }

    /**
     * Download a single module to local or in-memory repository
     * @param {String} module Module name
     * @param {String} ver Version string
     * @param {String} path Current path
     * @param {Function} callback Callback function (err)
     */
    cloneSingleModule(module, ver, path, callback) {
        const self = this;
        // var fullPath = this.fileSystem.join(path, module);
        let packageJson;
        async.waterfall(
            [
                function(callback) {
                    client.get(`https://registry.npmjs.org/${module}`, { timeout: 1000 }, function(err, pkg) {
                        callback(err, pkg);
                    });
                },
                function(pkg, callback) {
                    if (!pkg.versions) {
                        return callback(new Error(`Module ${module} is unpublished`));
                    }

                    if (!ver || ver === 'latest') {
                        self.cbUpdate('regularUpdate', {
                            message: `no version was specified for ${module}`,
                            color: 'gray',
                        });
                        if (pkg['dist-tags'] && pkg['dist-tags'].latest) {
                            ver = pkg['dist-tags'].latest;
                            self.cbUpdate('regularUpdate', {
                                message: `using the latest version of ${module}`,
                                color: 'gray',
                            });
                        } else {
                            const keys = Object.keys(pkg.versions);
                            ver = keys[keys.length - 1];
                            self.cbUpdate('regularUpdate', {
                                message: `there is no latest tag using the last version in the version object of ${module}`,
                                color: 'gray',
                            });
                        }
                    }
                    const versions = Object.keys(pkg.versions);
                    for (let i = versions.length; i > -1; i--) {
                        // TODO: use Array.prototype.find
                        if (semver.satisfies(versions[i], ver)) {
                            ver = versions[i];
                            break;
                        }
                    }

                    if (!pkg.versions[ver]) {
                        return callback(new Error(`No compatibale version was found for ${module} - ${ver}`));
                    }

                    packageJson = pkg.versions[ver];
                    self.cbUpdate('regularUpdate', {
                        message: `using version ${ver} for module ${module}`,
                        color: 'gray',
                    });

                    self.fileSystem.mkdir(self.getPackageFolder(path), function(err) {
                        if (err && err.code != 'EEXIST') {
                            return callback(err);
                        }

                        self.fileSystem.writeFile(
                            self.getPackagePath(module, ver, path),
                            JSON.stringify(packageJson, null, 4),
                            callback
                        );
                    });
                },
                function(callback) {
                    self.cbUpdate('regularUpdate', {
                        message: `downloading tarball of ${module}-${ver}`,
                        color: 'gray',
                    });
                    const file = self.fileSystem.createWriteStream(self.fileSystem.join(path, `${module}-${ver}.tgz`));

                    const downloadClient = packageJson.dist.tarball.indexOf('https://') > -1 ? https : http;

                    downloadClient.get(packageJson.dist.tarball, function(response) {
                        const len = parseInt(response.headers['content-length'], 10);
                        if (len > 2097152) {
                            let current = 0;
                            response.on('data', function(chunk) {
                                current += chunk.length;
                                self.cbUpdate('downloadProgress', { percentage: ((100 * current) / len).toFixed(2) });
                            });
                        }
                        response.pipe(file);
                        file.on('finish', function() {
                            file.end();
                            callback();
                        });
                    });
                },
            ],
            function(err) {
                callback(err, ver);
            }
        );
    }
}

module.exports = NpmProvider;
