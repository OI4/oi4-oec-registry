const rootDir = '.';
const masterConfig = require(`../../package.json`);
console.log(masterConfig);
const fs = require('fs');

let currentDir = `${rootDir}/OI4-Cockpit-UI/package.json`;
let packageJsonLoc = readJSON(currentDir);
packageJsonLoc.version = masterConfig.version;
fs.writeFileSync(currentDir, `${JSON.stringify(packageJsonLoc, null, 2)}\n`);

currentDir = `${rootDir}/OI4-Local-UI/package.json`
packageJsonLoc = readJSON(currentDir);
packageJsonLoc.version = masterConfig.version;
fs.writeFileSync(currentDir, `${JSON.stringify(packageJsonLoc, null, 2)}\n`);

currentDir = `${rootDir}/OI4-Service/package.json`
packageJsonLoc = readJSON(currentDir);
packageJsonLoc.version = masterConfig.version;
fs.writeFileSync(currentDir, `${JSON.stringify(packageJsonLoc, null, 2)}\n`);

currentDir = `${rootDir}/OI4-Service/src/Service/src/Config/masterAssetModel.json`
packageJsonLoc = readJSON(currentDir);
packageJsonLoc.SoftwareRevision = masterConfig.version;
fs.writeFileSync(currentDir, `${JSON.stringify(packageJsonLoc, null, 2)}`);

currentDir = `${rootDir}/OI4-Service/src/Service/package.json`;
packageJsonLoc = readJSON(currentDir);
packageJsonLoc.version = masterConfig.version;
fs.writeFileSync(currentDir, `${JSON.stringify(packageJsonLoc, null, 2)}`);

function readJSON(path) {
    const json = JSON.parse(fs.readFileSync(path));
    console.log(`Read JSON from Path: ${path} - ${JSON.stringify(json.version)}`);
    return json;
}