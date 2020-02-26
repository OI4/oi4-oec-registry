import { IContainerState } from '../Container';
import { EventEmitter } from 'events';
import { OPCUABuilder } from '../Utilities/OPCUABuilder/index';
export class OI4Proxy extends EventEmitter {
  public appId: string;
  public serviceType: string;
  public containerState: IContainerState;
  public standardRoute: string;
  public builder: OPCUABuilder;

  constructor(containerState: IContainerState) {
    super();

    this.appId = containerState.appId;
    this.serviceType = containerState.mam.DeviceClass;
    this.builder = new OPCUABuilder(this.appId, this.serviceType);

    this.standardRoute = `oi4/${this.serviceType}/${this.appId}`;
    this.containerState = containerState;
  }
}
