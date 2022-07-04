import {
    IContainerConfig,
    Health,
    Profile,
    License,
    RTLicense,
    LicenseText
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

// TODO cfz (should be part of oi4-service) --> 
export interface IEventObject {
    number: number;
    description?: string;
    category: string;
    details: any;
    level?: string; // NOT OI4 Conform and just for us
    timestamp: string; // NOT OI4 Conform and just for us
    tag: string; // Oi4Id of log originator
  }
// <-- TODO cfz

export enum EAssetType {
    device = 0,
    application = 1,
}

export interface IResourceObject {
    [key: string]: any;

    mam: IMasterAssetModel;
    health?: Health;
    rtLicense?: RTLicense;
    license?: License;
    config?: IContainerConfig;
    profile?: Profile;
    licenseText?: LicenseText;
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