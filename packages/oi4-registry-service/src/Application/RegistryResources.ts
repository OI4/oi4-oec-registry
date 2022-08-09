import { OI4ApplicationResources } from '@oi4/oi4-oec-service-node';
import { IContainerConfig, 
    License, 
    LicenseText, 
    Resource, 
    ESyslogEventFilter, 
    IContainerConfigGroupName,
    IContainerConfigConfigName} from '@oi4/oi4-oec-service-model';
import { ISettings, ELogType} from './Models/ISettings';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { StartupConfig } from './StartupConfig';


export class RegistryResources extends OI4ApplicationResources
{
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
        super(StartupConfig.mamFile());

        this.once('resourceChanged', (res: string) => {
            if (res == 'config') {
                const oldSettings = this._settings;
                const newSettings = this.getSettingsFromConfig(this.config);
                if (newSettings != undefined) {
                    if (!this.areEqual(oldSettings, newSettings)) {
                        this.writeConfig();
                    }

                    this.settings = newSettings;
                    this.emit('settingsChanged', oldSettings, this._settings);
                }
            }
        })

        this.loadLicenses();
        const isConfigLoaded = this.loadConfig();
        this.initProfile(isConfigLoaded);
    }

    public get settings(): ISettings {
        return this._settings;
    }

    private set settings(settings: ISettings) {
        this._settings = settings;
    }

    private initProfile(addConfig: boolean): void {
        // profile (contains allready the mandatory resources for an application) 
        this.profile.resource.push(Resource.SUBSCRIPTION_LIST);
        if (addConfig) {
            this.profile.resource.push(Resource.CONFIG);
        }
        this.profile.resource.push(Resource.EVENT);
    }

    private loadLicenses(): void {
        // license
        const licenseFile = StartupConfig.licenseFile();
        if (existsSync(licenseFile)) {
            const texts = JSON.parse(readFileSync(licenseFile, 'utf-8'));
            for (const text of texts) {
                const license = License.clone(text);
                this.license.push(license);
            }   
        }

        // license text
        const licenseTextFile = StartupConfig.licenseTextFile();
        if (existsSync(licenseTextFile)) {
            const texts = JSON.parse(readFileSync(licenseTextFile, 'utf-8')) as ({licenseId: string; licenseText: string})[];
            for (const text of texts) {
                this.licenseText.set(text.licenseId, new LicenseText(text.licenseText));
            }
        }
    }

    private loadConfig(): boolean {
        const configFile = StartupConfig.configFile();
        if (configFile && existsSync(configFile)) {
            const config: IContainerConfig = JSON.parse(readFileSync(configFile, 'utf-8'));
            this.config = config;
            return true;
        }

        return false;
    }

    private writeConfig(): void {
        try {
            const configFile = StartupConfig.configFile();
            if (configFile && existsSync(configFile)) {
                writeFileSync(configFile, Buffer.from(JSON.stringify(this.config, null, 4)));
            }
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

    private areEqual(a: ISettings, b: ISettings): boolean  {
        return a.logging.auditLevel == b.logging.auditLevel &&
            a.logging.logFileSize == b.logging.logFileSize &&
            a.logging.logType == b.logging.logType &&
            a.registry.developmentMode == b.registry.developmentMode &&
            a.registry.showRegistry == b.registry.showRegistry;
    }
}