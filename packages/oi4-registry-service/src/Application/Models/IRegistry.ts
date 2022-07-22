import {
    IContainerConfig,
    Health,
    Profile,
    License,
    RTLicense,
    LicenseText, 
    EAssetType,
    IEvent,
    MasterAssetModel
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
    oi4Id: string;
    eventList: IReceivedEvent[];
    oi4IdOriginator: string;
    lastMessage: string;
    registeredAt: string;
    conformityObject: IConformity;
    assetType: EAssetType;
}

export interface IReceivedEvent {
    event: IEvent;
    level?: string; // NOT OI4 Conform and just for us
    timestamp: string; // NOT OI4 Conform and just for us
    tag: string; // Oi4Id of log originator
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

export interface IAssetLookup {
    [key: string]: IAsset;
}