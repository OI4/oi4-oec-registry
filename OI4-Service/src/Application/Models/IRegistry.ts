import {
  IEventObject,
  IContainerHealth,
  IContainerRTLicense,
  IContainerLicense,
  IContainerConfig,
  IContainerProfile,
  IContainerLicenseText,
} from '../../Service/Models/IContainer';
import { IMasterAssetModel } from '../../Service/Models/IOPCUAPayload';
import { IConformity } from './IConformityValidator';

export interface IDeviceMessage {
  resources: IResourceObject;
  fullDevicePath: string;
  appId: string;
  eventList: IEventObject[];
  originator: string;
  lastMessage: string;
  registeredAt: string;
  conformityObject: IConformity;
}

export interface IResourceObject {
  [key:string]: any;
  mam: IMasterAssetModel;
  health?: IContainerHealth;
  rtLicense?: IContainerRTLicense;
  license?: IContainerLicense;
  config?: IContainerConfig;
  profile?: IContainerProfile;
  licenseText?: IContainerLicenseText;
}

export interface IDeviceLookup {
  [key: string]: IDeviceMessage;
}

interface IDeviceRTLicense {
  expiryDate: string;
  licensee: string;
}

interface IDeviceData {
  health: string;
  config: IDeviceConfig;
}

interface IDeviceConfig {
  updateInterval: number;
}
