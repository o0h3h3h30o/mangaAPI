/**
 * Parser Registry
 * Auto-loads all parser files and provides lookup by URL or name
 */
const fs = require('fs');
const path = require('path');

const SKIP_FILES = ['index.js', 'base.js', 'template.js'];

// Auto-load all parser .js files in this directory
const parsers = [];
const dir = __dirname;

for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js') || SKIP_FILES.includes(file)) continue;
    const mod = require(path.join(dir, file));
    if (mod.name && typeof mod.match === 'function') {
        parsers.push(mod);
    }
}

/**
 * Get parser that matches a URL
 */
function getParser(url) {
    const found = parsers.find(p => p.match(url));
    if (!found) throw new Error(`No parser found for URL: ${url}`);
    return found;
}

/**
 * Get all registered parsers
 */
function getAllParsers() {
    return parsers;
}

/**
 * Get parser by name
 */
function getParserByName(name) {
    const found = parsers.find(p => p.name === name);
    if (!found) throw new Error(`No parser found with name: ${name}`);
    return found;
}

module.exports = {
    getParser,
    getAllParsers,
    getParserByName,
};
