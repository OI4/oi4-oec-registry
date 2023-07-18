import {
    EAssetType,
    Health,
    IContainerConfig,
    License,
    LicenseText,
    MasterAssetModel,
    Profile,
    RTLicense,
    Oi4Identifier
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

    MAM: MasterAssetModel;
    Health?: Health;
    RtLicense?: RTLicense;
    License?: License;
    Config?: IContainerConfig;
    Profile?: Profile;
    LicenseText?: LicenseText;
}
