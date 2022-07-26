import { OI4ApplicationResources, DEFAULT_MAM_FILE } from "@oi4/oi4-oec-service-node/";
import { IContainerConfig, 
    License, 
    LicenseText, 
    Resource, 
    ESyslogEventFilter, 
    IContainerConfigGroupName,
    IContainerConfigConfigName} from '@oi4/oi4-oec-service-model';
import { ISettings, ELogType} from './Models/ISettings';
import { existsSync, fstat, readFileSync, writeFileSync } from 'fs';


export class RegistryResources extends OI4ApplicationResources
{
    private static readonly LICENSE_FILE = '/etc/oi4/config/license.json';
    private static readonly LICENSE_TEXT_FILE = '/etc/oi4/config/licenseText.json';
    private static readonly CONFIG_FILE = '/etc/oi4/config/config.json';

    private static readonly AUDIT_LEVEL_DEFAULT = ESyslogEventFilter.warning;
    private static readonly LOG_TYPE_DEFAULT = ELogType.disabled;
    private static readonly LOG_FILE_SIZE_DEFAULT = 250000;
    private static readonly DEVELOPMENT_MODE_DEFAULT = false;
    private static readonly SHOW_REGISTRY_DEFAULT = true;


    private _settings: ISettings = {
        logging: {
            auditLevel: RegistryResources.AUDIT_LEVEL_DEFAULT,
            logType: RegistryResources.LOG_TYPE_DEFAULT,
            logFileSize: RegistryResources.LOG_FILE_SIZE_DEFAULT
        },
        registry: {
            developmentMode: RegistryResources.DEVELOPMENT_MODE_DEFAULT,
            showRegistry: RegistryResources.SHOW_REGISTRY_DEFAULT
        }
    };

    constructor()
    {
        super(DEFAULT_MAM_FILE);

        this.once('resourceChanged', (res: string) => {
            if (res == 'config') {
                const oldSettings = this._settings;
                const newSettings = this.getSettingsFromConfig(this.config);
                if (newSettings != undefined)
                {
                    if (!this.areEqual(oldSettings, newSettings))
                    {
                        this.writeConfig();
                    }

                    this.settings = newSettings;
                    this.emit('settingsChanged', oldSettings, this._settings);
                }
            }
        })

        this.loadLicenses();
        this.loadConfig();
        this.initProfile();

    }

    public get settings(): ISettings
    {
        return this._settings;
    }

    private set settings(settings: ISettings)
    {
        this._settings = settings;
    }

    private initProfile(): void
    {
        // profile (contains allready the mandatory resources for an application) 
        this.profile.resource.push(Resource.SUBSCRIPTION_LIST);
        this.profile.resource.push(Resource.CONFIG);
        this.profile.resource.push(Resource.EVENT);
    }

    private loadLicenses(): void
    {
        // license
        if (existsSync(RegistryResources.LICENSE_FILE)) {
            const texts = JSON.parse(readFileSync(RegistryResources.LICENSE_FILE, 'utf-8'));
            for (const text of texts) {
                const license = License.clone(text);
                this.license.push(license);
            }   
        }

        // license text
        if (existsSync(RegistryResources.LICENSE_TEXT_FILE)) {
            const texts = JSON.parse(readFileSync(RegistryResources.LICENSE_TEXT_FILE, 'utf-8')) as ({licenseId: string; licenseText: string})[];
            for (const text of texts) {
                this.licenseText.set(text.licenseId, new LicenseText(text.licenseText));
            }
        }
    }

    private loadConfig(): void {
        if (existsSync(RegistryResources.CONFIG_FILE)) {
            const config: IContainerConfig = JSON.parse(readFileSync(RegistryResources.CONFIG_FILE, 'utf-8'));
            this.config = config;
        }
    }

    private writeConfig(): void {
        try {
            writeFileSync(RegistryResources.CONFIG_FILE, Buffer.from(JSON.stringify(this.config, null, 4)));
        }
        catch (e) {
            console.log(e);
        }
    }

    private getSettingsFromConfig(config: IContainerConfig): ISettings | undefined {
        const auditLevel = ESyslogEventFilter[this.getValue(config, 'logging', 'auditLevel') as keyof typeof ESyslogEventFilter];
        if (auditLevel === undefined) {
            console.log('Config setting auditLevel is invalid.');
            return; 
        }

        const logType = ELogType[this.getValue(config, 'logging', 'logType') as keyof typeof ELogType];
        if (logType === undefined) {
            console.log('Config setting logType is invalid.');
            return;
        }

        const logFileSize = Number(this.getValue(config, 'logging', 'logFileSize'));
        if (Number.isNaN(logFileSize) || !Number.isFinite(logFileSize) ||  logFileSize < 1024) {
            console.log('Config setting logFileSize is invalid.');
            return;
        }

        const developmentModeString = this.getValue(config, 'registry', 'developmentMode');
        if (developmentModeString != 'true' && developmentModeString != 'false') {
            console.log('Config setting developmentMode is invalid.');
            return;
        }

        const developmentMode = developmentModeString === 'true';

        const showRegistryString = this.getValue(config, 'registry', 'showRegistry');
        if (showRegistryString != 'true' && showRegistryString != 'false') {
            console.log('Config setting showRegistry is invalid.');
            return;
        }

        const showRegistry = showRegistryString === 'true';

        return { 
            logging: {
                auditLevel: auditLevel,
                logType: logType,
                logFileSize: logFileSize
            },
            registry: {
                developmentMode: developmentMode,
                showRegistry: showRegistry
            }
        }
    }

    private getValue(config: IContainerConfig, groupName: string, settingName: string): string {
        return ((config?.[groupName] as IContainerConfigGroupName)?.[settingName] as IContainerConfigConfigName)?.value;
    }

    private areEqual(a: ISettings, b: ISettings): boolean
    {
        return a.logging.auditLevel == b.logging.auditLevel &&
            a.logging.logFileSize == b.logging.logFileSize &&
            a.logging.logType == b.logging.logType &&
            a.registry.developmentMode == b.registry.developmentMode &&
            a.registry.showRegistry == b.registry.showRegistry;
    }
}