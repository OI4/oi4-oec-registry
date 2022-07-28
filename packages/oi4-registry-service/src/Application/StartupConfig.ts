import {ESyslogEventFilter} from '@oi4/oi4-oec-service-model';

export class StartupConfig {

    public static readonly LICENSE_FILE = '/etc/oi4/app/license.json';
    public static readonly LICENSE_TEXT_FILE = '/etc/oi4/app/licenseText.json';
    public static readonly CONFIG_FILE = '/etc/oi4/app/config.json';
    public static readonly MAM_FILE = '/etc/oi4/app/mam.json';


    public get logLevel(): ESyslogEventFilter {
        return process.env.OI4_EDGE_LOG_LEVEL ? process.env.OI4_EDGE_LOG_LEVEL as ESyslogEventFilter | ESyslogEventFilter.warning : this.publishingLevel;
    }

    public get publishingLevel(): ESyslogEventFilter {
        return process.env.OI4_EDGE_EVENT_LEVEL as ESyslogEventFilter | ESyslogEventFilter.warning;
    }

    public get mqttMaxMessageSize(): number {
        if (process.env.OI4_EDGE_MQTT_MAX_MESSAGE_SIZE) {
            const size = Number.parseInt(process.env.OI4_EDGE_MQTT_MAX_MESSAGE_SIZE, 10);
            if (size > 1000) {
                return size;
            }
        }
        return 262144;
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
        return `${this.certPath}/key.pem`;
    }

    /**
     * Gets the file name of the certifcate file that is used for the REST-API.
     * @returns The file name of the certificate file that is used for the REST-API.
     */
    public get certFile(): string {
        return `${this.certPath}/cert.pem`;
    }

    private get certPath(): string {
        // TODO win32: should not be hard coded / fixed / better make it relative
        // TODO use oi4 compatible path, e.g. /etc/oi4/app/certs
        return  process.platform === 'win32' ? 'C:/certs' : '/usr/local/share/oi4registry/cert';
    }
}