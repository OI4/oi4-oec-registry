import { IEnvironmentAppID } from './IEnvironment';
import { IOPCUAData, IOPCUAMetaData, IMasterAssetModel } from './IOPCUAPayload';

export interface IContainerInfo {
  serviceType: string;
  appID: IEnvironmentAppID;
}

export interface IDeviceMessage extends IMasterAssetModel {
  [key: string]: any;
  health?: IContainerHealth;
  license?: IContainerLicense;
  rtLicense?: IContainerRTLicense;
  licenseText?: IContainerLicenseText;
  config?: IContainerConfig;
  fullDevicePath?: string;
  eventList: IEventObject[];
  originator?: string;
}

export interface IEventObject {
  originId?: string;
  logLevel: string;
  logText: string;
}

export interface IContainerData {
  [key: string]: IOPCUAData; // TODO: should this really be an object? Maybe an array is better suited here.
}

export interface IContainerMetaData {
  [key: string]: IOPCUAMetaData;
}

export interface IContainerConfig {
  updateInterval: number;
  textColor: string;
}

export interface IContainerHealth {
  health: EDeviceHealth;
  healthState: number; // UInt16 (from 0 to 100%)
}

export interface IContainerEvent {
  number: number;
  description: string;
  payload: object;
}

export interface IContainerRTLicense {
  expiryDate: string;
  validated: boolean;
  customerName: string;
  certificate: string; // TODO: this might be a file descriptor later on
}

export interface IContainerProfile {
  resource: string[];
}

export interface IComponentObject {
  component: string;
  licAuthor: string[];
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

export interface IContainerState {
  appId: string;
  health: IContainerHealth;
  license: IContainerLicense;
  licenseText: IContainerLicenseText;
  rtLicense: IContainerRTLicense;
  config: IContainerConfig;
  dataLookup: IContainerData;
  profile: IContainerProfile;
  metaDataLookup: IContainerMetaData;
  masterAssetModel: IMasterAssetModel;

  // Methods
  addDataSet(dataname: string, data: IOPCUAData, metadata: IOPCUAMetaData): void;
}

export enum ESubResource {
  trace = 'trace',
  debug = 'debug',
  info = 'info',
  warn = 'warn',
  error = 'error',
  fatal = 'fatal',
}

export enum EDeviceHealth {
  NORMAL_0 = 'NORMAL_0',
  FAILURE_1 = 'FAILURE_1',
  CHECK_FUNCTION_2 = 'CHECK_FUNCTION_2',
  OFF_SPEC_3 = 'OFF_SPEC_3',
  MAINTENANCE_REQUIRED_4 = 'MAINTENANCE_REQUIRED_4',
}
