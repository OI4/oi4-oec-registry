import {
    IContainerConfig,
    IContainerHealth,
    IContainerProfile,
    IContainerRTLicense,
    IEventObject,
} from '@oi4/oi4-oec-service-model';
import {IMasterAssetModel} from '@oi4/oi4-oec-service-opcua-model';
import {IConformity} from '@oi4/oi4-oec-service-conformity-validator';

/**
 * This interface is proprietary and only used between registry backend and frontend.
 */
export interface IAsset {
    resources: IResourceObject;

    /**
     * The MQTT topic that identifies this asset. Has the format "oi4/<serviceType>/<Oi4Identifier>".
     */
    topicPreamble: string;
    oi4Id: string;
    eventList: IEventObject[];
    oi4IdOriginator: string;
    lastMessage: string;
    registeredAt: string;
    conformityObject: IConformity;
    available: boolean;
    assetType: EAssetType;
}

export enum EAssetType {
    device = 0,
    application = 1,
}

// TODO cfz use from service-model /scr/model/Resources.ts -->

export interface IComponentObject {
    component: string;
    licAuthors: string[];
    licAddText: string;
  }
  

export interface ILicenseObject {
    licenseId: string;
    components: IComponentObject[];
  }
  
export interface IContainerLicense {
    licenses: ILicenseObject[];
}

export interface IContainerLicenseText {
    [key: string]: string;
  }
 
// <-- TODO cfz

export interface IResourceObject {
    [key: string]: any;

    mam: IMasterAssetModel;
    health?: IContainerHealth;
    rtLicense?: IContainerRTLicense;
    license?: IContainerLicense;
    config?: IContainerConfig;
    profile?: IContainerProfile;
    licenseText?: IContainerLicenseText;
}

export interface IAssetLookup {
    [key: string]: IAsset;
}

interface IAssetRTLicense {
    expiryDate: string;
    licensee: string;
}

interface IAssetData {
    health: string;
    config: IAssetConfig;
}

interface IAssetConfig {
    updateInterval: number;
}