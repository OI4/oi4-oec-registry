import { OI4ApplicationResources, DEFAULT_MAM_FILE } from "@oi4/oi4-oec-service-node/";
import {IContainerConfig, License, LicenseText, Resource} from '@oi4/oi4-oec-service-model';
import { existsSync, readFileSync } from 'fs';


export class RegistryResources extends OI4ApplicationResources
{
    private readonly LICENSE_FILE = '/etc/oi4/config/license.json';
    private readonly LICENSE_TEXT_FILE = '/etc/oi4/config/licenseText.json';
    private readonly CONFIG_FILE = '/etc/oi4/config/config.json';

    constructor()
    {
        super(DEFAULT_MAM_FILE);

        this.loadLicenses();
        this.loadConfig();
        this.initProfile();

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
        if (existsSync(this.LICENSE_FILE)) {
            const texts = JSON.parse(readFileSync(this.LICENSE_FILE, 'utf-8'));
            for (const text of texts) {
                const license = License.clone(text);
                this.license.push(license);
            }   
        }

        // license text
        if (existsSync(this.LICENSE_TEXT_FILE)) {
            const texts = JSON.parse(readFileSync(this.LICENSE_TEXT_FILE, 'utf-8')) as ({licenseId: string; licenseText: string})[];
            for (const text of texts) {
                this.licenseText.set(text.licenseId, new LicenseText(text.licenseText));
            }
        }
    }

    private loadConfig(): void
    {
        if (existsSync(this.CONFIG_FILE))
        {
            const config: IContainerConfig = JSON.parse(readFileSync(this.CONFIG_FILE, 'utf-8'));
            this.config = config;
        }
    }
}