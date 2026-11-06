import {ESyslogEventFilter} from '@oi4/oi4-oec-service-model';

export interface ISettings {
    logging: ILogSettings;
    registry: IRegistrySettings;
}

export interface ILogSettings {
    auditLevel: ESyslogEventFilter;
    logType: ELogType;
    logFileSize: number;
}

export enum ELogType {
    enabled = 'enabled',
    disabled = 'disabled',
    endpoint = 'endpoint'
}

export interface IRegistrySettings {
    developmentMode: boolean;
    showRegistry: boolean;
}
