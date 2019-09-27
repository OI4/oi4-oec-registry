import { IContainerState } from '../Container';
import { EventEmitter } from 'events';
import { OPCUABuilder } from '../Utilities/OPCUABuilder/index';
export class OI4Proxy extends EventEmitter {
  public appId: string;
  public serviceType: string;
  public containerState: IContainerState;
  public standardRoute: string;
  public oi4DeviceWildCard: string;
  public builder: OPCUABuilder;

  constructor(containerState: IContainerState) {
    super();

    this.appId = containerState.appId;
    this.builder = new OPCUABuilder(this.appId);
    this.serviceType = containerState.masterAssetModel.DeviceClass;

    this.standardRoute = `oi4/${this.serviceType}/${this.appId}`;
    this.oi4DeviceWildCard = 'oi4/+/+/+/+/+';
    this.containerState = containerState;
  }
}
