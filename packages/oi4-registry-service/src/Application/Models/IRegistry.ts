import {
    EAssetType,
    Health,
    IContainerConfig,
    License,
    LicenseText,
    MasterAssetModel,
    Oi4Identifier,
    Profile,
    RTLicense
} from '@oi4/oi4-oec-service-model';
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
    oi4Id: Oi4Identifier;
    oi4IdOriginator: Oi4Identifier;
    lastMessage: string;
    registeredAt: string;
    conformityObject: IConformity;
    assetType: EAssetType;
}

export interface IAssetEvent {
    origin: string;
    level: string;
    number: number;
    category: string;
    description?: string;
    details?: any;
    timestamp: string;
}


export interface IResourceObject {
    [key: string]: any;

    mam: MasterAssetModel;
    health?: Health;
    rtLicense?: RTLicense;
    license?: License;
    config?: IContainerConfig;
    profile?: Profile;
    licenseText?: LicenseText;
}
