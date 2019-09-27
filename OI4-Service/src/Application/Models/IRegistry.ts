import { IDeviceMessage } from '../../Service/Models/IContainer';

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
