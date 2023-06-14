import {
    ESyslogEventFilter
} from '@oi4/oi4-oec-service-model';

import {
    defaultMAMFile,
    defaultSettingsPaths,
    ISettingsPaths
} from '@oi4/oi4-oec-service-node';

import path from 'path';
import { copyFileSync, existsSync,  mkdirSync } from 'fs';
import * as os from 'os';

export const isLocal = process.argv.length > 2 && process.argv[2] === 'local';

export const basePath = process.env.BASE_PATH || './../../docker_configs';

export const settingsPaths = (base: string): ISettingsPaths => {
    return isLocal ? {
        mqttSettings: {
            brokerConfig: `${base}/mqtt/broker.json`,
            caCertificate: `${base}/docker_configs/certs/ca.pem`,
            // privateKey: `${basePath}/secrets/mqtt_private_key.pem`,
            privateKey: undefined,
            // clientCertificate: `${basePath}/certs/oi4-oec-service-demo.pem`,
            clientCertificate: undefined,
            // passphrase: `${basePath}/secrets/mqtt_passphrase`,
            passphrase: undefined,
            credentials: `${base}/secrets/mqtt_credentials`
        },
        certificateStorage: `${base}/certs/`,
        secretStorage: `${base}/secrets`,
        applicationSpecificStorages: {
            configuration: `${base}/app`,
            data: `${base}/app`
        }
    } : defaultSettingsPaths;
};

export class StartupConfig {

    readonly settingsPaths: ISettingsPaths;
    private readonly basePath: string;

    constructor(basePath: string, paths: ISettingsPaths = settingsPaths(basePath)) {
        this.basePath = basePath;
        this.settingsPaths = paths;
    }

    public configFile(): string | undefined {
        const configFolder = this.settingsPaths.applicationSpecificStorages.configuration;
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

    public get mamFileLocation(): string {
        return isLocal ? `${this.basePath}/config/mam.json` : defaultMAMFile;
    }

    public get logLevel(): ESyslogEventFilter {
        return process.env.OI4_EDGE_LOG_LEVEL ? process.env.OI4_EDGE_LOG_LEVEL as ESyslogEventFilter | ESyslogEventFilter.warning : this.publishingLevel;
    }

    public get publishingLevel(): ESyslogEventFilter {
        return process.env.OI4_EDGE_EVENT_LEVEL as ESyslogEventFilter | ESyslogEventFilter.warning;
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
        return `${this.settingsPaths.secretStorage}/mqtt_private_key.pem`;
    }

    /**
     * Gets the file name of the certifcate file that is used for the REST-API.
     * @returns The file name of the certificate file that is used for the REST-API.
     */
    public get certFile(): string {
        return `${this.settingsPaths.certificateStorage}/${os.hostname()}.pem`;
    }

    public get licenseFile(): string {
        return path.join(__dirname, 'Resources', 'license.json');
    }

    public get licenseTextFile(): string {
        return path.join(__dirname, 'Resources', 'licenseText.json');
    }

}
