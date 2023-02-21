import {ESyslogEventFilter} from '@oi4/oi4-oec-service-model';
import path from 'path';
import { copyFileSync, existsSync,  mkdirSync } from 'fs';

export class StartupConfig {

    private readonly etcFolder;
    private readonly runFolder;

    constructor(etcFolder = '/etc', runFolder = '/run') {
        this.etcFolder = etcFolder;
        this.runFolder = runFolder;
    }

    public static mamFile(): string {
        return path.join(__dirname, 'Resources', 'mam.json');
    }

    public static licenseFile(): string {
        return path.join(__dirname, 'Resources', 'license.json');
    }

    public static licenseTextFile(): string {
        return path.join(__dirname, 'Resources', 'licenseText.json');
    }

    public static configFile(configFolder = '/etc/oi4/app/config.json'): string | undefined {
        const configFile = `${configFolder}/config.json`;
        if (!existsSync(configFile)) {
            try {
                mkdirSync(configFolder, {recursive: true});

                const templatePath = path.join(__dirname, 'Resources', 'config.json');
                copyFileSync(templatePath, configFile);
            } catch (err) {
                console.error(err);
            }
        }

        if (existsSync(configFile)) {
            return configFile;
        }
    }

    public get logLevel(): ESyslogEventFilter {
        return process.env.OI4_EDGE_LOG_LEVEL ? process.env.OI4_EDGE_LOG_LEVEL as ESyslogEventFilter | ESyslogEventFilter.warning : this.publishingLevel;
    }

    public get publishingLevel(): ESyslogEventFilter {
        return process.env.OI4_EDGE_EVENT_LEVEL as ESyslogEventFilter | ESyslogEventFilter.warning;
    }

    public get edgeApplicationPort(): number {
        if (process.env.OI4_EDGE_APPLICATION_PORT) {
            const port = Number.parseInt(process.env.OI4_EDGE_APPLICATION_PORT, 10);
            if (!Number.isNaN(port) && 0 < port && port < 65536) {
                return port;
            }
        }
        return 5799;
    }

    public get useOpenAPI(): boolean {
        if (!process.env.OI4_EDGE_APPLICATION_ENABLE_OPENAPI) {
            return true; // default is true
        }

        return process.env.OI4_EDGE_APPLICATION_ENABLE_OPENAPI === 'true';
    }

    /**
     * Determines whether the REST-API shall use a HTTPs connectior.
     * @returns true if a HTTPs connection shall be used; otherwise, false.
     */
    public get useHttps(): boolean {
        return process.env.USE_HTTPS && process.env.USE_HTTPS === 'true';
    }

    /**
     * Gets the file name of the key file that is used for the REST-API.
     * @returns The file name of the key file that is used for the REST-API.
     */
    public get keyFile(): string {
        return `${this.runFolder}/secrets/registry_private_key.pem`;
    }

    /**
     * Gets the file name of the certifcate file that is used for the REST-API.
     * @returns The file name of the certificate file that is used for the REST-API.
     */
    public get certFile(): string {
        return `${this.etcFolder}/oi4/registry_cert.pem`;
    }
}
