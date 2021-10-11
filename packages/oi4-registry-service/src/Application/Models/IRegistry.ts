import {
  IEventObject,
  IContainerHealth,
  IContainerRTLicense,
  IContainerLicense,
  IContainerConfig,
  IContainerProfile,
  IContainerLicenseText,
} from 'oi4-service-node/src/Models/IContainer';
import { IMasterAssetModel } from 'oi4-service-node/src/Models/IOPCUA';
import { IConformity } from 'oi4-conformity-validator/Models/IConformityValidator';

/**
 * This interface is proprietary and only used between registry backend and frontend.
 */
export interface IDeviceMessage {
  resources: IResourceObject;
  fullDevicePath: string;
  oi4Id: string;
  oi4Request: string;
  eventList: IEventObject[];
  oi4IdOriginator: string;
  lastMessage: string;
  registeredAt: string;
  conformityObject: IConformity;
  available: boolean;
  deviceType: EDeviceType;
}

export enum EDeviceType {
  device = 0,
  application = 1,
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

export interface IRegistryConfig {
  developmentMode: boolean;
  logFileSize: number;
  auditLevel: string;
  showRegistry: boolean;
  logToFile: string; // TODO: ENUM with either enabled, disabled or endpoint
}
